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

interface TokenPermissions {
  allow_list?: boolean
  allow_get_mounts?: boolean
  allow_get_transfer_tasks?: boolean
}

interface TokenInfo {
  token: string
  permissions?: TokenPermissions
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

interface CloudDriveFile {
  name: string
  fullPathName: string
  size: number | string
  isDirectory: boolean
  isCloudFile: boolean
  isLocal: boolean
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
  findFileByPath: (
    request: { parentPath: string, path: string },
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: (error: grpc.ServiceError | null, result: CloudDriveFile) => void
  ) => grpc.ClientUnaryCall
}

interface MountedRoot {
  mount: MountPoint
  /** LX Music 当前进程可访问的本机挂载根目录 */
  mountPath: string
  /** CloudDrive2 服务端（可能位于 Docker 内）返回的挂载点 */
  apiMountPoint: string
  rootPath: string
}

const timeout = 8_000
const protoPath = process.env.NODE_ENV == 'production'
  ? path.join(__dirname, 'clouddrive.proto')
  : path.join(__dirname, '../src/main/modules/clouddrive.proto')

const parseAddress = (input: string) => {
  const value = input.trim()
  if (!value) throw new Error('请先设置 CloudDrive2 gRPC 地址')
  const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`)
  if (!url.hostname || !url.port) throw new Error('CloudDrive2 gRPC 地址必须包含主机和端口')
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

const comparableApiMountPoint = (input: string) => {
  const normalized = input.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
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

const assertUsableMount = (mount: MountPoint) => {
  if (mount.readOnly) throw new Error('CloudDrive2 音乐库所在挂载点是只读的')
  if (!mount.isMounted) throw new Error(`CloudDrive2 挂载点未就绪：${mount.failReason || mount.mountPoint}`)
}

const findMountedRoot = (
  rootPath: string,
  mountPoints: MountPoint[],
  localMountPath = '',
  apiMountPoint = '',
): MountedRoot => {
  const resolvedRoot = path.resolve(rootPath)
  const hasLocalMapping = !!localMountPath.trim()
  const hasApiMapping = !!apiMountPoint.trim()
  if (hasLocalMapping != hasApiMapping) {
    throw new Error('Docker 路径映射需要同时设置本机挂载根目录和 CloudDrive2 API 挂载点')
  }
  if (hasLocalMapping) {
    const resolvedLocalMount = normalizeMountPath(localMountPath)
    if (!isWithin(resolvedLocalMount, resolvedRoot)) {
      throw new Error('CloudDrive2 音乐库根目录必须位于本机挂载根目录内')
    }
    const expectedApiMount = comparableApiMountPoint(apiMountPoint)
    const mount = mountPoints.find(item => item.mountPoint && comparableApiMountPoint(item.mountPoint) == expectedApiMount)
    if (!mount) throw new Error(`CloudDrive2 API 未返回配置的挂载点：${apiMountPoint.trim()}`)
    assertUsableMount(mount)
    return {
      mount,
      mountPath: resolvedLocalMount,
      apiMountPoint: mount.mountPoint,
      rootPath: resolvedRoot,
    }
  }
  const matches = mountPoints
    .filter(mount => mount.isMounted && !mount.readOnly && mount.mountPoint && isWithin(normalizeMountPath(mount.mountPoint), resolvedRoot))
    .sort((a, b) => normalizeMountPath(b.mountPoint).length - normalizeMountPath(a.mountPoint).length)
  const mount = matches[0]
  if (!mount) {
    const failed = mountPoints.find(item => item.mountPoint && isWithin(normalizeMountPath(item.mountPoint), resolvedRoot))
    if (failed) assertUsableMount(failed)
    throw new Error('CloudDrive2 音乐库根目录不属于已挂载且可写的 CloudDrive2 挂载点')
  }
  return {
    mount,
    mountPath: normalizeMountPath(mount.mountPoint),
    apiMountPoint: mount.mountPoint,
    rootPath: resolvedRoot,
  }
}

const checkConnection = async(config: LX.Subscription.Config) => {
  if (!config.cd2ApiToken.trim()) throw new Error('请先设置 CloudDrive2 API Token')
  if (!config.cd2RootPath.trim()) throw new Error('请先设置 CloudDrive2 音乐库根目录')
  const client = createClient(config.cd2GrpcUrl)
  const emptyMetadata = new grpc.Metadata()
  const options = { deadline: Date.now() + timeout }
  try {
    const system = await call<CloudDriveSystemInfo>(callback => client.getSystemInfo({}, emptyMetadata, options, callback))
    if (!system.IsLogin) throw new Error('CloudDrive2 尚未登录')
    if (!system.SystemReady || system.hasError) throw new Error(`CloudDrive2 尚未就绪${system.SystemMessage ? `：${system.SystemMessage}` : ''}`)
    const token = await call<TokenInfo>(callback => client.getApiTokenInfo(
      { value: config.cd2ApiToken.trim() }, emptyMetadata, options, callback,
    ))
    if (!token.token) throw new Error('CloudDrive2 API Token 无效')
    if (token.permissions?.allow_get_mounts === false) throw new Error('CloudDrive2 API Token 缺少读取挂载点权限')
    if (token.permissions?.allow_get_transfer_tasks === false) throw new Error('CloudDrive2 API Token 缺少读取上传任务权限')
    const metadata = metadataFor(config.cd2ApiToken.trim())
    const result = await call<{ mountPoints: MountPoint[] }>(callback => client.getMountPoints({}, metadata, options, callback))
    const mountedRoot = findMountedRoot(
      config.cd2RootPath,
      result.mountPoints,
      config.cd2LocalMountPath,
      config.cd2ApiMountPoint,
    )
    const rootStat = await fs.promises.stat(mountedRoot.rootPath).catch(() => null)
    if (!rootStat?.isDirectory()) throw new Error('CloudDrive2 音乐库根目录不存在或不是目录')
    await fs.promises.access(mountedRoot.rootPath, fs.constants.R_OK | fs.constants.W_OK)
    return { client, metadata, options, mountedRoot, permissions: token.permissions }
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

// UploadFileInfo.Status
const UPLOAD_ACTIVE_STATUS = [0, 1, 3, 4, 7] // WaitforPreprocessing / Preprocessing / Transfer / Pause / Inqueue
const UPLOAD_SUCCESS_STATUS = 5 // Finish
const UPLOAD_SKIPPED_STATUS = 6 // Skipped：目标已存在或秒传，需要另行校验云端文件才能下结论
const UPLOAD_FAILED_STATUS = [2, 8, 9, 10] // Cancelled / Ignored / Error / FatalError

type Cd2Connection = Awaited<ReturnType<typeof checkConnection>>

/**
 * 通过 gRPC 直接查询云端文件本身。
 * CloudDrive2 在传输任务结束后会把它移出上传列表，所以「关联不到传输任务」不能等同于上传失败，
 * 必须再向云端确认一次文件是否真的存在且大小一致。
 */
const findCloudFile = async(connection: Cd2Connection, remotePath: string): Promise<CloudDriveFile | null> => {
  if (connection.permissions?.allow_list === false) return null
  const normalized = remotePath.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '')
  const separatorIndex = normalized.lastIndexOf('/')
  const parentPath = separatorIndex > 0 ? normalized.slice(0, separatorIndex) : '/'
  const name = normalized.slice(separatorIndex + 1)
  if (!name) return null
  // 不同 CloudDrive2 版本对 parentPath / path 的期望不一致，两种调用方式都尝试一次
  for (const request of [{ parentPath, path: name }, { parentPath: '', path: normalized }]) {
    const file = await call<CloudDriveFile>(callback => connection.client.findFileByPath(
      request, connection.metadata, connection.options, callback,
    )).catch(() => null)
    if (file?.fullPathName && !file.isDirectory) return file
  }
  return null
}

export const checkSubscriptionCd2Health = async(config: LX.Subscription.Config): Promise<LX.Subscription.Cd2Health> => {
  const connection = await checkConnection(config)
  try {
    return {
      rootPath: connection.mountedRoot.rootPath,
      mountPath: connection.mountedRoot.mountPath,
      apiMountPoint: connection.mountedRoot.apiMountPoint,
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
      throw new Error('LX Music 下载目录不能位于 CloudDrive2 挂载点内')
    }
    const currentPath = input.currentCloudPath ? path.resolve(input.currentCloudPath) : null
    if (currentPath && !isWithin(connection.mountedRoot.rootPath, currentPath)) {
      throw new Error('数据库中的现有云端路径超出当前 CloudDrive2 音乐库根目录')
    }
    const retryPath = input.retryCloudPath ? path.resolve(input.retryCloudPath) : null
    if (retryPath && !isWithin(connection.mountedRoot.rootPath, retryPath)) {
      throw new Error('待重试的 CloudDrive2 目标路径超出音乐库根目录')
    }
    const retryName = retryPath ? path.basename(retryPath) : ''
    const localName = path.basename(localPath)
    if (retryPath && (process.platform == 'win32' ? retryName.toLowerCase() != localName.toLowerCase() : retryName != localName)) {
      throw new Error('待重试的 CloudDrive2 目标文件名与本地成品不一致')
    }
    const sameExtension = currentPath && path.extname(currentPath).toLowerCase() == path.extname(localPath).toLowerCase()
    const cloudPath = sameExtension ? currentPath : retryPath ?? path.join(connection.mountedRoot.rootPath, path.basename(localPath))
    if (!isWithin(connection.mountedRoot.rootPath, cloudPath)) throw new Error('目标云端路径超出 CloudDrive2 音乐库根目录')
    if (!sameExtension) {
      const existingTarget = await fs.promises.stat(cloudPath).catch(() => null)
      const isKnownRetryTarget = retryPath && comparablePath(retryPath) == comparablePath(cloudPath)
      if (existingTarget && !isKnownRetryTarget) throw new Error('CloudDrive2 目标路径已存在且不属于当前歌曲记录，拒绝覆盖')
    }
    const localLrcPath = lrcPathFor(localPath)
    const cloudLrcPath = lrcPathFor(cloudPath)
    const currentLrcPath = currentPath ? lrcPathFor(currentPath) : null
    const localLrc = await fs.promises.stat(localLrcPath).catch(() => null)
    if (localLrc?.isFile()) {
      const existingCloudLrc = await fs.promises.stat(cloudLrcPath).catch(() => null)
      const belongsToCurrentSong = currentLrcPath && comparablePath(currentLrcPath) == comparablePath(cloudLrcPath)
      if (existingCloudLrc && !belongsToCurrentSong) throw new Error('CloudDrive2 目标歌词路径已存在且不属于当前歌曲记录，拒绝覆盖')
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
    if (!isWithin(connection.mountedRoot.rootPath, cloudPath)) throw new Error('目标云端路径超出 CloudDrive2 音乐库根目录')
    const remotePath = toRemotePath(connection.mountedRoot, cloudPath)
    const expectedDestPath = normalizeRemotePath(remotePath)
    const localStat = await fs.promises.stat(input.localPath).catch(() => null)
    // 能不能拿到权威的云端结论：需要 Token 有列目录权限，且有本地成品作为大小基准
    const canQueryCloud = connection.permissions?.allow_list !== false && localStat != null
    // 云端校验：必须是真正落到云端的文件（而不是 CloudDrive2 尚未上传、仅存在于本地写缓存里的条目），
    // 并且大小与本地成品完全一致。查询失败一律按未通过处理——推迟确认永远比误删安全。
    const verifyCloudFile = async() => {
      if (!localStat) return false
      const file = await findCloudFile(connection, remotePath)
      if (!file?.isCloudFile || file.isLocal) return false
      return Number(file.size) == localStat.size
    }
    // 降级手段：只有在查不了云端时才退回挂载点 stat。
    // 挂载点反映的是 CloudDrive2 的虚拟文件系统，文件复制进去就立刻可见，
    // 所以它不能推翻云端给出的否定结论，否则会把没传完的文件当成功而删掉本地成品。
    const verifyMountedFile = async() => {
      const cloudStat = await fs.promises.stat(cloudPath).catch(() => null)
      return !!cloudStat?.isFile() && (!localStat || cloudStat.size == localStat.size)
    }
    const result = await call<{ uploadFiles: UploadFileInfo[] }>(callback => connection.client.getUploadFileList({
      getAll: true,
      itemsPerPage: 200,
      pageNumber: 1,
      filter: path.basename(cloudPath),
    }, connection.metadata, connection.options, callback))
    const uploadFiles = result.uploadFiles ?? []
    // 先按目标路径精确关联，再退回到「同名且大小唯一匹配」的启发式。
    // 旧实现先按大小过滤、再从结果里找精确匹配，导致 CloudDrive2 在预处理阶段报告 size=0 时，
    // 本来能精确对上的传输任务也会被丢掉，最终被误判成「尚未关联」。
    const exactMatches = uploadFiles.filter(item => normalizeRemotePath(item.destPath) == expectedDestPath)
    const sizeMatches = localStat ? uploadFiles.filter(item => Number(item.size) == localStat.size) : []
    const candidates = exactMatches.length ? exactMatches : sizeMatches.length == 1 ? sizeMatches : []

    if (!candidates.length) {
      if (await verifyCloudFile()) {
        return {
          state: 'success',
          progress: 100,
          message: 'CloudDrive2 传输任务已结束并移出列表，已通过云端文件校验确认上传成功',
          verifiedByCloudFile: true,
        }
      }
      return {
        state: 'unconfirmed',
        progress: 0,
        message: connection.permissions?.allow_list === false
          ? '尚未关联到对应的 CloudDrive2 上传任务；API Token 缺少列目录权限，无法回退到云端文件校验'
          : '尚未关联到对应的 CloudDrive2 上传任务，云端文件也尚未就绪，继续等待确认',
      }
    }
    const active = candidates.filter(item => UPLOAD_ACTIVE_STATUS.includes(item.statusEnum))
    if (active.length > 1) return { state: 'unconfirmed', progress: 0, message: '关联到多个仍在运行的 CloudDrive2 上传任务，暂不确认' }
    const terminalGroups = new Set(candidates.map(item => item.statusEnum == UPLOAD_SUCCESS_STATUS ? 'success' : 'failed'))
    if (!active.length && terminalGroups.size > 1) {
      return { state: 'unconfirmed', progress: 0, message: '关联到状态冲突的多个 CloudDrive2 上传任务，暂不确认' }
    }
    const upload = active[0] ?? candidates[0]
    const reportedSize = Number(upload.size)
    // CloudDrive2 预处理阶段可能还报告 size=0，此时用本地文件大小做分母，避免进度恒为 0
    const size = reportedSize > 0 ? reportedSize : localStat?.size ?? 0
    const progress = size > 0 ? Math.min(100, Number(upload.transferedBytes) / size * 100) : 0
    if (upload.statusEnum == UPLOAD_SUCCESS_STATUS) {
      // 能查云端时以云端结论为准；查不了才退回挂载点 stat
      const confirmed = canQueryCloud ? await verifyCloudFile() : await verifyMountedFile()
      if (confirmed) {
        return { state: 'success', progress: 100, message: upload.status || 'Finish', verifiedByCloudFile: canQueryCloud }
      }
      return { state: 'unconfirmed', progress: 100, message: 'CloudDrive2 上传任务已完成，但目标文件尚未校验通过' }
    }
    if (upload.statusEnum == UPLOAD_SKIPPED_STATUS) {
      // Skipped 通常意味着目标已存在或秒传成功，只有校验不过才算失败
      const confirmed = canQueryCloud ? await verifyCloudFile() : await verifyMountedFile()
      if (confirmed) {
        return { state: 'success', progress: 100, message: upload.status || 'Skipped', verifiedByCloudFile: canQueryCloud }
      }
      return { state: 'failed', progress, message: upload.errorMessage || upload.status || 'CloudDrive2 跳过了该上传任务且云端文件不可用' }
    }
    if (UPLOAD_FAILED_STATUS.includes(upload.statusEnum)) {
      return { state: 'failed', progress, message: upload.errorMessage || upload.status || 'CloudDrive2 上传任务失败' }
    }
    return { state: 'running', progress, message: upload.status || 'CloudDrive2 正在上传' }
  } finally {
    connection.client.close()
  }
}

export const waitForSubscriptionCd2Upload = async(
  query: () => Promise<LX.Subscription.Cd2UploadStatus>,
  timeoutMs = 5 * 60_000,
  pollIntervalMs = 10_000,
): Promise<LX.Subscription.Cd2UploadStatus> => {
  const deadline = Date.now() + timeoutMs
  let status = await query()
  while (['running', 'unconfirmed'].includes(status.state) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()))))
    status = await query()
  }
  return status
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
  if (comparablePath(localPath) == comparablePath(cloudPath)) throw new Error('本地文件与 CloudDrive2 目标路径相同，拒绝清理')
  const cloudStat = await fs.promises.stat(cloudPath).catch(() => null)
  if (!cloudStat?.isFile()) throw new Error('延迟清理已推迟：CloudDrive2 目标文件不存在')
  const localLrcPath = lrcPathFor(localPath)
  const localLrc = await fs.promises.stat(localLrcPath).catch(() => null)
  if (localLrc?.isFile()) {
    const cloudLrc = await fs.promises.stat(lrcPathFor(cloudPath)).catch(() => null)
    if (!cloudLrc?.isFile()) throw new Error('延迟清理已推迟：CloudDrive2 目标歌词文件不存在')
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
    if (!isWithin(connection.mountedRoot.rootPath, oldCloudPath)) throw new Error('旧版本路径超出 CloudDrive2 音乐库根目录')
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
