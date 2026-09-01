'use strict'
// 搭建一个「假的 CD2 挂载点」目录 + 一个本地下载目录，模拟 F:\ 挂载与 LX 下载目录
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const makeWorkspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-cd2-test-'))
  const mount = path.join(root, 'mount')      // 相当于 F:\
  const download = path.join(root, 'download') // 相当于 LX 下载目录
  fs.mkdirSync(mount, { recursive: true })
  fs.mkdirSync(download, { recursive: true })
  return {
    root,
    mount,
    download,
    /** 写一个指定字节数的假音频文件，返回路径 */
    writeFile(dir, name, bytes) {
      const file = path.join(dir, name)
      fs.writeFileSync(file, Buffer.alloc(bytes, 7))
      return file
    },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }) },
  }
}

/** 生成被测代码需要的 Subscription.Config */
const makeConfig = (overrides = {}) => ({
  stopQuality: 'flac',
  cd2RootPath: '',
  cd2LocalMountPath: '',
  cd2ApiMountPoint: '',
  cd2GrpcUrl: '',
  cd2ApiToken: 'mock-token',
  syncToCd2: true,
  diskThresholdBytes: 30 * 1024 ** 3,
  diskLocked: false,
  diskPausedAt: null,
  ...overrides,
})

module.exports = { makeWorkspace, makeConfig }
