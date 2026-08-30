'use strict'
/**
 * getSubscriptionCd2UploadStatus / cleanupSubscriptionLocalFile 的行为测试。
 *
 * 跑的是编译自 src/main/modules/subscription/cd2.ts 的真实代码，
 * 对端是一个用同一份 clouddrive.proto 起的假 CloudDrive2 服务，走真实 gRPC。
 *
 *   node --test test/cd2-upload-status.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { compileOnce, buildDir } = require('./helpers/compile')
const { MockCd2Server, UploadStatus } = require('./helpers/mock-cd2')
const { makeWorkspace, makeConfig } = require('./helpers/env')

compileOnce()
const cd2 = require(path.join(buildDir, 'main/modules/subscription/cd2.js'))

const SOURCE_DIR = '/115/music'
const FILE_NAME = '普通的日子 - 魏如萱.flac'
const FILE_SIZE = 40 * 1024 * 1024

/** 起服务 + 建目录 + 把本地成品和云端副本都摆好，返回测试上下文 */
const setup = async(opts = {}) => {
  const server = await new MockCd2Server().start()
  const ws = makeWorkspace()
  server.mountPoints = [{
    mountPoint: ws.mount,
    sourceDir: SOURCE_DIR,
    readOnly: false,
    isMounted: true,
    failReason: '',
  }]
  const localPath = ws.writeFile(ws.download, FILE_NAME, FILE_SIZE)
  const cloudPath = path.join(ws.mount, FILE_NAME)
  // 复制到挂载点：CloudDrive2 场景下文件写进挂载目录后立刻可见，上传是异步的
  if (opts.copiedToMount !== false) fs.copyFileSync(localPath, cloudPath)
  const config = makeConfig({ cd2RootPath: ws.mount, cd2GrpcUrl: server.url })
  const destPath = `${SOURCE_DIR}/${FILE_NAME}`
  return {
    server,
    ws,
    config,
    localPath,
    cloudPath,
    destPath,
    status: () => cd2.getSubscriptionCd2UploadStatus({ config, localPath, cloudPath }),
    cleanup: () => cd2.cleanupSubscriptionLocalFile({ config, localPath, cloudPath }),
    async teardown() { await server.stop(); ws.cleanup() },
  }
}

// ---------------------------------------------------------------- 关联与进度

test('destPath 精确匹配：CloudDrive2 预处理阶段报告 size=0 也要能关联上（回归：旧实现会误判为未关联）', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.addUpload({ destPath: c.destPath, size: 0, transferedBytes: 0, statusEnum: UploadStatus.Preprocessing })

  const result = await c.status()
  assert.equal(result.state, 'running', '应当识别为上传中，而不是"尚未关联"')
})

test('destPath 精确匹配：正常传输中返回真实进度', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, transferedBytes: FILE_SIZE / 4, statusEnum: UploadStatus.Transfer })

  const result = await c.status()
  assert.equal(result.state, 'running')
  assert.equal(Math.round(result.progress), 25)
})

test('size 报告为 0 时用本地文件大小做分母，进度不会恒为 0', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.addUpload({ destPath: c.destPath, size: 0, transferedBytes: FILE_SIZE / 2, statusEnum: UploadStatus.Transfer })

  const result = await c.status()
  assert.equal(result.state, 'running')
  assert.equal(Math.round(result.progress), 50)
})

test('destPath 对不上但同名同大小且唯一时，退回启发式匹配', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  // 模拟 CloudDrive2 用了另一种路径拼法
  c.server.addUpload({ destPath: `/OtherRoot/${FILE_NAME}`, size: FILE_SIZE, transferedBytes: FILE_SIZE / 10, statusEnum: UploadStatus.Transfer })

  const result = await c.status()
  assert.equal(result.state, 'running')
})

test('同名同大小出现多条且 destPath 都对不上时，不做猜测', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.addUpload({ destPath: `/A/${FILE_NAME}`, size: FILE_SIZE, statusEnum: UploadStatus.Transfer })
  c.server.addUpload({ destPath: `/B/${FILE_NAME}`, size: FILE_SIZE, statusEnum: UploadStatus.Transfer })

  const result = await c.status()
  assert.equal(result.state, 'unconfirmed')
})

// ---------------------------------------------------------------- 成功判定

test('传输任务 Finish 且云端文件校验通过 → success', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, transferedBytes: FILE_SIZE, statusEnum: UploadStatus.Finish })
  c.server.putCloudFile(c.destPath, { size: FILE_SIZE, isCloudFile: true, isLocal: false })

  const result = await c.status()
  assert.equal(result.state, 'success')
  assert.equal(result.progress, 100)
})

test('传输任务已被 CloudDrive2 移出列表，但云端文件存在且大小一致 → success（核心修复）', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  // 上传列表为空，模拟 CloudDrive2 传输完成后清理了任务
  c.server.putCloudFile(c.destPath, { size: FILE_SIZE, isCloudFile: true, isLocal: false })

  const result = await c.status()
  assert.equal(result.state, 'success', '旧实现会在 10 分钟后把它标成 failed')
  assert.equal(result.verifiedByCloudFile, true)
})

test('Skipped（秒传/目标已存在）且云端校验通过 → success 而不是失败', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, statusEnum: UploadStatus.Skipped })
  c.server.putCloudFile(c.destPath, { size: FILE_SIZE, isCloudFile: true, isLocal: false })

  const result = await c.status()
  assert.equal(result.state, 'success')
})

// ------------------------------------------------- 防误判（数据安全关键路径）

test('云端条目仍是 CloudDrive2 本地写缓存（isLocal=true）时绝不判成功', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.putCloudFile(c.destPath, { size: FILE_SIZE, isCloudFile: true, isLocal: true })

  const result = await c.status()
  assert.equal(result.state, 'unconfirmed', 'CloudDrive2 写入挂载点后文件立刻可见，只看存在性会误删本地成品')
})

test('云端条目 isCloudFile=false 时绝不判成功', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.putCloudFile(c.destPath, { size: FILE_SIZE, isCloudFile: false, isLocal: false })

  const result = await c.status()
  assert.equal(result.state, 'unconfirmed')
})

test('云端文件大小与本地成品不一致（上传被截断）时绝不判成功', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.putCloudFile(c.destPath, { size: FILE_SIZE - 1024, isCloudFile: true, isLocal: false })

  const result = await c.status()
  assert.equal(result.state, 'unconfirmed')
})

test('本地成品已不存在（拿不到基准大小）时绝不凭云端存在判成功', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  fs.unlinkSync(c.localPath)
  c.server.putCloudFile(c.destPath, { size: FILE_SIZE, isCloudFile: true, isLocal: false })

  const result = await c.status()
  assert.equal(result.state, 'unconfirmed')
})

test('传输任务 Finish 但云端与挂载点都查不到文件 → unconfirmed 而不是 success', async(t) => {
  const c = await setup({ copiedToMount: false })
  t.after(() => c.teardown())
  c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, transferedBytes: FILE_SIZE, statusEnum: UploadStatus.Finish })

  const result = await c.status()
  assert.equal(result.state, 'unconfirmed')
})

test('Finish 时云端说大小不对，不能被挂载点 stat 推翻（挂载点看到的是 CloudDrive2 本地写缓存）', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, transferedBytes: FILE_SIZE, statusEnum: UploadStatus.Finish })
  // 挂载点上是完整文件（复制进去就可见），但云端只传上去一半
  c.server.putCloudFile(c.destPath, { size: FILE_SIZE / 2, isCloudFile: true, isLocal: false })

  const result = await c.status()
  assert.equal(result.state, 'unconfirmed', 'gRPC 给出的否定结论是权威的，不能退回挂载点 stat 覆盖掉')
})

test('Token 无列目录权限时降级到挂载点校验，Finish 仍可确认成功', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.tokenInfo.permissions.allow_list = false
  c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, transferedBytes: FILE_SIZE, statusEnum: UploadStatus.Finish })

  const result = await c.status()
  assert.equal(result.state, 'success')
  assert.notEqual(result.verifiedByCloudFile, true, '降级模式不应声称经过云端校验')
})

// ---------------------------------------------------------------- 失败判定

for (const name of ['Error', 'FatalError', 'Cancelled', 'Ignored']) {
  test(`传输任务 ${name} → failed（这才是真正需要用户介入的失败）`, async(t) => {
    const c = await setup()
    t.after(() => c.teardown())
    c.server.addUpload({
      destPath: c.destPath, size: FILE_SIZE, transferedBytes: 1024,
      statusEnum: UploadStatus[name], errorMessage: `mock ${name}`,
    })

    const result = await c.status()
    assert.equal(result.state, 'failed')
    assert.match(result.message, /mock/)
  })
}

test('Skipped 但云端文件不可用 → failed', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, statusEnum: UploadStatus.Skipped })

  const result = await c.status()
  assert.equal(result.state, 'failed')
})

// ---------------------------------------------------------------- 不确定态

test('完全关联不上且云端没有文件 → unconfirmed（不是 failed）', async(t) => {
  const c = await setup({ copiedToMount: false })
  t.after(() => c.teardown())

  const result = await c.status()
  assert.equal(result.state, 'unconfirmed')
})

test('关联到多个仍在运行的任务 → unconfirmed', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, statusEnum: UploadStatus.Transfer })
  c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, statusEnum: UploadStatus.Inqueue })

  const result = await c.status()
  assert.equal(result.state, 'unconfirmed')
})

test('关联到状态互相冲突的多个终态任务 → unconfirmed', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, statusEnum: UploadStatus.Finish })
  c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, statusEnum: UploadStatus.Error })

  const result = await c.status()
  assert.equal(result.state, 'unconfirmed')
})

test('Token 缺少列目录权限时，unconfirmed 的原因要说清楚', async(t) => {
  const c = await setup({ copiedToMount: false })
  t.after(() => c.teardown())
  c.server.tokenInfo.permissions.allow_list = false

  const result = await c.status()
  assert.equal(result.state, 'unconfirmed')
  assert.match(result.message, /列目录权限/)
  assert.ok(
    !c.server.calls.some(call => call.name == 'FindFileByPath'),
    '没有权限时不应该白白发起 FindFileByPath',
  )
})

// ------------------------------------------------- 连接前置检查（不应误报失败）

test('CloudDrive2 未登录时抛错，由上层归入"待确认"而不是下载失败', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.systemInfo.IsLogin = false

  await assert.rejects(c.status(), /尚未登录/)
})

test('挂载点只读时抛出可读的原因', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.mountPoints[0].readOnly = true

  await assert.rejects(c.status(), /只读/)
})

test('挂载点未就绪时抛出可读的原因', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.server.mountPoints[0].isMounted = false
  c.server.mountPoints[0].failReason = 'drive not ready'

  await assert.rejects(c.status(), /挂载点未就绪/)
})
