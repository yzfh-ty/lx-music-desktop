'use strict'
/**
 * 延迟清理的安全门测试。
 *
 * cleanupSubscriptionLocalFile 是整条链路里唯一会删除用户本地成品的地方，
 * 一旦在「其实没上传成功」的情况下放行就是不可恢复的数据丢失。
 * 这里逐条验证：任何不确定的情况都必须拒绝删除，而且本地文件必须还在。
 *
 *   node --test test/cleanup-safety.test.js
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
const FILE_NAME = '达尔文 (Live) - 蔡健雅.flac'
const LRC_NAME = '达尔文 (Live) - 蔡健雅.lrc'
const FILE_SIZE = 24 * 1024 * 1024

const setup = async(opts = {}) => {
  const server = await new MockCd2Server().start()
  const ws = makeWorkspace()
  server.mountPoints = [{ mountPoint: ws.mount, sourceDir: SOURCE_DIR, readOnly: false, isMounted: true, failReason: '' }]
  const localPath = ws.writeFile(ws.download, FILE_NAME, FILE_SIZE)
  const localLrcPath = opts.withLrc ? ws.writeFile(ws.download, LRC_NAME, 2048) : null
  const cloudPath = path.join(ws.mount, FILE_NAME)
  const cloudLrcPath = path.join(ws.mount, LRC_NAME)
  if (opts.copiedToMount !== false) fs.copyFileSync(localPath, cloudPath)
  if (localLrcPath && opts.copiedLrcToMount !== false) fs.copyFileSync(localLrcPath, cloudLrcPath)
  const config = makeConfig({ cd2RootPath: ws.mount, cd2GrpcUrl: server.url })
  const destPath = `${SOURCE_DIR}/${FILE_NAME}`
  return {
    server,
    destPath,
    localPath,
    localLrcPath,
    cloudPath,
    cloudLrcPath,
    /** 让云端校验通过，模拟一次真正成功的上传 */
    markUploadedOk() {
      server.addUpload({ destPath, size: FILE_SIZE, transferedBytes: FILE_SIZE, statusEnum: UploadStatus.Finish })
      server.putCloudFile(destPath, { size: FILE_SIZE, isCloudFile: true, isLocal: false })
    },
    cleanup: () => cd2.cleanupSubscriptionLocalFile({ config, localPath, cloudPath }),
    localStillThere: () => fs.existsSync(localPath),
    async teardown() { await server.stop(); ws.cleanup() },
  }
}

// ------------------------------------------------------------ 应当放行的情况

test('确认上传成功后才删除本地成品', async(t) => {
  const c = await setup()
  t.after(() => c.teardown())
  c.markUploadedOk()

  await c.cleanup()
  assert.equal(c.localStillThere(), false, '确认成功后应当删除本地文件')
})

test('有歌词时，音频和歌词一起删除', async(t) => {
  const c = await setup({ withLrc: true })
  t.after(() => c.teardown())
  c.markUploadedOk()

  await c.cleanup()
  assert.equal(fs.existsSync(c.localPath), false)
  assert.equal(fs.existsSync(c.localLrcPath), false)
})

// ------------------------------------------------------------ 必须拒绝的情况

const mustRefuse = (name, prepare, expected) => {
  test(name, async(t) => {
    const c = await setup(prepare.opts)
    t.after(() => c.teardown())
    await prepare.arrange(c)

    await assert.rejects(c.cleanup(), expected ?? /./)
    assert.equal(c.localStillThere(), true, '拒绝清理时本地成品必须原样保留')
  })
}

mustRefuse('关联不到传输任务、云端也没有文件时拒绝清理', {
  opts: { copiedToMount: false },
  arrange: () => {},
}, /推迟/)

mustRefuse('云端条目还是 CD2 本地写缓存（isLocal=true）时拒绝清理', {
  arrange: c => { c.server.putCloudFile(c.destPath, { size: FILE_SIZE, isCloudFile: true, isLocal: true }) },
}, /推迟/)

mustRefuse('云端文件大小与本地不一致时拒绝清理', {
  arrange: c => {
    c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, transferedBytes: FILE_SIZE, statusEnum: UploadStatus.Finish })
    c.server.putCloudFile(c.destPath, { size: FILE_SIZE - 1, isCloudFile: true, isLocal: false })
  },
}, /推迟/)

mustRefuse('传输任务报错时拒绝清理', {
  arrange: c => {
    c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, statusEnum: UploadStatus.Error, errorMessage: 'upload failed' })
  },
}, /推迟/)

mustRefuse('传输任务仍在进行时拒绝清理', {
  arrange: c => {
    c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, transferedBytes: 1024, statusEnum: UploadStatus.Transfer })
  },
}, /推迟/)

mustRefuse('CD2 gRPC 不可用时拒绝清理', {
  arrange: async c => { await c.server.stop() },
})

mustRefuse('CD2 未就绪时拒绝清理', {
  arrange: c => { c.server.systemInfo.SystemReady = false },
})

mustRefuse('挂载点掉了时拒绝清理', {
  arrange: c => { c.server.mountPoints[0].isMounted = false },
})

mustRefuse('确认成功但云端目标文件随后消失时拒绝清理', {
  arrange: c => {
    c.markUploadedOk()
    fs.unlinkSync(c.cloudPath) // 挂载点上的文件没了
  },
}, /推迟/)

mustRefuse('本地有歌词但云端歌词缺失时拒绝清理（避免歌词丢失）', {
  opts: { withLrc: true, copiedLrcToMount: false },
  arrange: c => { c.markUploadedOk() },
}, /歌词/)

test('本地文件与云端目标是同一路径时拒绝清理（防止把云端文件删掉）', async(t) => {
  const server = await new MockCd2Server().start()
  const ws = makeWorkspace()
  t.after(async() => { await server.stop(); ws.cleanup() })
  server.mountPoints = [{ mountPoint: ws.mount, sourceDir: SOURCE_DIR, readOnly: false, isMounted: true, failReason: '' }]
  const samePath = ws.writeFile(ws.mount, FILE_NAME, FILE_SIZE)
  const destPath = `${SOURCE_DIR}/${FILE_NAME}`
  server.addUpload({ destPath, size: FILE_SIZE, transferedBytes: FILE_SIZE, statusEnum: UploadStatus.Finish })
  server.putCloudFile(destPath, { size: FILE_SIZE, isCloudFile: true, isLocal: false })
  const config = makeConfig({ cd2RootPath: ws.mount, cd2GrpcUrl: server.url })

  await assert.rejects(
    cd2.cleanupSubscriptionLocalFile({ config, localPath: samePath, cloudPath: samePath }),
    /拒绝清理/,
  )
  assert.equal(fs.existsSync(samePath), true)
})

// ------------------------------------------------- 旧版本云端文件清理的安全门

test('新版本云端文件不存在时，拒绝删除旧版本', async(t) => {
  const server = await new MockCd2Server().start()
  const ws = makeWorkspace()
  t.after(async() => { await server.stop(); ws.cleanup() })
  server.mountPoints = [{ mountPoint: ws.mount, sourceDir: SOURCE_DIR, readOnly: false, isMounted: true, failReason: '' }]
  const oldCloudPath = ws.writeFile(ws.mount, '达尔文 (Live) - 蔡健雅.mp3', 8 * 1024 * 1024)
  const cloudPath = path.join(ws.mount, FILE_NAME) // 新版本还没上传上去
  const config = makeConfig({ cd2RootPath: ws.mount, cd2GrpcUrl: server.url })

  await assert.rejects(
    cd2.removeSubscriptionOldCloudFile({ config, oldCloudPath, cloudPath }),
    /新版本云端文件不存在/,
  )
  assert.equal(fs.existsSync(oldCloudPath), true, '新版本没就位前旧版本必须保留')
})

test('新旧路径相同时拒绝删除', async(t) => {
  const server = await new MockCd2Server().start()
  const ws = makeWorkspace()
  t.after(async() => { await server.stop(); ws.cleanup() })
  server.mountPoints = [{ mountPoint: ws.mount, sourceDir: SOURCE_DIR, readOnly: false, isMounted: true, failReason: '' }]
  const samePath = ws.writeFile(ws.mount, FILE_NAME, FILE_SIZE)
  const config = makeConfig({ cd2RootPath: ws.mount, cd2GrpcUrl: server.url })

  await assert.rejects(
    cd2.removeSubscriptionOldCloudFile({ config, oldCloudPath: samePath, cloudPath: samePath }),
    /拒绝删除/,
  )
  assert.equal(fs.existsSync(samePath), true)
})

test('旧版本路径超出音乐库根目录时拒绝删除', async(t) => {
  const server = await new MockCd2Server().start()
  const ws = makeWorkspace()
  t.after(async() => { await server.stop(); ws.cleanup() })
  server.mountPoints = [{ mountPoint: ws.mount, sourceDir: SOURCE_DIR, readOnly: false, isMounted: true, failReason: '' }]
  const outsider = ws.writeFile(ws.download, 'unrelated.flac', 1024)
  const cloudPath = ws.writeFile(ws.mount, FILE_NAME, FILE_SIZE)
  const config = makeConfig({ cd2RootPath: ws.mount, cd2GrpcUrl: server.url })

  await assert.rejects(
    cd2.removeSubscriptionOldCloudFile({ config, oldCloudPath: outsider, cloudPath }),
    /超出/,
  )
  assert.equal(fs.existsSync(outsider), true)
})

test('新版本就位后才删除旧版本，并连带删除旧歌词', async(t) => {
  const server = await new MockCd2Server().start()
  const ws = makeWorkspace()
  t.after(async() => { await server.stop(); ws.cleanup() })
  server.mountPoints = [{ mountPoint: ws.mount, sourceDir: SOURCE_DIR, readOnly: false, isMounted: true, failReason: '' }]
  const oldCloudPath = ws.writeFile(ws.mount, '达尔文 (Live) - 蔡健雅.mp3', 8 * 1024 * 1024)
  const oldLrcPath = ws.writeFile(ws.mount, '达尔文 (Live) - 蔡健雅.lrc', 2048)
  const cloudPath = ws.writeFile(ws.mount, FILE_NAME, FILE_SIZE)
  const config = makeConfig({ cd2RootPath: ws.mount, cd2GrpcUrl: server.url })

  await cd2.removeSubscriptionOldCloudFile({ config, oldCloudPath, cloudPath })
  assert.equal(fs.existsSync(oldCloudPath), false)
  assert.equal(fs.existsSync(cloudPath), true, '新版本必须保留')
  // 新旧扩展名不同，旧歌词路径与新歌词路径同名，不应被误删
  assert.equal(fs.existsSync(oldLrcPath), true, '同名歌词属于新版本，不能删')
})
