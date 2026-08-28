import { reactive } from '@common/utils/vueTools'
import { getListDetailAll as getSongListDetailAll } from '@renderer/store/songList/action'
import { getListDetailAll as getBoardListDetailAll } from '@renderer/store/leaderboard/action'
import {
  backupSubscriptionDatabase,
  clearSubscriptionHistory as clearSubscriptionHistoryRemote,
  createSubscription as createSubscriptionRemote,
  cleanupSubscriptionLocalFile,
  checkSubscriptionCd2Health,
  confirmSubscriptionUpload,
  confirmSubscriptionCalibration,
  getSubscriptionCd2UploadStatus,
  getDueSubscriptions,
  getSubscriptionConfig,
  getSubscriptionCalibrationRecords,
  getSubscriptionCalibrationRun,
  getSubscriptionDashboard,
  getSubscriptionDiskInfo,
  getSubscriptionHistory,
  getSubscriptionStructureValidationRecords,
  getSubscriptionTasks,
  getSubscriptions,
  ingestSubscriptionSync,
  removeSubscriptionOldCloudFile,
  removeSubscription as removeSubscriptionRemote,
  requeueSubscriptionMusic as requeueSubscriptionMusicRemote,
  retrySubscriptionTasks,
  resumeSubscriptionCalibration as resumeSubscriptionCalibrationRemote,
  scanSubscriptionCalibration,
  scanSubscriptionStructure,
  setSubscriptionSyncError,
  updateSubscription as updateSubscriptionRemote,
  updateSubscriptionConfig as updateSubscriptionConfigRemote,
  updateSubscriptionTask,
} from '@renderer/utils/ipc'
import {
  createDownloadTasks,
  getDownloadList,
  pauseDownloadTasks,
  resumeSubscriptionPostProcess,
  resumeSubscriptionTaskPostProcess,
  startDownloadTasks,
} from '@renderer/store/download/action'
import { downloadList } from '@renderer/store/download/state'
import { appSetting } from '@renderer/store/setting'

export const subscriptionState = reactive<{
  config: LX.Subscription.Config | null
  subscriptions: LX.Subscription.ListItem[]
  tasks: LX.Subscription.Task[]
  dashboard: LX.Subscription.Dashboard | null
  diskInfo: LX.Subscription.DiskInfo | null
  cd2Health: LX.Subscription.Cd2Health | null
  cd2HealthError: string
  calibrationRecords: LX.Subscription.CalibrationRecord[]
  calibrationRun: LX.Subscription.CalibrationRun | null
  structureRecords: LX.Subscription.StructureValidationRecord[]
  history: LX.Subscription.HistoryItem[]
  loading: boolean
  syncingIds: string[]
}>({
  config: null,
  subscriptions: [],
  tasks: [],
  dashboard: null,
  diskInfo: null,
  cd2Health: null,
  cd2HealthError: '',
  calibrationRecords: [],
  calibrationRun: null,
  structureRecords: [],
  history: [],
  loading: false,
  syncingIds: [],
})

const parseDuration = (interval?: string | null) => {
  if (!interval) return null
  const parts = interval.split(':').map(Number)
  if (parts.some(Number.isNaN)) return null
  return parts.reduce((total, part) => total * 60 + part, 0)
}

export const refreshSubscriptionState = async() => {
  const [config, subscriptions, tasks, dashboard, calibrationRecords, calibrationRun, structureRecords, history] = await Promise.all([
    getSubscriptionConfig(),
    getSubscriptions(),
    getSubscriptionTasks(),
    getSubscriptionDashboard(),
    getSubscriptionCalibrationRecords(),
    getSubscriptionCalibrationRun(),
    getSubscriptionStructureValidationRecords(),
    getSubscriptionHistory(),
  ])
  subscriptionState.config = config
  subscriptionState.subscriptions = subscriptions
  subscriptionState.tasks = tasks
  subscriptionState.dashboard = dashboard
  subscriptionState.calibrationRecords = calibrationRecords
  subscriptionState.calibrationRun = calibrationRun
  subscriptionState.structureRecords = structureRecords
  subscriptionState.history = history
}

export const refreshSubscriptionRuntimeStatus = async() => {
  const config = subscriptionState.config ?? await getSubscriptionConfig()
  const diskPromise = getSubscriptionDiskInfo()
    .then(info => { subscriptionState.diskInfo = info })
    .catch(() => { subscriptionState.diskInfo = null })
  let cd2Promise: Promise<void>
  if (!config.syncToCd2) {
    subscriptionState.cd2Health = null
    subscriptionState.cd2HealthError = ''
    cd2Promise = Promise.resolve()
  } else if (!config.cd2RootPath.trim() || !config.cd2GrpcUrl.trim() || !config.cd2ApiToken.trim()) {
    subscriptionState.cd2Health = null
    subscriptionState.cd2HealthError = '配置未完成'
    cd2Promise = Promise.resolve()
  } else {
    cd2Promise = checkSubscriptionCd2Health()
      .then(health => {
        subscriptionState.cd2Health = health
        subscriptionState.cd2HealthError = ''
      })
      .catch(err => {
        subscriptionState.cd2Health = null
        subscriptionState.cd2HealthError = err instanceof Error ? err.message : String(err)
      })
  }
  await Promise.all([diskPromise, cd2Promise])
}

export const createSubscription = async(input: LX.Subscription.ListCreate) => {
  await createSubscriptionRemote(input)
  await refreshSubscriptionState()
}

export const updateSubscription = async(input: LX.Subscription.ListUpdate) => {
  await updateSubscriptionRemote(input)
  await refreshSubscriptionState()
}

export const removeSubscription = async(id: string) => {
  await removeSubscriptionRemote(id)
  await refreshSubscriptionState()
}

export const saveSubscriptionConfig = async(input: LX.Subscription.ConfigUpdate) => {
  subscriptionState.config = await updateSubscriptionConfigRemote(input)
  subscriptionState.dashboard = await getSubscriptionDashboard()
}

export const testSubscriptionCd2 = async() => {
  const health = await checkSubscriptionCd2Health()
  subscriptionState.cd2Health = health
  subscriptionState.cd2HealthError = ''
  return health
}

export const runSubscriptionCalibration = async(input: LX.Subscription.CalibrationScanInput) => {
  const summary = await scanSubscriptionCalibration(input)
  await refreshSubscriptionState()
  await reconcileSubscriptionDownloads()
  void processSubscriptionQueue()
  return summary
}

export const refreshSubscriptionCalibrationRun = async() => {
  subscriptionState.calibrationRun = await getSubscriptionCalibrationRun()
  return subscriptionState.calibrationRun
}

export const resumeSubscriptionCalibrationRun = async() => {
  const summary = await resumeSubscriptionCalibrationRemote()
  await refreshSubscriptionState()
  await reconcileSubscriptionDownloads()
  void processSubscriptionQueue()
  return summary
}

export const resolveSubscriptionCalibration = async(input: LX.Subscription.CalibrationConfirmInput) => {
  await confirmSubscriptionCalibration(input)
  await refreshSubscriptionState()
}

export const runSubscriptionStructureValidation = async(input: LX.Subscription.StructureValidationInput) => {
  const summary = await scanSubscriptionStructure(input)
  await refreshSubscriptionState()
  return summary
}

export const runSubscriptionBackup = async() => {
  const result = await backupSubscriptionDatabase()
  subscriptionState.config = await getSubscriptionConfig()
  return result
}

export const clearSubscriptionHistory = async(musicKey: string) => {
  const count = await clearSubscriptionHistoryRemote(musicKey)
  await refreshSubscriptionState()
  return count
}

export const requeueSubscriptionHistoryMusic = async(musicKey: string) => {
  await requeueSubscriptionMusicRemote(musicKey)
  await refreshSubscriptionState()
  void processSubscriptionQueue()
}

export const syncSubscription = async(item: LX.Subscription.ListItem) => {
  if (subscriptionState.syncingIds.includes(item.id)) return null
  subscriptionState.syncingIds.push(item.id)
  try {
    const list = item.listType == 'board'
      ? await getBoardListDetailAll(item.listId)
      : await getSongListDetailAll(item.listId, item.source, true)
    const result = await ingestSubscriptionSync({
      subscriptionId: item.id,
      tracks: list.map(musicInfo => ({
        id: musicInfo.id,
        source: musicInfo.source,
        name: musicInfo.name,
        singer: musicInfo.singer,
        albumName: musicInfo.meta.albumName,
        interval: musicInfo.interval,
        duration: parseDuration(musicInfo.interval),
        musicInfo,
      })),
      syncedAt: Date.now(),
    })
    await refreshSubscriptionState()
    void processSubscriptionQueue()
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setSubscriptionSyncError({ id: item.id, message })
    await refreshSubscriptionState()
    throw err
  } finally {
    const index = subscriptionState.syncingIds.indexOf(item.id)
    if (index >= 0) subscriptionState.syncingIds.splice(index, 1)
  }
}

export const retryTasks = async(ids: string[]) => {
  const count = await retrySubscriptionTasks(ids)
  await refreshSubscriptionState()
  const retried = subscriptionState.tasks.filter(task => ids.includes(task.id))
  const downloadRetries = downloadList.filter(item => {
    const task = retried.find(task => task.id == item.metadata.subscriptionTaskId)
    return task?.status == 'pending' && ['error', 'pause'].includes(item.status)
  })
  if (downloadRetries.length) await startDownloadTasks(downloadRetries)
  for (const task of retried.filter(item => ['quality_check', 'tagging'].includes(item.status))) {
    void resumeSubscriptionTaskPostProcess(task)
  }
  void processSubscriptionQueue()
  void processSubscriptionMaintenance()
  return count
}

export const uploadLocalCompletedTask = async(task: LX.Subscription.Task) => {
  const config = subscriptionState.config ?? await getSubscriptionConfig()
  if (!config.syncToCd2) throw new Error('请先开启“下载完成后同步到 CD2”')
  if (task.status != 'local_completed' || !task.localPath) throw new Error('该任务不是可手动上传的仅本地成品')
  await updateSubscriptionTask({ id: task.id, status: 'tagging', failureReason: null })
  await resumeSubscriptionTaskPostProcess({ ...task, status: 'tagging' })
  await refreshSubscriptionState()
  const updated = subscriptionState.tasks.find(item => item.id == task.id)
  if (updated?.status == 'failed') throw new Error(updated.failureReason || '本地成品上传失败')
}

export const ignoreTaskMetadataAndUpload = async(task: LX.Subscription.Task) => {
  if (task.status != 'failed' || !task.localPath) throw new Error('该任务不能忽略元数据步骤')
  await updateSubscriptionTask({ id: task.id, status: 'tagging', failureReason: '用户已明确选择忽略不支持的元数据内嵌' })
  await resumeSubscriptionTaskPostProcess({ ...task, status: 'tagging' }, true)
  await refreshSubscriptionState()
  const updated = subscriptionState.tasks.find(item => item.id == task.id)
  if (updated?.status == 'failed') throw new Error(updated.failureReason || '忽略元数据后的上传处理失败')
}

export const unlockDiskQueue = async() => {
  await saveSubscriptionConfig({ diskLocked: false, diskPausedAt: null })
  const paused = subscriptionState.tasks.filter(task => task.status == 'disk_paused' && task.pauseOrigin == 'disk')
  for (const task of paused) await updateSubscriptionTask({ id: task.id, status: 'pending', pauseOrigin: null, failureReason: null })
  await refreshSubscriptionState()
  void processSubscriptionQueue()
}

let queueRunning = false
const isCalibrationActive = () => ['collecting', 'running'].includes(subscriptionState.calibrationRun?.status ?? '')
export const processSubscriptionQueue = async() => {
  if (queueRunning) return
  queueRunning = true
  try {
    await refreshSubscriptionState()
    if (!subscriptionState.config || subscriptionState.config.diskLocked) return
    if (subscriptionState.config.syncToCd2 && (subscriptionState.config.calibrationCompletedAt == null || isCalibrationActive())) return
    const activeDownloadTaskIds = new Set(downloadList
      .filter(item => !item.isComplate)
      .map(item => item.metadata.subscriptionTaskId)
      .filter(Boolean))
    const pending = subscriptionState.tasks.filter(task => task.status == 'pending' && !activeDownloadTaskIds.has(task.id))
    for (const task of pending) {
      const disk = await getSubscriptionDiskInfo()
      if (disk.overlapsCd2Root) {
        await saveSubscriptionConfig({ diskLocked: true, diskPausedAt: Date.now() })
        const remaining = subscriptionState.tasks.filter(item => item.status == 'pending')
        const remainingIds = new Set(remaining.map(item => item.id))
        const queuedDownloads = downloadList.filter(item => item.metadata.subscriptionTaskId && remainingIds.has(item.metadata.subscriptionTaskId))
        if (queuedDownloads.length) await pauseDownloadTasks(queuedDownloads)
        for (const item of remaining) {
          await updateSubscriptionTask({
            id: item.id,
            status: 'disk_paused',
            pauseOrigin: 'disk',
            failureReason: 'LX Music 下载目录与 CD2 音乐库重叠，请修改原版下载目录后手动恢复',
          })
        }
        await refreshSubscriptionState()
        return
      }
      if (disk.freeBytes < subscriptionState.config.diskThresholdBytes) {
        await saveSubscriptionConfig({ diskLocked: true, diskPausedAt: Date.now() })
        const remaining = subscriptionState.tasks.filter(item => item.status == 'pending')
        const remainingIds = new Set(remaining.map(item => item.id))
        const queuedDownloads = downloadList.filter(item => item.metadata.subscriptionTaskId && remainingIds.has(item.metadata.subscriptionTaskId))
        if (queuedDownloads.length) await pauseDownloadTasks(queuedDownloads)
        for (const item of remaining) {
          await updateSubscriptionTask({
            id: item.id,
            status: 'disk_paused',
            pauseOrigin: 'disk',
            failureReason: '本地下载磁盘剩余空间低于保护阈值',
          })
        }
        await refreshSubscriptionState()
        return
      }
      const created = await createDownloadTasks([task.musicInfo], 'flac24bit', undefined, task.id)
      if (created.length) {
        await updateSubscriptionTask({
          id: task.id,
          requestedQuality: created[0].metadata.quality as LX.Subscription.Quality,
          fileNameFormat: appSetting['download.fileName'],
        })
      }
    }
    await refreshSubscriptionState()
  } finally {
    // eslint-disable-next-line require-atomic-updates
    queueRunning = false
  }
}

const uploadTaskMissingTimeout = 10 * 60_000
const cleanupDelay = 20 * 60_000
let maintenanceRunning = false

export const processSubscriptionMaintenance = async() => {
  if (maintenanceRunning) return
  maintenanceRunning = true
  let changed = false
  try {
    const currentTasks = await getSubscriptionTasks()
    const now = Date.now()
    for (const task of currentTasks.filter(item => item.status == 'uploading')) {
      try {
        const status = await getSubscriptionCd2UploadStatus(task.id)
        if (status.state == 'missing') {
          if (now - (task.uploadStartedAt ?? task.updatedAt) >= uploadTaskMissingTimeout) {
            await updateSubscriptionTask({ id: task.id, status: 'failed', failureReason: status.message, speed: '' })
            changed = true
          }
          continue
        }
        if (status.state == 'failed') {
          await updateSubscriptionTask({ id: task.id, status: 'failed', failureReason: `CD2 上传失败：${status.message}`, progress: status.progress, speed: '' })
          changed = true
          continue
        }
        if (status.state == 'running') {
          await updateSubscriptionTask({ id: task.id, progress: status.progress, speed: '' })
          changed = true
          continue
        }
        if (!task.cloudPath || !task.fileVerifiedQuality) throw new Error('上传任务缺少目标路径或本地复核音质')
        const confirmedAt = Date.now()
        await confirmSubscriptionUpload({
          taskId: task.id,
          cloudPath: task.cloudPath,
          cloudQuality: task.fileVerifiedQuality,
          fileNameFormat: task.fileNameFormat || appSetting['download.fileName'],
          confirmedAt,
          cleanupAt: confirmedAt + cleanupDelay,
        })
        changed = true
      } catch (err) {
        await updateSubscriptionTask({
          id: task.id,
          status: 'failed',
          failureReason: err instanceof Error ? err.message : String(err),
          speed: '',
        })
        changed = true
      }
    }

    const tasksAfterUpload = changed ? await getSubscriptionTasks() : currentTasks
    for (const task of tasksAfterUpload.filter(item => item.status == 'old_version_cleanup')) {
      try {
        await removeSubscriptionOldCloudFile(task.id)
        await updateSubscriptionTask({
          id: task.id,
          status: 'cleanup_wait',
          oldCloudPath: null,
          failureReason: null,
          speed: '',
        })
      } catch (err) {
        await updateSubscriptionTask({
          id: task.id,
          status: 'failed',
          failureReason: `旧云端版本清理失败：${err instanceof Error ? err.message : String(err)}`,
          speed: '',
        })
      }
      changed = true
    }

    const tasksAfterOldCleanup = changed ? await getSubscriptionTasks() : tasksAfterUpload
    for (const task of tasksAfterOldCleanup.filter(item => item.status == 'cleanup_wait' && item.cleanupAt != null && item.cleanupAt <= Date.now())) {
      try {
        await cleanupSubscriptionLocalFile(task.id)
        await updateSubscriptionTask({
          id: task.id,
          status: 'uploaded',
          localPath: null,
          cleanupAt: null,
          failureReason: null,
          progress: 100,
          speed: '',
        })
      } catch (err) {
        await updateSubscriptionTask({
          id: task.id,
          failureReason: err instanceof Error ? err.message : String(err),
          speed: '',
        })
      }
      changed = true
    }
    if (changed) await refreshSubscriptionState()
  } finally {
    // eslint-disable-next-line require-atomic-updates
    maintenanceRunning = false
  }
}

export const pauseTask = async(task: LX.Subscription.Task) => {
  const downloadInfo = downloadList.find(item => item.metadata.subscriptionTaskId == task.id)
  if (downloadInfo) await pauseDownloadTasks([downloadInfo])
  await updateSubscriptionTask({ id: task.id, status: 'disk_paused', pauseOrigin: 'manual', failureReason: '用户手动暂停' })
  await refreshSubscriptionState()
}

export const resumeTask = async(task: LX.Subscription.Task) => {
  const config = subscriptionState.config ?? await getSubscriptionConfig()
  if (config.diskLocked) throw new Error('本地磁盘保护仍处于锁定状态，请先使用“手动恢复”解除全局锁定')
  await updateSubscriptionTask({ id: task.id, status: 'pending', pauseOrigin: null, failureReason: null })
  const downloadInfo = downloadList.find(item => item.metadata.subscriptionTaskId == task.id)
  if (downloadInfo) await startDownloadTasks([downloadInfo])
  await refreshSubscriptionState()
  void processSubscriptionQueue()
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null
let maintenanceTimer: ReturnType<typeof setInterval> | null = null
let schedulerRunning = false
let structureValidationRunning = false
let backupRunning = false

const runDueSubscriptions = async() => {
  if (schedulerRunning) return
  schedulerRunning = true
  try {
    const due = await getDueSubscriptions(Date.now())
    for (const item of due) {
      await syncSubscription(item).catch(err => {
        console.error('Subscription sync failed:', item.id, err)
      })
    }
  } finally {
    // eslint-disable-next-line require-atomic-updates
    schedulerRunning = false
  }
}

const runDueStructureValidation = async() => {
  if (structureValidationRunning) return
  const config = subscriptionState.config ?? await getSubscriptionConfig()
  const interval = config.structureIntervalMinutes
  if (!config.syncToCd2 || interval == null || !config.structureRootPath.trim()) return
  if (config.structureLastRunAt != null && Date.now() - config.structureLastRunAt < interval * 60_000) return
  // eslint-disable-next-line require-atomic-updates
  structureValidationRunning = true
  try {
    await runSubscriptionStructureValidation({
      rootPath: config.structureRootPath,
      recursive: config.structureRecursive,
    })
  } catch (err) {
    console.error('Subscription structure validation failed:', err)
  } finally {
    // eslint-disable-next-line require-atomic-updates
    structureValidationRunning = false
  }
}

const runDueSubscriptionBackup = async() => {
  if (backupRunning) return
  const config = subscriptionState.config ?? await getSubscriptionConfig()
  const interval = config.backupIntervalMinutes
  if (!config.syncToCd2 || interval == null) return
  if (config.backupLastAt != null && Date.now() - config.backupLastAt < interval * 60_000) return
  // eslint-disable-next-line require-atomic-updates
  backupRunning = true
  try {
    await runSubscriptionBackup()
  } catch (err) {
    console.error('Subscription database backup failed:', err)
  } finally {
    // eslint-disable-next-line require-atomic-updates
    backupRunning = false
  }
}

const reconcileSubscriptionDownloads = async(canResume = !subscriptionState.config?.syncToCd2 ||
  (subscriptionState.config.calibrationCompletedAt != null && !isCalibrationActive())) => {
  const transientStatuses: LX.Subscription.TaskStatus[] = ['resolving', 'downloading', 'downloaded']
  const downloadByTaskId = new Map(downloadList
    .filter(item => item.metadata.subscriptionTaskId)
    .map(item => [item.metadata.subscriptionTaskId!, item]))
  const completedDownloads: LX.Download.ListItem[] = []
  let changed = false
  for (const task of subscriptionState.tasks) {
    if (!transientStatuses.includes(task.status)) continue
    const downloadInfo = downloadByTaskId.get(task.id)
    if (downloadInfo?.isComplate || downloadInfo?.status == 'completed') {
      if (canResume) completedDownloads.push(downloadInfo)
      continue
    }
    if (downloadInfo) continue
    await updateSubscriptionTask({
      id: task.id,
      status: task.localPath ? 'quality_check' : 'pending',
      progress: task.localPath ? 100 : 0,
      speed: '',
      failureReason: null,
    })
    changed = true
  }
  if (changed) await refreshSubscriptionState()
  for (const downloadInfo of completedDownloads) void resumeSubscriptionPostProcess(downloadInfo)
}

export const initSubscriptionService = async() => {
  await getDownloadList()
  await refreshSubscriptionState()
  if (['collecting', 'running'].includes(subscriptionState.calibrationRun?.status ?? '')) {
    void resumeSubscriptionCalibrationRun().catch(err => {
      console.error('Subscription calibration resume failed:', err)
    })
  }
  const canResumeSubscriptionDownloads = !subscriptionState.config?.syncToCd2 ||
    (subscriptionState.config.calibrationCompletedAt != null && !isCalibrationActive())
  await reconcileSubscriptionDownloads(canResumeSubscriptionDownloads)
  const resumableDownloads = downloadList.filter(item => {
    if (!item.metadata.subscriptionTaskId || item.isComplate || !canResumeSubscriptionDownloads) return false
    const task = subscriptionState.tasks.find(task => task.id == item.metadata.subscriptionTaskId)
    return !!task && !['failed', 'disk_paused', 'quality_skipped', 'local_completed', 'uploaded'].includes(task.status)
  })
  if (resumableDownloads.length) await startDownloadTasks(resumableDownloads)
  if (canResumeSubscriptionDownloads) {
    for (const task of subscriptionState.tasks) {
      if (!['quality_check', 'tagging'].includes(task.status)) continue
      void resumeSubscriptionTaskPostProcess(task)
    }
  }
  await processSubscriptionQueue()
  await processSubscriptionMaintenance()
  await runDueSubscriptions()
  await runDueStructureValidation()
  await runDueSubscriptionBackup()
  schedulerTimer ??= setInterval(() => {
    void runDueSubscriptions()
    void runDueStructureValidation()
    void runDueSubscriptionBackup()
    void processSubscriptionQueue()
  }, 60_000)
  maintenanceTimer ??= setInterval(() => {
    void processSubscriptionMaintenance()
  }, 10_000)
}
