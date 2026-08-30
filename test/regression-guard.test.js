'use strict'
/**
 * 变异测试：证明上面那套断言真的能抓住修复前的行为。
 *
 * 做法是从真实的 cd2.ts 源码出发，把两处关键逻辑改回修复前的写法，单独编译一份，
 * 然后断言这份「旧版本」确实表现出 bug。如果哪天有人把修复删了，这里会先炸。
 * 锚点匹配失败也会报错，避免源码结构变了之后这个测试悄悄失效。
 *
 *   node --test test/regression-guard.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { compileStandalone, repoRoot } = require('./helpers/compile')
const { MockCd2Server, UploadStatus } = require('./helpers/mock-cd2')
const { makeWorkspace, makeConfig } = require('./helpers/env')

const SOURCE_DIR = '/115/music'
const FILE_NAME = '普通的日子 - 魏如萱.flac'
const FILE_SIZE = 40 * 1024 * 1024

/** 按起止锚点整段替换，并断言锚点唯一命中 */
const replaceBlock = (source, startAnchor, endAnchor, replacement, label) => {
  const start = source.indexOf(startAnchor)
  assert.notEqual(start, -1, `变异锚点失效（${label} 起点）：源码结构已改变，请更新本测试`)
  assert.equal(source.indexOf(startAnchor, start + 1), -1, `变异锚点不唯一（${label} 起点）`)
  const endFrom = source.indexOf(endAnchor, start)
  assert.notEqual(endFrom, -1, `变异锚点失效（${label} 终点）`)
  return source.slice(0, start) + replacement + source.slice(endFrom + endAnchor.length)
}

/** 生成「修复前」的 cd2 模块 */
const buildLegacyModule = () => {
  const sourcePath = path.join(repoRoot, 'src/main/modules/subscription/cd2.ts')
  let source = fs.readFileSync(sourcePath, 'utf8')

  // 变异 1：恢复「先按大小过滤、再从结果里找 destPath 精确匹配」的旧顺序
  source = replaceBlock(
    source,
    '    const exactMatches = uploadFiles.filter(',
    'sizeMatches.length == 1 ? sizeMatches : []',
    [
      '    const sizeMatches = uploadFiles.filter(item => !localStat || Number(item.size) == localStat.size)',
      '    const exactMatches = sizeMatches.filter(item => normalizeRemotePath(item.destPath) == expectedDestPath)',
      '    const candidates = exactMatches.length ? exactMatches : sizeMatches.length == 1 ? sizeMatches : []',
    ].join('\n'),
    '匹配顺序',
  )

  // 变异 2：去掉关联不上时的云端兜底校验
  source = replaceBlock(
    source,
    '    if (!candidates.length) {',
    "          : '尚未关联到对应的 CloudDrive2 上传任务，云端文件也尚未就绪，继续等待确认',\n      }\n    }",
    "    if (!candidates.length) return { state: 'unconfirmed', progress: 0, message: '尚未关联到对应的 CloudDrive2 上传任务' }",
    '云端兜底',
  )

  // 变异 3：把 Skipped 退回「一律算失败」，取消它的云端校验分支
  source = replaceBlock(
    source,
    'const UPLOAD_SKIPPED_STATUS = 6',
    'const UPLOAD_FAILED_STATUS = [2, 8, 9, 10]',
    [
      'const UPLOAD_SKIPPED_STATUS = -1 // 变异：让 Skipped 分支不可达',
      'const UPLOAD_FAILED_STATUS = [2, 6, 8, 9, 10]',
    ].join('\n'),
    'Skipped 判定',
  )

  return require(compileStandalone('cd2-legacy', source))
}

const setup = async(legacy, opts = {}) => {
  const server = await new MockCd2Server().start()
  const ws = makeWorkspace()
  server.mountPoints = [{ mountPoint: ws.mount, sourceDir: SOURCE_DIR, readOnly: false, isMounted: true, failReason: '' }]
  const localPath = ws.writeFile(ws.download, FILE_NAME, FILE_SIZE)
  const cloudPath = path.join(ws.mount, FILE_NAME)
  if (opts.copiedToMount !== false) fs.copyFileSync(localPath, cloudPath)
  const config = makeConfig({ cd2RootPath: ws.mount, cd2GrpcUrl: server.url })
  return {
    server,
    destPath: `${SOURCE_DIR}/${FILE_NAME}`,
    status: () => legacy.getSubscriptionCd2UploadStatus({ config, localPath, cloudPath }),
    async teardown() { await server.stop(); ws.cleanup() },
  }
}

test('变异版本可以正常构建（锚点仍然有效）', () => {
  const legacy = buildLegacyModule()
  assert.equal(typeof legacy.getSubscriptionCd2UploadStatus, 'function')
})

test('旧顺序确实会把 size=0 的预处理任务误判为「未关联」', async(t) => {
  const legacy = buildLegacyModule()
  const c = await setup(legacy)
  t.after(() => c.teardown())
  c.server.addUpload({ destPath: c.destPath, size: 0, transferedBytes: 0, statusEnum: UploadStatus.Preprocessing })

  const result = await c.status()
  assert.equal(result.state, 'unconfirmed', '旧代码在这里就是关联不上——正是界面显示「尚未关联到对应的 CloudDrive2 上传任务」的来源')
})

test('旧版本在传输任务被清出列表后拿不到成功结论（会被上层计时器判成 failed）', async(t) => {
  const legacy = buildLegacyModule()
  const c = await setup(legacy)
  t.after(() => c.teardown())
  c.server.putCloudFile(c.destPath, { size: FILE_SIZE, isCloudFile: true, isLocal: false })

  const result = await c.status()
  assert.equal(result.state, 'unconfirmed', '云端文件明明已经在了，旧代码却确认不了')
})

test('旧版本会把 Skipped（秒传成功）一律判成失败', async(t) => {
  const legacy = buildLegacyModule()
  const c = await setup(legacy)
  t.after(() => c.teardown())
  c.server.addUpload({ destPath: c.destPath, size: FILE_SIZE, statusEnum: UploadStatus.Skipped })
  c.server.putCloudFile(c.destPath, { size: FILE_SIZE, isCloudFile: true, isLocal: false })

  const result = await c.status()
  assert.equal(result.state, 'failed')
})
