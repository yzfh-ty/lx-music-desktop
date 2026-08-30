'use strict'
/**
 * @renderer/utils/ipc 的测试替身。
 * 内存里维护一份 subscription_task，并**照抄真实 DB 层的行为**：
 * 只有 status 或 failureReason 发生变化时才写一条 history。
 * 这样测试才能验证「轮询不会把历史表刷屏」这类断言。
 */
'use strict'

const state = {
  /** @type {Map<string, any>} */
  tasks: new Map(),
  /** @type {Array<{taskId: string, status: string, message: string|null, at: number}>} */
  history: [],
  /** 每个 taskId 的 CD2 状态返回值队列；用完后重复最后一个 */
  cd2Status: new Map(),
  /** 调用流水 */
  calls: [],
  config: {
    stopQuality: 'flac',
    cd2RootPath: 'F:\\',
    cd2GrpcUrl: 'http://127.0.0.1:19798',
    cd2ApiToken: 'token',
    syncToCd2: true,
    diskThresholdBytes: 30 * 1024 ** 3,
    diskLocked: false,
    diskPausedAt: null,
    calibrationCompletedAt: 1,
    calibrationRootPath: '',
    calibrationRecursive: true,
    calibrationIncludePaths: [],
    calibrationExcludePaths: [],
    structureRootPath: '',
    structureRecursive: true,
    structureIntervalMinutes: null,
    structureLastRunAt: null,
    backupIntervalMinutes: null,
    backupLastAt: null,
    backupLastPath: null,
  },
  /** cleanupSubscriptionLocalFile / removeSubscriptionOldCloudFile 的行为 */
  cleanupBehaviour: { throws: null },
  removeOldBehaviour: { throws: null },
  diskInfo: { path: 'C:\\', freeBytes: 1e12, totalBytes: 2e12, overlapsCd2Root: false },
}

const reset = () => {
  state.tasks.clear()
  state.history.length = 0
  state.cd2Status.clear()
  state.calls.length = 0
  state.cleanupBehaviour.throws = null
  state.removeOldBehaviour.throws = null
  state.config.syncToCd2 = true
  state.config.diskLocked = false
  state.config.diskPausedAt = null
  state.config.backupIntervalMinutes = null
  state.config.backupLastAt = null
  state.diskInfo = { path: 'C:\\', freeBytes: 1e12, totalBytes: 2e12, overlapsCd2Root: false }
}

const makeTask = (overrides = {}) => ({
  id: 'task-1',
  musicKey: 'wy:123',
  subscriptionId: 'sub-1',
  source: 'wy',
  songId: '123',
  name: '普通的日子',
  singer: '魏如萱',
  albumName: '',
  duration: 240,
  status: 'uploading',
  requestedQuality: 'flac24bit',
  sourceReportedQuality: 'flac24bit',
  fileVerifiedQuality: 'flac24bit',
  cloudQuality: null,
  sourceUsed: 'user_api',
  actualSource: 'wy',
  actualSongId: '123',
  localPath: 'C:\\Users\\me\\Downloads\\music\\普通的日子 - 魏如萱.flac',
  existingCloudPath: null,
  cloudPath: 'F:\\普通的日子 - 魏如萱.flac',
  oldCloudPath: null,
  fileNameFormat: '歌名 - 歌手',
  uploadStartedAt: Date.now(),
  progress: 0,
  speed: '',
  failureReason: null,
  pauseOrigin: null,
  retryCount: 0,
  cleanupAt: null,
  discoveredAt: Date.now(),
  downloadCompletedAt: Date.now(),
  uploadCompletedAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  musicInfo: {},
  ...overrides,
})

const addTask = (overrides = {}) => {
  const task = makeTask(overrides)
  state.tasks.set(task.id, task)
  return task
}

/** 给某个任务安排一串 CD2 状态返回值（依次消费，用完重复最后一个） */
const scriptCd2Status = (taskId, results) => {
  state.cd2Status.set(taskId, Array.isArray(results) ? results.slice() : [results])
}

const track = (name, args) => { state.calls.push({ name, args }) }

// ------------------------------------------------------------------ IPC 实现

const getSubscriptionTasks = async() => {
  track('getSubscriptionTasks')
  return [...state.tasks.values()].map(t => ({ ...t }))
}

const updateSubscriptionTask = async(input) => {
  track('updateSubscriptionTask', input)
  const current = state.tasks.get(input.id)
  if (!current) throw new Error('任务不存在')
  const next = { ...current, ...input, updatedAt: Date.now() }
  // 照抄真实 DB 层：CD2 同步关闭时上传阶段的任务降级为仅本地完成
  if ((next.status == 'uploading' || next.status == 'upload_unconfirmed') && !state.config.syncToCd2) {
    next.status = 'local_completed'
    next.progress = 100
    next.cleanupAt = null
    next.failureReason = null
  }
  if (next.status != current.status || next.failureReason != current.failureReason) {
    state.history.push({ taskId: next.id, status: next.status, message: next.failureReason ?? null, at: next.updatedAt })
  }
  state.tasks.set(next.id, next)
  return { ...next }
}

const getSubscriptionCd2UploadStatus = async(taskId) => {
  track('getSubscriptionCd2UploadStatus', taskId)
  const queue = state.cd2Status.get(taskId)
  if (!queue || !queue.length) throw new Error(`测试未为 ${taskId} 安排 CD2 状态`)
  const next = queue.length > 1 ? queue.shift() : queue[0]
  if (next instanceof Error) throw next
  if (typeof next == 'function') return next()
  return next
}

const confirmSubscriptionUpload = async(input) => {
  track('confirmSubscriptionUpload', input)
  const current = state.tasks.get(input.taskId)
  if (!current) throw new Error('任务不存在')
  // 照抄真实 DB 层：有旧版本要清就先去清旧版本，否则进入延迟清理
  const next = {
    ...current,
    status: current.oldCloudPath ? 'old_version_cleanup' : 'cleanup_wait',
    cloudQuality: input.cloudQuality,
    cloudPath: input.cloudPath,
    uploadCompletedAt: input.confirmedAt,
    cleanupAt: input.cleanupAt,
    progress: 100,
    speed: '',
    failureReason: null,
    updatedAt: input.confirmedAt,
  }
  state.history.push({ taskId: next.id, status: next.status, message: null, at: input.confirmedAt })
  state.tasks.set(next.id, next)
  return { ...next }
}

const cleanupSubscriptionLocalFile = async(taskId) => {
  track('cleanupSubscriptionLocalFile', taskId)
  if (state.cleanupBehaviour.throws) throw new Error(state.cleanupBehaviour.throws)
}

const removeSubscriptionOldCloudFile = async(taskId) => {
  track('removeSubscriptionOldCloudFile', taskId)
  if (state.removeOldBehaviour.throws) throw new Error(state.removeOldBehaviour.throws)
}

const getSubscriptionConfig = async() => ({ ...state.config })
const getSubscriptions = async() => []
const getSubscriptionDashboard = async() => ({
  subscriptionCount: 0, pendingCount: 0, downloadingCount: 0, uploadingCount: 0,
  unconfirmedCount: [...state.tasks.values()].filter(t => t.status == 'upload_unconfirmed').length,
  failedCount: [...state.tasks.values()].filter(t => t.status == 'failed').length,
  cleanupCount: 0, libraryCount: 0, lastSyncAt: null, diskLocked: false,
})
const getSubscriptionCalibrationRecords = async() => []
const getSubscriptionCalibrationRun = async() => null
const getSubscriptionStructureValidationRecords = async() => []
const getSubscriptionHistory = async() => []
const getSubscriptionDiskInfo = async() => ({ ...state.diskInfo })
const checkSubscriptionCd2Health = async() => ({ rootPath: 'F:\\', mountPath: 'F:\\', sourceDir: '/115/music', writable: true })
const unsupported = name => async() => { throw new Error(`测试桩未实现：${name}`) }

module.exports = {
  // 测试用
  __state: state,
  __reset: reset,
  __addTask: addTask,
  __makeTask: makeTask,
  __scriptCd2Status: scriptCd2Status,

  // 被测代码用到的 IPC
  getSubscriptionTasks,
  updateSubscriptionTask,
  getSubscriptionCd2UploadStatus,
  confirmSubscriptionUpload,
  cleanupSubscriptionLocalFile,
  removeSubscriptionOldCloudFile,
  getSubscriptionConfig,
  getSubscriptions,
  getSubscriptionDashboard,
  getSubscriptionCalibrationRecords,
  getSubscriptionCalibrationRun,
  getSubscriptionStructureValidationRecords,
  getSubscriptionHistory,
  getSubscriptionDiskInfo,
  checkSubscriptionCd2Health,
  backupSubscriptionDatabase: async() => {
    track('backupSubscriptionDatabase')
    state.config.backupLastAt = Date.now()
    return { path: 'C:\\subscription-backups\\test.db', createdAt: state.config.backupLastAt }
  },
  clearSubscriptionHistory: unsupported('clearSubscriptionHistory'),
  createSubscription: unsupported('createSubscription'),
  confirmSubscriptionCalibration: unsupported('confirmSubscriptionCalibration'),
  getDueSubscriptions: async() => [],
  ingestSubscriptionSync: unsupported('ingestSubscriptionSync'),
  removeSubscription: unsupported('removeSubscription'),
  requeueSubscriptionMusic: unsupported('requeueSubscriptionMusic'),
  retrySubscriptionTasks: unsupported('retrySubscriptionTasks'),
  resumeSubscriptionCalibration: unsupported('resumeSubscriptionCalibration'),
  scanSubscriptionCalibration: unsupported('scanSubscriptionCalibration'),
  scanSubscriptionStructure: unsupported('scanSubscriptionStructure'),
  setSubscriptionSyncError: unsupported('setSubscriptionSyncError'),
  updateSubscription: unsupported('updateSubscription'),
  updateSubscriptionConfig: async(input) => { Object.assign(state.config, input); return { ...state.config } },
}
