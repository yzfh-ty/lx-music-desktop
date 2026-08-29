'use strict'
/**
 * 数据库层状态枚举测试。
 *
 * 跑的是编译自 src/main/worker/dbService/modules/subscription/index.ts 的**真实代码**
 * 和 tables.ts 里的**真实 schema**，只是把 better-sqlite3（Windows 二进制）换成
 * Node 内置的 node:sqlite。目的是确认新增的 upload_unconfirmed 在所有 SQL
 * 状态列表里都被正确对待，没有漏改的分支。
 *
 *   node --test test/db-status-enums.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { compileOnce, buildDir, repoRoot } = require('./helpers/compile')

compileOnce()

// 用 node:sqlite 版本覆盖掉编译出来的 db.js（原版依赖 better-sqlite3 的 Windows 二进制）
const compiledDbPath = path.join(buildDir, 'main/worker/dbService/db.js')
fs.mkdirSync(path.dirname(compiledDbPath), { recursive: true })
fs.copyFileSync(path.join(repoRoot, 'test/stubs/db.js'), compiledDbPath)
// 桩里用的是相对路径 ../helpers/sqlite-adapter，换算成绝对路径
fs.writeFileSync(compiledDbPath, fs.readFileSync(compiledDbPath, 'utf8').replace(
  "require('../helpers/sqlite-adapter')",
  `require(${JSON.stringify(path.join(repoRoot, 'test/helpers/sqlite-adapter.js'))})`,
))

const dbStub = require(compiledDbPath)
const tablesModule = require(path.join(buildDir, 'main/worker/dbService/tables.js'))
const sub = require(path.join(buildDir, 'main/worker/dbService/modules/subscription/index.js'))

const tables = tablesModule.default ?? tablesModule.tables
const DB_VERSION = tablesModule.DB_VERSION

const schema = () => `
  ${Array.from(tables.values()).join('\n')}
  INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES ('version', '${DB_VERSION}');
`

const now = () => Date.now()

/** 建一条音乐库记录 + 一条任务，返回 taskId */
const seedTask = ({ musicKey = 'wy:123', status, localPath = null, fileVerifiedQuality = null, oldCloudPath = null, uploadCompletedAt = null, cloudPath = null } = {}) => {
  const db = dbStub.getDB()
  const t = now()
  db.prepare(`
    INSERT OR IGNORE INTO subscription_library (music_key, source, song_id, name, singer, album_name, duration,
      cloud_quality, cloud_path, file_name_format, upload_confirmed_at, record_origin, calibration_status,
      calibrated_at, quality_satisfied, music_info, created_at, updated_at)
    VALUES (?, 'wy', ?, ?, ?, '', 240, NULL, NULL, NULL, NULL, 'discovered', NULL, NULL, 0, '{}', ?, ?)
  `).run(musicKey, musicKey.split(':')[1], `歌-${musicKey}`, '歌手', t, t)
  const id = `task-${musicKey}-${status}`
  db.prepare(`
    INSERT INTO subscription_task (id, music_key, subscription_id, status, requested_quality,
      source_reported_quality, file_verified_quality, source_used, actual_source, actual_song_id,
      local_path, cloud_path, old_cloud_path, file_name_format, upload_started_at, progress, speed,
      failure_reason, pause_origin, retry_count, cleanup_at, discovered_at, download_completed_at,
      upload_completed_at, created_at, updated_at)
    VALUES (?, ?, NULL, ?, 'flac24bit', 'flac24bit', ?, 'user_api', 'wy', ?, ?, ?, ?, '歌名 - 歌手', ?, 0, '',
      NULL, NULL, 0, NULL, ?, ?, ?, ?, ?)
  `).run(id, musicKey, status, fileVerifiedQuality, musicKey.split(':')[1], localPath, cloudPath, oldCloudPath, t, t, t, uploadCompletedAt, t, t)
  return id
}

const statusOf = id => dbStub.getDB().prepare('SELECT status FROM subscription_task WHERE id = ?').pluck().get(id)

test.beforeEach(() => { dbStub.initTestDB(schema()) })
test.afterEach(() => { dbStub.closeTestDB() })

// ------------------------------------------------------------------ schema

test('真实 schema 能建起来，且 status 列没有 CHECK 约束（新增状态无需迁移）', () => {
  const sql = dbStub.getDB().prepare("SELECT sql FROM sqlite_master WHERE name = 'subscription_task'").pluck().get()
  assert.match(sql, /"status" TEXT NOT NULL/)
  assert.equal(/CHECK/i.test(sql), false)
})

// ------------------------------------------------------------------ 重试入口

test('retrySubscriptionTasks 接受 upload_unconfirmed，并按已有本地成品回到 tagging（重新上传而不是重新下载）', () => {
  const id = seedTask({ status: 'upload_unconfirmed', localPath: 'C:\\a.flac', fileVerifiedQuality: 'flac24bit' })

  assert.equal(sub.retrySubscriptionTasks([id]), 1)
  assert.equal(statusOf(id), 'tagging')
})

test('retrySubscriptionTasks 仍然接受 failed', () => {
  const id = seedTask({ musicKey: 'wy:200', status: 'failed' })

  assert.equal(sub.retrySubscriptionTasks([id]), 1)
  assert.equal(statusOf(id), 'pending')
})

test('failed 且没有本地成品时回到 pending（需要重新下载）', () => {
  const id = seedTask({ musicKey: 'wy:201', status: 'failed', localPath: null })

  sub.retrySubscriptionTasks([id])
  assert.equal(statusOf(id), 'pending')
})

test('已确认上传但旧版本没清干净的任务，重试只清旧版本', () => {
  const id = seedTask({
    musicKey: 'wy:202', status: 'failed', localPath: 'C:\\a.flac',
    fileVerifiedQuality: 'flac24bit', oldCloudPath: 'F:\\a.mp3', uploadCompletedAt: now(),
  })

  sub.retrySubscriptionTasks([id])
  assert.equal(statusOf(id), 'old_version_cleanup')
})

for (const status of ['uploading', 'cleanup_wait', 'downloading', 'uploaded', 'pending']) {
  test(`retrySubscriptionTasks 不会动 ${status} 的任务`, () => {
    const id = seedTask({ musicKey: `wy:3${status.length}`, status })

    assert.equal(sub.retrySubscriptionTasks([id]), 0)
    assert.equal(statusOf(id), status)
  })
}

test('重试会累加 retry_count 并写一条历史', () => {
  const id = seedTask({ musicKey: 'wy:210', status: 'upload_unconfirmed', localPath: 'C:\\a.flac', fileVerifiedQuality: 'flac' })

  sub.retrySubscriptionTasks([id])

  const row = dbStub.getDB().prepare('SELECT retry_count, failure_reason FROM subscription_task WHERE id = ?').get(id)
  assert.equal(row.retry_count, 1)
  assert.equal(row.failure_reason, null)
  const history = dbStub.getDB().prepare("SELECT message FROM subscription_history WHERE task_id = ? AND message = '用户手动重试'").all(id)
  assert.equal(history.length, 1)
})

// ------------------------------------------------------------------ 看板计数

test('upload_unconfirmed 计入待确认，不计入失败', () => {
  seedTask({ musicKey: 'wy:401', status: 'upload_unconfirmed' })
  seedTask({ musicKey: 'wy:402', status: 'upload_unconfirmed' })
  seedTask({ musicKey: 'wy:403', status: 'failed' })
  seedTask({ musicKey: 'wy:404', status: 'uploading' })

  const dashboard = sub.getSubscriptionDashboard()
  assert.equal(dashboard.unconfirmedCount, 2)
  assert.equal(dashboard.failedCount, 1, '待确认的任务不能污染失败数')
  assert.equal(dashboard.uploadingCount, 1)
})

// ------------------------------------------------------------ 重新入队的拦截

test('requeueSubscriptionMusic 拒绝仍在等待 CD2 确认的歌曲', () => {
  seedTask({ musicKey: 'wy:500', status: 'upload_unconfirmed', localPath: 'C:\\a.flac' })

  assert.throws(() => sub.requeueSubscriptionMusic('wy:500'), /正在处理中/)
})

test('requeueSubscriptionMusic 同样拦住 uploading', () => {
  seedTask({ musicKey: 'wy:501', status: 'uploading' })

  assert.throws(() => sub.requeueSubscriptionMusic('wy:501'), /正在处理中/)
})

// ------------------------------------------------------ CD2 开关与状态降级

test('关闭 CD2 同步后，upload_unconfirmed 会降级为 local_completed 而不是卡住', () => {
  const id = seedTask({ musicKey: 'wy:600', status: 'uploading', localPath: 'C:\\a.flac' })
  sub.updateSubscriptionConfig({ syncToCd2: false })

  const task = sub.updateSubscriptionTask({ id, status: 'upload_unconfirmed', failureReason: '尚未关联' })

  assert.equal(task.status, 'local_completed')
  assert.equal(task.failureReason, null)
})

test('开着 CD2 同步时 upload_unconfirmed 正常保留', () => {
  const id = seedTask({ musicKey: 'wy:601', status: 'uploading', localPath: 'C:\\a.flac' })

  const task = sub.updateSubscriptionTask({ id, status: 'upload_unconfirmed', failureReason: '尚未关联' })

  assert.equal(task.status, 'upload_unconfirmed')
  assert.match(task.failureReason, /尚未关联/)
})

// ------------------------------------------------------------------ 历史抑制

test('状态和原因都没变时不写历史（轮询不会刷屏）', () => {
  const id = seedTask({ musicKey: 'wy:700', status: 'upload_unconfirmed' })
  sub.updateSubscriptionTask({ id, failureReason: '尚未关联' })
  const before = dbStub.getDB().prepare('SELECT COUNT(*) FROM subscription_history WHERE task_id = ?').pluck().get(id)

  for (let i = 0; i < 5; i++) sub.updateSubscriptionTask({ id, failureReason: '尚未关联', progress: 0 })

  const after = dbStub.getDB().prepare('SELECT COUNT(*) FROM subscription_history WHERE task_id = ?').pluck().get(id)
  assert.equal(after, before)
})

// ------------------------------------------------------------------ 上传确认

test('确认上传成功后写入云端音质并进入延迟清理', () => {
  const id = seedTask({ musicKey: 'wy:800', status: 'uploading', localPath: 'C:\\a.flac', fileVerifiedQuality: 'flac24bit' })
  const confirmedAt = now()

  const task = sub.confirmSubscriptionUpload({
    taskId: id, cloudPath: 'F:\\a.flac', cloudQuality: 'flac24bit',
    fileNameFormat: '歌名 - 歌手', confirmedAt, cleanupAt: confirmedAt + 20 * 60_000,
  })

  assert.equal(task.status, 'cleanup_wait')
  assert.equal(task.cloudQuality, 'flac24bit')
  const library = dbStub.getDB().prepare('SELECT cloud_quality, cloud_path FROM subscription_library WHERE music_key = ?').get('wy:800')
  assert.equal(library.cloud_quality, 'flac24bit', '只有确认成功才写入音乐库的已确认音质')
  assert.equal(library.cloud_path, 'F:\\a.flac')
})

test('有旧版本待清时，确认后先去清旧版本', () => {
  const id = seedTask({
    musicKey: 'wy:801', status: 'uploading', localPath: 'C:\\a.flac',
    fileVerifiedQuality: 'flac24bit', oldCloudPath: 'F:\\a.mp3',
  })
  const confirmedAt = now()

  const task = sub.confirmSubscriptionUpload({
    taskId: id, cloudPath: 'F:\\a.flac', cloudQuality: 'flac24bit',
    fileNameFormat: '歌名 - 歌手', confirmedAt, cleanupAt: confirmedAt + 20 * 60_000,
  })

  assert.equal(task.status, 'old_version_cleanup')
})

// ------------------------------------------------------------ 歌单同步的处理

test('歌单同步时不会碰仍在等待 CD2 确认的歌曲', () => {
  seedTask({ musicKey: 'wy:900', status: 'upload_unconfirmed', localPath: 'C:\\a.flac' })
  sub.createSubscription({ source: 'wy', listType: 'playlist', listId: 'pl-1', name: '测试歌单', intervalMinutes: null })
  const subscriptionId = dbStub.getDB().prepare('SELECT id FROM subscription_list').pluck().get()

  const result = sub.ingestSubscriptionSync({
    subscriptionId,
    syncedAt: now(),
    tracks: [{
      id: '900', source: 'wy', name: '歌-wy:900', singer: '歌手', albumName: '',
      interval: '04:00', duration: 240, musicInfo: { id: '900', source: 'wy', name: '歌-wy:900', singer: '歌手', meta: {} },
    }],
  })

  assert.equal(result.skipped, 1, '在传的歌曲应当被跳过')
  assert.equal(statusOf('task-wy:900-upload_unconfirmed'), 'upload_unconfirmed')
})

test('歌单同步会把已上传的歌曲重新排队检查升级', () => {
  seedTask({ musicKey: 'wy:901', status: 'uploaded' })
  sub.createSubscription({ source: 'wy', listType: 'playlist', listId: 'pl-2', name: '测试歌单2', intervalMinutes: null })
  const subscriptionId = dbStub.getDB().prepare('SELECT id FROM subscription_list').pluck().get()

  const result = sub.ingestSubscriptionSync({
    subscriptionId,
    syncedAt: now(),
    tracks: [{
      id: '901', source: 'wy', name: '歌-wy:901', singer: '歌手', albumName: '',
      interval: '04:00', duration: 240, musicInfo: { id: '901', source: 'wy', name: '歌-wy:901', singer: '歌手', meta: {} },
    }],
  })

  assert.equal(result.queued, 1)
})

// ------------------------------------------------------------------ 校准保护

test('云端校准不会把正在等待确认的任务改成待人工校准', () => {
  seedTask({ musicKey: 'wy:1000', status: 'upload_unconfirmed', localPath: 'C:\\a.flac' })
  const db = dbStub.getDB()
  // 造两个候选文件指向同一首歌，逼出 unresolved 分支
  const t = now()
  db.prepare(`UPDATE subscription_library SET name = '同名歌曲', singer = '同名歌手', duration = 240 WHERE music_key = ?`).run('wy:1000')

  sub.importSubscriptionCalibration([
    { filePath: 'F:\\x1.flac', title: '同名歌曲', artist: '同名歌手', duration: 240, quality: 'flac', error: null, scannedAt: t },
    { filePath: 'F:\\x2.flac', title: '同名歌曲', artist: '同名歌手', duration: 240, quality: 'flac', error: null, scannedAt: t },
  ])

  assert.equal(
    statusOf('task-wy:1000-upload_unconfirmed'), 'upload_unconfirmed',
    '正在传的任务不能被校准流程改写',
  )
})
