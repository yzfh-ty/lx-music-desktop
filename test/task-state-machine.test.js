'use strict'
/**
 * 订阅任务状态机测试。
 *
 * 跑的是编译自 src/renderer/store/subscription/index.ts 的真实代码，
 * IPC 层换成内存替身（行为照抄真实 DB 层，包括 history 的写入条件）。
 *
 * 核心命题：CloudDrive2 那边无法给出明确结论时，任务只能停在 upload_unconfirmed，
 * 绝不能变成 failed —— 本地成品还在，重新下载毫无意义。
 *
 *   node --test test/task-state-machine.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { compileOnce, buildDir, repoRoot } = require('./helpers/compile')
const alias = require('./helpers/module-alias')

const stubs = path.join(repoRoot, 'test/stubs')
alias.register({
  '@common/utils/vueTools': path.join(stubs, 'vueTools.js'),
  '@renderer/utils/ipc': path.join(stubs, 'ipc.js'),
  '@renderer/store/download/action': path.join(stubs, 'download-action.js'),
  '@renderer/store/download/state': path.join(stubs, 'download-state.js'),
  '@renderer/store/setting': path.join(stubs, 'setting.js'),
  '@renderer/store/songList/action': path.join(stubs, 'noop-store.js'),
  '@renderer/store/leaderboard/action': path.join(stubs, 'noop-store.js'),
})

compileOnce()
const ipc = require(path.join(stubs, 'ipc.js'))
const downloadAction = require(path.join(stubs, 'download-action.js'))
const downloadState = require(path.join(stubs, 'download-state.js'))
const { appSetting } = require(path.join(stubs, 'setting.js'))
const store = require(path.join(buildDir, 'renderer/store/subscription/index.js'))

const GRACE = 10 * 60_000
const CLEANUP_DELAY = 20 * 60_000

const beforeEach = () => {
  ipc.__reset()
  downloadAction.reset()
  downloadState.downloadList.length = 0
  appSetting['subscription.enable'] = false
}
const taskOf = id => ipc.__state.tasks.get(id)
const historyOf = id => ipc.__state.history.filter(h => h.taskId == id)

const UNCONFIRMED = { state: 'unconfirmed', progress: 0, message: '尚未关联到对应的 CloudDrive2 上传任务，云端文件也尚未就绪，继续等待确认' }
const SUCCESS = { state: 'success', progress: 100, message: 'Finish', verifiedByCloudFile: true }

// ------------------------------------------------------- 关联不上 ≠ 下载失败

test('刚复制完就关联不上：宽限期内保持 uploading，不动状态', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'uploading', uploadStartedAt: Date.now() })
  ipc.__scriptCd2Status(task.id, UNCONFIRMED)

  await store.processSubscriptionMaintenance()

  assert.equal(taskOf(task.id).status, 'uploading')
  assert.equal(historyOf(task.id).length, 0, '宽限期内不该产生状态变更记录')
})

test('超过宽限期仍关联不上：转入 upload_unconfirmed，而不是 failed', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'uploading', uploadStartedAt: Date.now() - GRACE - 1000 })
  ipc.__scriptCd2Status(task.id, UNCONFIRMED)

  await store.processSubscriptionMaintenance()

  const after = taskOf(task.id)
  assert.equal(after.status, 'upload_unconfirmed', '这是本次修复的核心：不能再判成 failed')
  assert.notEqual(after.status, 'failed')
  assert.match(after.failureReason, /尚未关联/)
  assert.equal(after.cleanupAt, null, '未确认成功时不能启动延迟清理倒计时')
  assert.equal(after.localPath != null, true, '本地成品必须保留')
})

test('停在 upload_unconfirmed 后反复轮询，不会把历史表刷屏', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'uploading', uploadStartedAt: Date.now() - GRACE - 1000 })
  ipc.__scriptCd2Status(task.id, UNCONFIRMED)

  for (let i = 0; i < 8; i++) await store.processSubscriptionMaintenance()

  assert.equal(taskOf(task.id).status, 'upload_unconfirmed')
  assert.equal(historyOf(task.id).length, 1, '原因没变就不该重复写历史')
})

test('待确认期间原因变化时更新原因，但状态不变', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'uploading', uploadStartedAt: Date.now() - GRACE - 1000 })
  ipc.__scriptCd2Status(task.id, [
    UNCONFIRMED,
    { state: 'unconfirmed', progress: 0, message: '关联到多个仍在运行的 CloudDrive2 上传任务，暂不确认' },
  ])

  await store.processSubscriptionMaintenance()
  await store.processSubscriptionMaintenance()

  assert.equal(taskOf(task.id).status, 'upload_unconfirmed')
  assert.match(taskOf(task.id).failureReason, /多个仍在运行/)
  assert.equal(historyOf(task.id).length, 2)
})

test('gRPC 查询本身报错也归入待确认，不判失败', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'uploading', uploadStartedAt: Date.now() })
  ipc.__scriptCd2Status(task.id, new Error('14 UNAVAILABLE: No connection established'))

  await store.processSubscriptionMaintenance()

  const after = taskOf(task.id)
  assert.equal(after.status, 'upload_unconfirmed')
  assert.match(after.failureReason, /UNAVAILABLE/)
})

test('查询报错反复出现同一条原因时，也不刷历史', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'uploading' })
  ipc.__scriptCd2Status(task.id, new Error('14 UNAVAILABLE'))

  for (let i = 0; i < 5; i++) await store.processSubscriptionMaintenance()

  assert.equal(historyOf(task.id).length, 1)
})

// ------------------------------------------------------------------ 能恢复

test('待确认的任务在 CloudDrive2 恢复后能自动回到 uploading', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'upload_unconfirmed', failureReason: '尚未关联' })
  ipc.__scriptCd2Status(task.id, { state: 'running', progress: 42, message: 'Transfer' })

  await store.processSubscriptionMaintenance()

  const after = taskOf(task.id)
  assert.equal(after.status, 'uploading')
  assert.equal(after.progress, 42)
  assert.equal(after.failureReason, null, '恢复后要清掉原因')
})

test('待确认的任务在 CloudDrive2 确认成功后能自动完成确认', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'upload_unconfirmed', failureReason: '尚未关联' })
  ipc.__scriptCd2Status(task.id, SUCCESS)

  await store.processSubscriptionMaintenance()

  const after = taskOf(task.id)
  assert.equal(after.status, 'cleanup_wait')
  assert.equal(after.cloudQuality, 'flac24bit', '确认成功后才写入云端音质')
  assert.ok(after.cleanupAt > Date.now(), '这时才开始 20 分钟倒计时')
  assert.ok(after.cleanupAt - after.uploadCompletedAt == CLEANUP_DELAY)
})

// -------------------------------------------------------------- 真失败仍是失败

test('CloudDrive2 明确报告传输失败时，仍然标记为 failed', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'uploading' })
  ipc.__scriptCd2Status(task.id, { state: 'failed', progress: 12, message: 'disk quota exceeded' })

  await store.processSubscriptionMaintenance()

  const after = taskOf(task.id)
  assert.equal(after.status, 'failed')
  assert.match(after.failureReason, /CloudDrive2 上传失败/)
  assert.match(after.failureReason, /disk quota/)
})

test('确认成功但缺少本地复核音质时判为待确认而不是静默放过', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'uploading', fileVerifiedQuality: null })
  ipc.__scriptCd2Status(task.id, SUCCESS)

  await store.processSubscriptionMaintenance()

  const after = taskOf(task.id)
  assert.equal(after.status, 'upload_unconfirmed')
  assert.match(after.failureReason, /缺少目标路径或本地复核音质/)
  assert.equal(after.cloudQuality, null, '不能在音质未知的情况下写入云端音质')
})

// ------------------------------------------------------------------ 写库抑制

test('上传进度没变化时不重复写库（避免任务列表按 updated_at 反复重排）', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'uploading', progress: 0 })
  ipc.__scriptCd2Status(task.id, { state: 'running', progress: 30, message: 'Transfer' })

  await store.processSubscriptionMaintenance()
  const writesAfterFirst = ipc.__state.calls.filter(c => c.name == 'updateSubscriptionTask').length
  await store.processSubscriptionMaintenance()
  await store.processSubscriptionMaintenance()
  const writesAfterMore = ipc.__state.calls.filter(c => c.name == 'updateSubscriptionTask').length

  assert.equal(writesAfterFirst, 1)
  assert.equal(writesAfterMore, 1, '进度没动就不该再写库')
})

test('进度真的推进时会写库', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'uploading', progress: 0 })
  ipc.__scriptCd2Status(task.id, [
    { state: 'running', progress: 30, message: 'Transfer' },
    { state: 'running', progress: 65, message: 'Transfer' },
  ])

  await store.processSubscriptionMaintenance()
  await store.processSubscriptionMaintenance()

  assert.equal(taskOf(task.id).progress, 65)
  assert.equal(ipc.__state.calls.filter(c => c.name == 'updateSubscriptionTask').length, 2)
})

// -------------------------------------------------------------- 手动重新检查

test('手动重新检查：仍无结论时返回原因', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'upload_unconfirmed', failureReason: '尚未关联' })
  ipc.__scriptCd2Status(task.id, UNCONFIRMED)

  const result = await store.recheckSubscriptionUpload(task)

  assert.equal(result.status, 'upload_unconfirmed')
})

test('手动重新检查：CloudDrive2 已经好了就立刻推进', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'upload_unconfirmed', failureReason: '尚未关联' })
  ipc.__scriptCd2Status(task.id, SUCCESS)

  const result = await store.recheckSubscriptionUpload(task)

  assert.equal(result.status, 'cleanup_wait')
})

test('手动重新检查：不在上传确认阶段的任务会被拒绝', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'failed' })

  await assert.rejects(store.recheckSubscriptionUpload(task), /不处于等待 CloudDrive2 确认的阶段/)
})

// ------------------------------------------------------------ 延迟清理与旧版本

test('倒计时未到时不触发清理', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'cleanup_wait', cleanupAt: Date.now() + 60_000 })
  ipc.__scriptCd2Status(task.id, SUCCESS)

  await store.processSubscriptionMaintenance()

  assert.equal(ipc.__state.calls.some(c => c.name == 'cleanupSubscriptionLocalFile'), false)
  assert.equal(taskOf(task.id).status, 'cleanup_wait')
})

test('倒计时到了且清理成功后转为 uploaded 并清空本地路径', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'cleanup_wait', cleanupAt: Date.now() - 1000 })
  ipc.__scriptCd2Status(task.id, SUCCESS)

  await store.processSubscriptionMaintenance()

  const after = taskOf(task.id)
  assert.equal(after.status, 'uploaded')
  assert.equal(after.localPath, null)
  assert.equal(after.cleanupAt, null)
})

test('清理被推迟时保持 cleanup_wait，不丢本地文件也不判失败', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'cleanup_wait', cleanupAt: Date.now() - 1000 })
  ipc.__scriptCd2Status(task.id, SUCCESS)
  ipc.__state.cleanupBehaviour.throws = '延迟清理已推迟：CloudDrive2 目标文件不存在'

  await store.processSubscriptionMaintenance()

  const after = taskOf(task.id)
  assert.equal(after.status, 'cleanup_wait')
  assert.notEqual(after.localPath, null)
  assert.match(after.failureReason, /推迟/)
})

test('旧版本清理失败时只标记失败，不会重新上传新文件', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'old_version_cleanup', oldCloudPath: 'F:\\普通的日子 - 魏如萱.mp3' })
  ipc.__scriptCd2Status(task.id, SUCCESS)
  ipc.__state.removeOldBehaviour.throws = 'permission denied'

  await store.processSubscriptionMaintenance()

  const after = taskOf(task.id)
  assert.equal(after.status, 'failed')
  assert.match(after.failureReason, /旧云端版本清理失败/)
  assert.equal(after.oldCloudPath, 'F:\\普通的日子 - 魏如萱.mp3', '旧路径要保留下来供重试')
})

test('旧版本清理成功后进入延迟清理并清空旧路径', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'old_version_cleanup', oldCloudPath: 'F:\\普通的日子 - 魏如萱.mp3' })
  ipc.__scriptCd2Status(task.id, SUCCESS)

  await store.processSubscriptionMaintenance()

  const after = taskOf(task.id)
  assert.equal(after.status, 'cleanup_wait')
  assert.equal(after.oldCloudPath, null)
})

// ------------------------------------------------------------ CloudDrive2 开关关闭时

test('关闭 CloudDrive2 同步后，待确认任务降级为仅本地完成而不是卡死', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'uploading', uploadStartedAt: Date.now() - GRACE - 1000 })
  ipc.__scriptCd2Status(task.id, UNCONFIRMED)
  ipc.__state.config.syncToCd2 = false

  await store.processSubscriptionMaintenance()

  assert.equal(taskOf(task.id).status, 'local_completed')
})

// ------------------------------------------------------------------ 多任务

test('多个上传任务互不影响，各自按自己的 CloudDrive2 结论走', async() => {
  beforeEach()
  const ok = ipc.__addTask({ id: 'ok', status: 'uploading' })
  const pending = ipc.__addTask({ id: 'pending', status: 'uploading', uploadStartedAt: Date.now() - GRACE - 1000 })
  const bad = ipc.__addTask({ id: 'bad', status: 'uploading' })
  ipc.__scriptCd2Status(ok.id, SUCCESS)
  ipc.__scriptCd2Status(pending.id, UNCONFIRMED)
  ipc.__scriptCd2Status(bad.id, { state: 'failed', progress: 0, message: 'network error' })

  await store.processSubscriptionMaintenance()

  assert.equal(taskOf('ok').status, 'cleanup_wait')
  assert.equal(taskOf('pending').status, 'upload_unconfirmed')
  assert.equal(taskOf('bad').status, 'failed')
})

// ------------------------------------------------------------ 磁盘保护与服务生命周期

test('磁盘低于阈值时会暂停已经在下载列表中的活动任务', async() => {
  beforeEach()
  const task = ipc.__addTask({ status: 'downloading' })
  ipc.__state.diskInfo.freeBytes = 1
  downloadState.downloadList.push({
    id: 'download-1',
    isComplate: false,
    status: 'run',
    metadata: { subscriptionTaskId: task.id },
  })

  await store.processSubscriptionQueue()

  assert.equal(taskOf(task.id).status, 'disk_paused')
  assert.equal(taskOf(task.id).pauseOrigin, 'disk')
  assert.equal(ipc.__state.config.diskLocked, true)
  assert.equal(downloadAction.calls.some(call => call.name == 'pauseDownloadTasks'), true)
})

test('本地备份在关闭 CloudDrive2 同步时仍会按计划执行', async() => {
  beforeEach()
  appSetting['subscription.enable'] = true
  ipc.__state.config.syncToCd2 = false
  ipc.__state.config.backupIntervalMinutes = 10

  await store.initSubscriptionService()
  store.stopSubscriptionService()

  assert.equal(ipc.__state.calls.some(call => call.name == 'backupSubscriptionDatabase'), true)
})

test('关闭功能会取消尚未完成的异步初始化', async() => {
  beforeEach()
  appSetting['subscription.enable'] = true
  let release
  downloadAction.setGetDownloadListBehaviour(() => new Promise(resolve => { release = resolve }))

  const initializing = store.initSubscriptionService()
  await new Promise(resolve => setImmediate(resolve))
  appSetting['subscription.enable'] = false
  store.stopSubscriptionService()
  release([])
  await initializing

  assert.equal(ipc.__state.calls.length, 0, '取消后不应继续读取配置、同步或启动备份')
})
