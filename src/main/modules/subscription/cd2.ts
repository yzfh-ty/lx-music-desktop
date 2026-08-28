import fs from 'node:fs'
import path from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

interface CloudDriveSystemInfo {
  IsLogin: boolean
  SystemReady: boolean
  SystemMessage?: string
  hasError?: boolean
}

interface TokenInfo {
  token: string
  permissions?: {
    allow_get_mounts?: boolean
    allow_get_transfer_tasks?: boolean
  }
}

interface MountPoint {
  mountPoint: string
  sourceDir: string
  readOnly: boolean
  isMounted: boolean
  failReason: string
}

interface UploadFileInfo {
  key: string
  destPath: string
  size: number | string
  transferedBytes: number | string
  status: string
  errorMessage: string
  operatorType: number
  statusEnum: number
}

interface Cd2Client extends grpc.Client {
  getSystemInfo: (
    request: Record<string, never>,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: (error: grpc.ServiceError | null, result: CloudDriveSystemInfo) => void
  ) => grpc.ClientUnaryCall
  getApiTokenInfo: (
    request: { value: string },
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: (error: grpc.ServiceError | null, result: TokenInfo) => void
  ) => grpc.ClientUnaryCall
  getMountPoints: (
    request: Record<string, never>,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: (error: grpc.ServiceError | null, result: { mountPoints: MountPoint[] }) => void
  ) => grpc.ClientUnaryCall
  getUploadFileList: (
    request: { getAll: boolean, itemsPerPage: number, pageNumber: number, filter: string },
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: (error: grpc.ServiceError | null, result: { uploadFiles: UploadFileInfo[] }) => void
  ) => grpc.ClientUnaryCall
}

interface MountedRoot {
  mount: MountPoint
  mountPath: string
  rootPath: string
}

const timeout = 8_000
const protoPath = process.env.NODE_ENV == 'production'
  ? path.join(__dirname, 'clouddrive.proto')
  : path.join(__dirname, '../src/main/modules/clouddrive.proto')

const parseAddress = (input: string) => {
  const value = input.trim()
  if (!value) throw new Error('请先设置 CD2 gRPC 地址')
  const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`)
  if (!url.hostname || !url.port) throw new Error('CD2 gRPC 地址必须包含主机和端口')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  return {
    address: hostname.includes(':') ? `[${hostname}]:${url.port}` : `${hostname}:${url.port}`,
    secure: url.protocol == 'https:',
  }
}

const createClient = (grpcUrl: string): Cd2Client => {
  const definition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: Number,
    enums: Number,
    defaults: true,
    oneofs: true,
  })
  const loaded = grpc.loadPackageDefinition(definition) as unknown as {
    clouddrive: { CloudDriveFileSrv: grpc.ServiceClientConstructor }
  }
  const { address, secure } = parseAddress(grpcUrl)
  return new loaded.clouddrive.CloudDriveFileSrv(
    address,
    secure ? grpc.credentials.createSsl() : grpc.credentials.createInsecure(),
  ) as unknown as Cd2Client
}

const metadataFor = (token: string) => {
  const metadata = new grpc.Metadata()
  metadata.set('Authorization', `Bearer ${token}`)
  return metadata
}

const call = async<T>(executor: (callback: (error: grpc.ServiceError | null, result: T) => void) => grpc.ClientUnaryCall) => {
  return new Promise<T>((resolve, reject) => {
    executor((error, result) => { error ? reject(error) : resolve(result) })
  })
}

const normalizeMountPath = (input: string) => {
  const value = input.trim()
  return path.resolve(/^[a-z]:$/i.test(value) ? `${value}${path.sep}` : value)
}

const comparablePath = (input: string) => {
  const resolved = path.resolve(input).replace(/[\\/]+$/, '')
  return process.platform == 'win32' ? resolved.toLowerCase() : resolved
}

const isWithin = (parent: string, child: string) => {
  const parentPath = comparablePath(parent)
  const childPath = comparablePath(child)
  return childPath == parentPath || childPath.startsWith(`${parentPath}${path.sep}`)
}

const findMountedRoot = (rootPath: string, mountPoints: MountPoint[]): MountedRoot => {
  const resolvedRoot = path.resolve(rootPath)
  const matches = mountPoints
    .filter(mount => mount.isMounted && !mount.readOnly && mount.mountPoint && isWithin(normalizeMountPath(mount.mountPoint), resolvedRoot))
    .sort((a, b) => normalizeMountPath(b.mountPoint).length - normalizeMountPath(a.mountPoint).length)
  const mount = matches[0]
  if (!mount) {
    const failed = mountPoints.find(item => item.mountPoint && isWithin(normalizeMountPath(item.mountPoint), resolvedRoot))
    if (failed?.readOnly) throw new Error('CD2 音乐库所在挂载点是只读的')
    if (failed && !failed.isMounted) throw new Error(`CD2 挂载点未就绪：${failed.failReason || failed.mountPoint}`)
    throw new Error('CD2 音乐库根目录不属于已挂载且可写的 CD2 挂载点')
  }
  return { mount, mountPath: normalizeMountPath(mount.mountPoint), rootPath: resolvedRoot }
}

const checkConnection = async(config: LX.Subscription.Config) => {
  if (!config.cd2ApiToken.trim()) throw new Error('请先设置 CD2 API Token')
  if (!config.cd2RootPath.trim()) throw new Error('请先设置 CD2 音乐库根目录')
  const client = createClient(config.cd2GrpcUrl)
  const emptyMetadata = new grpc.Metadata()
  const options = { deadline: Date.now() + timeout }
  try {
    const system = await call<CloudDriveSystemInfo>(callback => client.getSystemInfo({}, emptyMetadata, options, callback))
    if (!system.IsLogin) throw new Error('CD2 尚未登录')
    if (!system.SystemReady || system.hasError) throw new Error(`CD2 尚未就绪${system.SystemMessage ? `：${system.SystemMessage}` : ''}`)
    const token = await call<TokenInfo>(callback => client.getApiTokenInfo(
      { value: config.cd2ApiToken.trim() }, emptyMetadata, options, callback,
    ))
    if (!token.token) throw new Error('CD2 API Token 无效')
    if (token.permissions?.allow_get_mounts === false) throw new Error('CD2 API Token 缺少读取挂载点权限')
    if (token.permissions?.allow_get_transfer_tasks === false) throw new Error('CD2 API Token 缺少读取上传任务权限')
    const metadata = metadataFor(config.cd2ApiToken.trim())
    const result = await call<{ mountPoints: MountPoint[] }>(callback => client.getMountPoints({}, metadata, options, callback))
    const mountedRoot = findMountedRoot(config.cd2RootPath, result.mountPoints)
    const rootStat = await fs.promises.stat(mountedRoot.rootPath).catch(() => null)
    if (!rootStat?.isDirectory()) throw new Error('CD2 音乐库根目录不存在或不是目录')
    await fs.promises.access(mountedRoot.rootPath, fs.constants.R_OK | fs.constants.W_OK)
    return { client, metadata, options, mountedRoot }
  } catch (error) {
    client.close()
    throw error
  }
}

const toRemotePath = (mountedRoot: MountedRoot, targetPath: string) => {
  const relativePath = path.relative(mountedRoot.mountPath, targetPath).split(path.sep).join('/')
  return `${mountedRoot.mount.sourceDir.replace(/\/+$/, '')}/${relativePath}`.replace(/\/{2,}/g, '/')
}

const normalizeRemotePath = (input: string) => input.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '').toLowerCase()
const lrcPathFor = (input: string) => input.replace(/\.[^.\\/]+$/, '.lrc')

export const checkSubscriptionCd2Health = async(config: LX.Subscription.Config): Promise<LX.Subscription.Cd2Health> => {
  const connection = await checkConnection(config)
  try {
    return {
      rootPath: connection.mountedRoot.rootPath,
      mountPath: connection.mountedRoot.mountPath,
      sourceDir: connection.mountedRoot.mount.sourceDir,
      writable: true,
    }
  } finally {
    connection.client.close()
  }
}

export const copySubscriptionFileToCd2 = async(input: {
  config: LX.Subscription.Config
  localPath: string
  currentCloudPath: string | null
  retryCloudPath?: string | null
}): Promise<LX.Subscription.Cd2CopyResult> => {
  const localPath = path.resolve(input.localPath)
  const localStat = await fs.promises.stat(localPath).catch(() => null)
  if (!localStat?.isFile()) throw new Error('待上传的本地音频不存在')
  const connection = await checkConnection(input.config)
  try {
    if (isWithin(connection.mountedRoot.mountPath, localPath)) {
      throw new Error('LX Music 下载目录不能位于 CD2 挂载点内')
    }
    const currentPath = input.currentCloudPath ? path.resolve(input.currentCloudPath) : null
    if (currentPath && !isWithin(connection.mountedRoot.rootPath, currentPath)) {
      throw new Error('数据库中的现有云端路径超出当前 CD2 音乐库根目录')
    }
    const retryPath = input.retryCloudPath ? path.resolve(input.retryCloudPath) : null
    if (retryPath && !isWithin(connection.mountedRoot.rootPath, retryPath)) {
      throw new Error('待重试的 CD2 目标路径超出音乐库根目录')
    }
    const retryName = retryPath ? path.basename(retryPath) : ''
    const localName = path.basename(localPath)
    if (retryPath && (process.platform == 'win32' ? retryName.toLowerCase() != localName.toLowerCase() : retryName != localName)) {
      throw new Error('待重试的 CD2 目标文件名与本地成品不一致')
    }
    const sameExtension = currentPath && path.extname(currentPath).toLowerCase() == path.extname(localPath).toLowerCase()
    const cloudPath = sameExtension ? currentPath : retryPath ?? path.join(connection.mountedRoot.rootPath, path.basename(localPath))
    if (!isWithin(connection.mountedRoot.rootPath, cloudPath)) throw new Error('目标云端路径超出 CD2 音乐库根目录')
    if (!sameExtension) {
      const existingTarget = await fs.promises.stat(cloudPath).catch(() => null)
      const isKnownRetryTarget = retryPath && comparablePath(retryPath) == comparablePath(cloudPath)
      if (existingTarget && !isKnownRetryTarget) throw new Error('CD2 目标路径已存在且不属于当前歌曲记录，拒绝覆盖')
    }
    const localLrcPath = lrcPathFor(localPath)
    const cloudLrcPath = lrcPathFor(cloudPath)
    const currentLrcPath = currentPath ? lrcPathFor(currentPath) : null
    const localLrc = await fs.promises.stat(localLrcPath).catch(() => null)
    if (localLrc?.isFile()) {
      const existingCloudLrc = await fs.promises.stat(cloudLrcPath).catch(() => null)
      const belongsToCurrentSong = currentLrcPath && comparablePath(currentLrcPath) == comparablePath(cloudLrcPath)
      if (existingCloudLrc && !belongsToCurrentSong) throw new Error('CD2 目标歌词路径已存在且不属于当前歌曲记录，拒绝覆盖')
      await fs.promises.copyFile(localLrcPath, cloudLrcPath)
    }
    try {
      await fs.promises.copyFile(localPath, cloudPath)
    } catch (error) {
      if (localLrc?.isFile() && (!currentLrcPath || comparablePath(currentLrcPath) != comparablePath(cloudLrcPath))) {
        await fs.promises.unlink(cloudLrcPath).catch(() => {})
      }
      throw error
    }
    return {
      cloudPath,
      oldCloudPath: currentPath && comparablePath(currentPath) != comparablePath(cloudPath) ? currentPath : null,
      expectedDestPath: toRemotePath(connection.mountedRoot, cloudPath),
      copiedAt: Date.now(),
    }
  } finally {
    connection.client.close()
  }
}

export const getSubscriptionCd2UploadStatus = async(input: {
  config: LX.Subscription.Config
  localPath: string
  cloudPath: string
}): Promise<LX.Subscription.Cd2UploadStatus> => {
  const cloudPath = path.resolve(input.cloudPath)
  const connection = await checkConnection(input.config)
  try {
    if (!isWithin(connection.mountedRoot.rootPath, cloudPath)) throw new Error('目标云端路径超出 CD2 音乐库根目录')
    const expectedDestPath = normalizeRemotePath(toRemotePath(connection.mountedRoot, cloudPath))
    const localStat = await fs.promises.stat(input.localPath).catch(() => null)
    const result = await call<{ uploadFiles: UploadFileInfo[] }>(callback => connection.client.getUploadFileList({
      getAll: true,
      itemsPerPage: 200,
      pageNumber: 1,
      filter: path.basename(cloudPath),
    }, connection.metadata, connection.options, callback))
    const sizeMatches = result.uploadFiles.filter(item => !localStat || Number(item.size) == localStat.size)
    const exactMatches = sizeMatches.filter(item => normalizeRemotePath(item.destPath) == expectedDestPath)
    const candidates = exactMatches.length ? exactMatches : sizeMatches.length == 1 ? sizeMatches : []
    if (!candidates.length) return { state: 'missing', progress: 0, message: '尚未关联到对应的 CD2 上传任务' }
    const active = candidates.filter(item => [0, 1, 3, 4, 7].includes(item.statusEnum))
    if (active.length > 1) return { state: 'missing', progress: 0, message: '关联到多个仍在运行的 CD2 上传任务，暂不确认' }
    const terminalGroups = new Set(candidates.map(item => item.statusEnum == 5 ? 'success' : 'failed'))
    if (!active.length && terminalGroups.size > 1) {
      return { state: 'missing', progress: 0, message: '关联到状态冲突的多个 CD2 上传任务，暂不确认' }
    }
    const upload = active[0] ?? candidates[0]
    const size = Number(upload.size)
    const progress = size > 0 ? Math.min(100, Number(upload.transferedBytes) / size * 100) : 0
    if (upload.statusEnum == 5) {
      const cloudStat = await fs.promises.stat(cloudPath).catch(() => null)
      if (!cloudStat?.isFile()) return { state: 'missing', progress: 100, message: 'CD2 上传任务已完成，但目标文件不存在' }
      return { state: 'success', progress: 100, message: upload.status || 'Finish' }
    }
    if ([2, 6, 8, 9, 10].includes(upload.statusEnum)) {
      return { state: 'failed', progress, message: upload.errorMessage || upload.status || 'CD2 上传任务失败' }
    }
    return { state: 'running', progress, message: upload.status || 'CD2 正在上传' }
  } finally {
    connection.client.close()
  }
}

export const cleanupSubscriptionLocalFile = async(input: {
  config: LX.Subscription.Config
  localPath: string
  cloudPath: string
}): Promise<void> => {
  const status = await getSubscriptionCd2UploadStatus(input)
  if (status.state != 'success') throw new Error(`延迟清理已推迟：${status.message}`)
  const localPath = path.resolve(input.localPath)
  const cloudPath = path.resolve(input.cloudPath)
  if (comparablePath(localPath) == comparablePath(cloudPath)) throw new Error('本地文件与 CD2 目标路径相同，拒绝清理')
  const cloudStat = await fs.promises.stat(cloudPath).catch(() => null)
  if (!cloudStat?.isFile()) throw new Error('延迟清理已推迟：CD2 目标文件不存在')
  const localLrcPath = lrcPathFor(localPath)
  const localLrc = await fs.promises.stat(localLrcPath).catch(() => null)
  if (localLrc?.isFile()) {
    const cloudLrc = await fs.promises.stat(lrcPathFor(cloudPath)).catch(() => null)
    if (!cloudLrc?.isFile()) throw new Error('延迟清理已推迟：CD2 目标歌词文件不存在')
  }
  await fs.promises.unlink(localPath).catch(error => {
    if ((error as NodeJS.ErrnoException).code != 'ENOENT') throw error
  })
  if (localLrc?.isFile()) {
    await fs.promises.unlink(localLrcPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code != 'ENOENT') throw error
    })
  }
}

export const removeSubscriptionOldCloudFile = async(input: {
  config: LX.Subscription.Config
  oldCloudPath: string
  cloudPath: string
}): Promise<void> => {
  const connection = await checkConnection(input.config)
  try {
    const oldCloudPath = path.resolve(input.oldCloudPath)
    const cloudPath = path.resolve(input.cloudPath)
    if (!isWithin(connection.mountedRoot.rootPath, oldCloudPath)) throw new Error('旧版本路径超出 CD2 音乐库根目录')
    if (comparablePath(oldCloudPath) == comparablePath(cloudPath)) throw new Error('旧版本路径与新版本路径相同，拒绝删除')
    const cloudStat = await fs.promises.stat(cloudPath).catch(() => null)
    if (!cloudStat?.isFile()) throw new Error('新版本云端文件不存在，拒绝删除旧版本')
    await fs.promises.unlink(oldCloudPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code != 'ENOENT') throw error
    })
    const oldLrcPath = lrcPathFor(oldCloudPath)
    const newLrcPath = lrcPathFor(cloudPath)
    if (comparablePath(oldLrcPath) != comparablePath(newLrcPath)) {
      await fs.promises.unlink(oldLrcPath).catch(error => {
        if ((error as NodeJS.ErrnoException).code != 'ENOENT') throw error
      })
    }
  } finally {
    connection.client.close()
  }
}
