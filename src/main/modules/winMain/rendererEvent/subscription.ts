import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'
import fs from 'node:fs'
import path from 'node:path'
import {
  cleanupSubscriptionLocalFile,
  checkSubscriptionCd2Health,
  copySubscriptionFileToCd2,
  getSubscriptionCd2UploadStatus,
  removeSubscriptionOldCloudFile,
} from '@main/modules/subscription/cd2'
import { scanSubscriptionCalibration } from '@main/modules/subscription/calibration'
import { scanSubscriptionStructure } from '@main/modules/subscription/structureValidation'

const comparablePath = (input: string) => {
  const resolved = path.resolve(input).replace(/[\\/]+$/, '')
  return process.platform == 'win32' ? resolved.toLowerCase() : resolved
}

const pathsOverlap = (first: string, second: string) => {
  const a = comparablePath(first)
  const b = comparablePath(second)
  return a == b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`)
}

export default () => {
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.subscription_config_get, async() => {
    return global.lx.worker.dbService.getSubscriptionConfig()
  })
  mainHandle<LX.Subscription.ConfigUpdate, LX.Subscription.Config>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_config_update, async({ params }) => {
    const current = await global.lx.worker.dbService.getSubscriptionConfig()
    const next = { ...current, ...params }
    const downloadPath = path.resolve(global.lx.appSetting['download.savePath'])
    const cd2RootPath = next.cd2RootPath.trim() ? path.resolve(next.cd2RootPath) : ''
    if (cd2RootPath && pathsOverlap(downloadPath, cd2RootPath)) {
      throw new Error('LX Music 下载目录不能位于 CD2 音乐库内或包含 CD2 音乐库，请先修改原版下载目录')
    }
    return global.lx.worker.dbService.updateSubscriptionConfig(params)
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.subscription_list_get, async() => {
    return global.lx.worker.dbService.getSubscriptions()
  })
  mainHandle<number, LX.Subscription.ListItem[]>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_list_due, async({ params }) => {
    return global.lx.worker.dbService.getDueSubscriptions(params)
  })
  mainHandle<LX.Subscription.ListCreate, LX.Subscription.ListItem>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_list_create, async({ params }) => {
    return global.lx.worker.dbService.createSubscription(params)
  })
  mainHandle<LX.Subscription.ListUpdate, LX.Subscription.ListItem>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_list_update, async({ params }) => {
    return global.lx.worker.dbService.updateSubscription(params)
  })
  mainHandle<string>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_list_remove, async({ params }) => {
    await global.lx.worker.dbService.removeSubscription(params)
  })
  mainHandle<LX.Subscription.SyncInput, LX.Subscription.SyncResult>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_sync_ingest, async({ params }) => {
    return global.lx.worker.dbService.ingestSubscriptionSync(params)
  })
  mainHandle<{ id: string, message: string }>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_sync_error, async({ params }) => {
    await global.lx.worker.dbService.setSubscriptionSyncError(params.id, params.message)
  })
  mainHandle<LX.Subscription.TaskStatus | undefined, LX.Subscription.Task[]>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_task_get, async({ params }) => {
    return global.lx.worker.dbService.getSubscriptionTasks(params)
  })
  mainHandle<LX.Subscription.TaskUpdate, LX.Subscription.Task>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_task_update, async({ params }) => {
    return global.lx.worker.dbService.updateSubscriptionTask(params)
  })
  mainHandle<string[], number>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_task_retry, async({ params }) => {
    return global.lx.worker.dbService.retrySubscriptionTasks(params)
  })
  mainHandle<{
    taskId: string
    cloudPath: string
    cloudQuality: LX.Subscription.Quality
    fileNameFormat: string
    confirmedAt: number
    cleanupAt: number
  }, LX.Subscription.Task>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_upload_confirm, async({ params }) => {
    return global.lx.worker.dbService.confirmSubscriptionUpload(params)
  })
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.subscription_dashboard_get, async() => {
    return global.lx.worker.dbService.getSubscriptionDashboard()
  })
  mainHandle<LX.Subscription.DiskInfo>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_disk_info_get, async() => {
    const targetPath = path.resolve(global.lx.appSetting['download.savePath'])
    const stat = await fs.promises.statfs(targetPath)
    const config = await global.lx.worker.dbService.getSubscriptionConfig()
    const cd2RootPath = config.cd2RootPath.trim() ? path.resolve(config.cd2RootPath) : ''
    return {
      path: targetPath,
      freeBytes: stat.bavail * stat.bsize,
      totalBytes: stat.blocks * stat.bsize,
      overlapsCd2Root: !!cd2RootPath && pathsOverlap(targetPath, cd2RootPath),
    }
  })
  mainHandle<string, LX.Subscription.Task>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_cd2_copy, async({ params: taskId }) => {
    const task = (await global.lx.worker.dbService.getSubscriptionTasks()).find(item => item.id == taskId)
    if (!task?.localPath) throw new Error('待上传任务或本地文件路径不存在')
    const config = await global.lx.worker.dbService.getSubscriptionConfig()
    if (!config.syncToCd2) {
      return global.lx.worker.dbService.updateSubscriptionTask({ id: task.id, status: 'uploading' })
    }
    const copied = await copySubscriptionFileToCd2({
      config,
      localPath: task.localPath,
      currentCloudPath: task.existingCloudPath,
      retryCloudPath: task.cloudPath,
    })
    return global.lx.worker.dbService.updateSubscriptionTask({
      id: task.id,
      status: 'uploading',
      cloudPath: copied.cloudPath,
      oldCloudPath: copied.oldCloudPath,
      uploadStartedAt: copied.copiedAt,
      progress: 0,
      speed: '',
      failureReason: null,
    })
  })
  mainHandle<string, LX.Subscription.Cd2UploadStatus>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_cd2_upload_status, async({ params: taskId }) => {
    const task = (await global.lx.worker.dbService.getSubscriptionTasks()).find(item => item.id == taskId)
    if (!task?.localPath || !task.cloudPath) throw new Error('上传任务缺少本地或 CD2 目标路径')
    return getSubscriptionCd2UploadStatus({
      config: await global.lx.worker.dbService.getSubscriptionConfig(),
      localPath: task.localPath,
      cloudPath: task.cloudPath,
    })
  })
  mainHandle<string>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_cd2_cleanup_local, async({ params: taskId }) => {
    const task = (await global.lx.worker.dbService.getSubscriptionTasks()).find(item => item.id == taskId)
    if (!task?.localPath || !task.cloudPath) throw new Error('清理任务缺少本地或 CD2 目标路径')
    await cleanupSubscriptionLocalFile({
      config: await global.lx.worker.dbService.getSubscriptionConfig(),
      localPath: task.localPath,
      cloudPath: task.cloudPath,
    })
  })
  mainHandle<string>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_cd2_remove_old, async({ params: taskId }) => {
    const task = (await global.lx.worker.dbService.getSubscriptionTasks()).find(item => item.id == taskId)
    if (!task?.oldCloudPath || !task.cloudPath) throw new Error('任务没有可清理的旧云端版本')
    await removeSubscriptionOldCloudFile({
      config: await global.lx.worker.dbService.getSubscriptionConfig(),
      oldCloudPath: task.oldCloudPath,
      cloudPath: task.cloudPath,
    })
  })
  mainHandle<LX.Subscription.Cd2Health>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_cd2_health, async() => {
    return checkSubscriptionCd2Health(await global.lx.worker.dbService.getSubscriptionConfig())
  })
  mainHandle<LX.Subscription.CalibrationScanInput, LX.Subscription.CalibrationSummary>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_calibration_scan, async({ params }) => {
    const config = await global.lx.worker.dbService.updateSubscriptionConfig({
      calibrationRootPath: params.rootPath,
      calibrationRecursive: params.recursive,
      calibrationIncludePaths: params.includePaths,
      calibrationExcludePaths: params.excludePaths,
    })
    const files = await scanSubscriptionCalibration(config, params)
    return global.lx.worker.dbService.importSubscriptionCalibration(files)
  })
  mainHandle<LX.Subscription.CalibrationRecord[]>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_calibration_get, async() => {
    return global.lx.worker.dbService.getSubscriptionCalibrationRecords()
  })
  mainHandle<LX.Subscription.CalibrationConfirmInput, LX.Subscription.CalibrationRecord>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_calibration_confirm, async({ params }) => {
    return global.lx.worker.dbService.confirmSubscriptionCalibration(params)
  })
  mainHandle<LX.Subscription.StructureValidationInput, LX.Subscription.StructureValidationSummary>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_structure_scan, async({ params }) => {
    const config = await global.lx.worker.dbService.updateSubscriptionConfig({
      structureRootPath: params.rootPath,
      structureRecursive: params.recursive,
    })
    const files = await scanSubscriptionStructure(config, params)
    return global.lx.worker.dbService.importSubscriptionStructureValidation({
      ...params,
      files,
      scannedAt: Date.now(),
    })
  })
  mainHandle<LX.Subscription.StructureValidationRecord[]>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_structure_get, async() => {
    return global.lx.worker.dbService.getSubscriptionStructureValidationRecords()
  })
  mainHandle<LX.Subscription.BackupResult>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_backup_create, async() => {
    const config = await global.lx.worker.dbService.getSubscriptionConfig()
    const health = await checkSubscriptionCd2Health(config)
    const backupDir = path.join(health.rootPath, '.lx-subscription-backups')
    await fs.promises.mkdir(backupDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '')
    return global.lx.worker.dbService.backupSubscriptionDatabase(path.join(backupDir, `lx-data-${timestamp}.db`))
  })
  mainHandle<number, LX.Subscription.HistoryItem[]>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_history_get, async({ params }) => {
    return global.lx.worker.dbService.getSubscriptionHistory(params)
  })
}
