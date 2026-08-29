'use strict'
/**
 * 假的 CloudDrive2 gRPC 服务。
 * 用的是仓库里同一份 clouddrive.proto，所以被测代码走的是真实的 gRPC 序列化链路，
 * 只有服务端的返回内容是我们编排的。
 */
const path = require('node:path')
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')

const repoRoot = path.resolve(__dirname, '../..')
const protoPath = path.join(repoRoot, 'src/main/modules/clouddrive.proto')

const definition = protoLoader.loadSync(protoPath, {
  keepCase: true, longs: Number, enums: Number, defaults: true, oneofs: true,
})
const proto = grpc.loadPackageDefinition(definition)

/** UploadFileInfo.Status */
const UploadStatus = {
  WaitforPreprocessing: 0,
  Preprocessing: 1,
  Cancelled: 2,
  Transfer: 3,
  Pause: 4,
  Finish: 5,
  Skipped: 6,
  Inqueue: 7,
  Ignored: 8,
  Error: 9,
  FatalError: 10,
}

const defaultPermissions = {
  allow_list: true,
  allow_get_mounts: true,
  allow_get_transfer_tasks: true,
}

class MockCd2Server {
  constructor() {
    this.reset()
    this.calls = []
  }

  reset() {
    this.systemInfo = { IsLogin: true, SystemReady: true, SystemMessage: '', hasError: false }
    this.tokenInfo = { token: 'mock-token', permissions: { ...defaultPermissions } }
    this.mountPoints = []
    this.uploadFiles = []
    /** key: 规范化后的云端路径 -> CloudDriveFile 片段 */
    this.cloudFiles = new Map()
    /** 让某个方法直接返回 gRPC 错误，用于模拟权限/网络问题 */
    this.errors = {}
    this.calls = []
  }

  /** 登记一个"已经在云端"的文件 */
  putCloudFile(fullPathName, { size, isCloudFile = true, isLocal = false, isDirectory = false } = {}) {
    this.cloudFiles.set(normalize(fullPathName), {
      id: fullPathName,
      name: fullPathName.split('/').pop(),
      fullPathName,
      size,
      isDirectory,
      isCloudFile,
      isLocal,
      fileType: isDirectory ? 0 : 1,
    })
  }

  addUpload({ destPath, size, transferedBytes = 0, statusEnum = UploadStatus.Transfer, status = '', errorMessage = '' }) {
    this.uploadFiles.push({
      key: `${destPath}#${this.uploadFiles.length}`,
      destPath,
      size,
      transferedBytes,
      status: status || Object.keys(UploadStatus).find(k => UploadStatus[k] == statusEnum),
      errorMessage,
      operatorType: 0,
      statusEnum,
    })
  }

  _handlers() {
    const record = (name, req) => { this.calls.push({ name, req }) }
    const fail = name => {
      const err = this.errors[name]
      if (!err) return null
      return { code: err.code ?? grpc.status.PERMISSION_DENIED, details: err.details ?? 'mock error' }
    }
    return {
      GetSystemInfo: (call, cb) => {
        record('GetSystemInfo', call.request)
        const e = fail('GetSystemInfo'); if (e) return cb(e)
        cb(null, this.systemInfo)
      },
      GetApiTokenInfo: (call, cb) => {
        record('GetApiTokenInfo', call.request)
        const e = fail('GetApiTokenInfo'); if (e) return cb(e)
        cb(null, this.tokenInfo)
      },
      GetMountPoints: (call, cb) => {
        record('GetMountPoints', call.request)
        const e = fail('GetMountPoints'); if (e) return cb(e)
        cb(null, { mountPoints: this.mountPoints })
      },
      GetUploadFileList: (call, cb) => {
        record('GetUploadFileList', call.request)
        const e = fail('GetUploadFileList'); if (e) return cb(e)
        // 真实 CD2 的 filter 是对文件名做包含匹配，这里照做
        const filter = call.request.filter || ''
        const uploadFiles = filter
          ? this.uploadFiles.filter(f => f.destPath.toLowerCase().includes(filter.toLowerCase()))
          : this.uploadFiles.slice()
        cb(null, {
          totalCount: this.uploadFiles.length,
          uploadFiles,
          globalBytesPerSecond: 0,
          totalBytes: 0,
          finishedBytes: 0,
          totalCountFiltered: uploadFiles.length,
        })
      },
      FindFileByPath: (call, cb) => {
        record('FindFileByPath', call.request)
        const e = fail('FindFileByPath'); if (e) return cb(e)
        const { parentPath, path: p } = call.request
        const full = parentPath ? `${parentPath.replace(/\/$/, '')}/${p}` : p
        const file = this.cloudFiles.get(normalize(full))
        if (!file) return cb({ code: grpc.status.NOT_FOUND, details: 'file not found' })
        cb(null, file)
      },
    }
  }

  async start() {
    const handlers = this._handlers()
    const impl = {}
    // grpc-js 按 proto 中的方法名查找实现，同时补上 lowerCamelCase 别名
    for (const [name, fn] of Object.entries(handlers)) {
      impl[name] = fn
      impl[name[0].toLowerCase() + name.slice(1)] = fn
    }
    this.server = new grpc.Server()
    this.server.addService(proto.clouddrive.CloudDriveFileSrv.service, impl)
    this.port = await new Promise((resolve, reject) => {
      this.server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => {
        err ? reject(err) : resolve(port)
      })
    })
    this.url = `http://127.0.0.1:${this.port}`
    return this
  }

  async stop() {
    if (!this.server) return
    await new Promise(resolve => { this.server.tryShutdown(() => resolve()) })
    this.server = null
  }
}

const normalize = p => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '').toLowerCase()

module.exports = { MockCd2Server, UploadStatus, normalize }
