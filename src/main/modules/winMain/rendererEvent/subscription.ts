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
import {
  collectSubscriptionCalibrationFiles,
  inspectSubscriptionCalibrationFile,
} from '@main/modules/subscription/calibration'
import { scanSubscriptionStructure } from '@main/modules/subscription/structureValidation'

const comparablePath = (input: string) => {
  const resolved = path.resolve(input).replace(/[\\/]+$/, '')
  return process.platform == 'win32' ? resolved.toLowerCase() : resolved
}

// 订阅歌曲实际落地目录：优先使用订阅临时目录，未设置时回落原版下载目录
const getLocalDownloadDir = () => {
  const tempPath = global.lx.appSetting['subscription.tempPath'].trim()
  return path.resolve(tempPath || global.lx.appSetting['download.savePath'])
}

const pathsOverlap = (first: string, second: string) => {
  const a = comparablePath(first)
  const b = comparablePath(second)
  return a == b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`)
}

let calibrationExecutionRunning = false
const executeSubscriptionCalibration = async(
  config: LX.Subscription.Config,
  input: LX.Subscription.CalibrationScanInput,
  startNew: boolean,
): Promise<LX.Subscription.CalibrationSummary> => {
  if (calibrationExecutionRunning) throw new Error('已有扫描任务正在运行')
  calibrationExecutionRunning = true
  try {
    if (startNew) await global.lx.worker.dbService.beginSubscriptionCalibrationRun(input)
    else await global.lx.worker.dbService.resumeSubscriptionCalibrationRun()
    let run = await global.lx.worker.dbService.getSubscriptionCalibrationRun()
    if (!run) throw new Error('扫描运行记录不存在')
    if (run.status == 'collecting') {
      const files = await collectSubscriptionCalibrationFiles(config, input)
      run = await global.lx.worker.dbService.prepareSubscriptionCalibrationFiles(files)
    }
    for (const filePath of await global.lx.worker.dbService.getPendingSubscriptionCalibrationFiles()) {
      const file = await inspectSubscriptionCalibrationFile(filePath)
      run = await global.lx.worker.dbService.saveSubscriptionCalibrationFile(file)
    }
    const files = await global.lx.worker.dbService.getSubscriptionCalibrationRunFiles()
    if (files.length != run.total) throw new Error('扫描进度不完整，已保留现场等待恢复')
    const summary = await global.lx.worker.dbService.importSubscriptionCalibration(files)
    await global.lx.worker.dbService.completeSubscriptionCalibrationRun(summary)
    return summary
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await global.lx.worker.dbService.failSubscriptionCalibrationRun(message).catch(() => {})
    throw err
  } finally {
    // eslint-disable-next-line require-atomic-updates
    calibrationExecutionRunning = false
  }
}

export default () => {
  mainHandle(WIN_MAIN_RENDERER_EVENT_NAME.subscription_config_get, async() => {
    return global.lx.worker.dbService.getSubscriptionConfig()
  })
  mainHandle<LX.Subscription.ConfigUpdate, LX.Subscription.Config>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_config_update, async({ params }) => {
    const current = await global.lx.worker.dbService.getSubscriptionConfig()
    const next = { ...current, ...params }
    const downloadPath = getLocalDownloadDir()
    const cd2RootPath = next.cd2RootPath.trim() ? path.resolve(next.cd2RootPath) : ''
    if (cd2RootPath && pathsOverlap(downloadPath, cd2RootPath)) {
      throw new Error('LX Music 下载目录不能位于 CloudDrive2 音乐库内或包含 CloudDrive2 音乐库，请先修改原版下载目录')
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
    const targetPath = getLocalDownloadDir()
    // 刚设置的临时目录可能还不存在，先创建再查询，否则 statfs 会抛错导致队列停摆
    await fs.promises.mkdir(targetPath, { recursive: true }).catch(() => {})
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
    if (!task?.localPath || !task.cloudPath) throw new Error('上传任务缺少本地或 CloudDrive2 目标路径')
    return getSubscriptionCd2UploadStatus({
      config: await global.lx.worker.dbService.getSubscriptionConfig(),
      localPath: task.localPath,
      cloudPath: task.cloudPath,
    })
  })
  const manualSyncQualityRank: Record<string, number> = { '128k': 1, '320k': 2, flac: 3, flac24bit: 4 }
  mainHandle<{
    musicKey: string
    localPath: string
    fileName: string
    quality: LX.Subscription.Quality
    deleteLocal: boolean
  }, LX.Subscription.ManualSyncResult>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_cd2_manual_sync, async({ params }) => {
    const config = await global.lx.worker.dbService.getSubscriptionConfig()
    if (!config.cd2RootPath.trim() || !config.cd2GrpcUrl.trim() || !config.cd2ApiToken.trim()) {
      throw new Error('请先在「设置 → 订阅设置」中配置 CloudDrive2 音乐库与连接信息')
    }
    // 去重：同一首歌已在云端且音质不低于本地下载音质时跳过上传
    const entry = await global.lx.worker.dbService.getSubscriptionLibraryEntry(params.musicKey)
    if (entry?.cloudPath && entry.cloudQuality && manualSyncQualityRank[params.quality] <= manualSyncQualityRank[entry.cloudQuality]) {
      return { confirmed: true, skipped: true, cleaned: false }
    }
    const copied = await copySubscriptionFileToCd2({ config, localPath: params.localPath, currentCloudPath: null, retryCloudPath: null })
    if (!params.deleteLocal) return { confirmed: true, skipped: false, cleaned: false }
    // 需要删除本地文件：必须等到 CloudDrive2 明确确认上传成功，否则保留本地
    let status = await getSubscriptionCd2UploadStatus({ config, localPath: params.localPath, cloudPath: copied.cloudPath })
    const deadline = Date.now() + 5 * 60_000
    while (status.state == 'unconfirmed' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10_000))
      status = await getSubscriptionCd2UploadStatus({ config, localPath: params.localPath, cloudPath: copied.cloudPath })
    }
    if (status.state != 'success') return { confirmed: false, skipped: false, cleaned: false }
    await cleanupSubscriptionLocalFile({ config, localPath: params.localPath, cloudPath: copied.cloudPath })
    return { confirmed: true, skipped: false, cleaned: true }
  })
  mainHandle<string>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_cd2_cleanup_local, async({ params: taskId }) => {
    const task = (await global.lx.worker.dbService.getSubscriptionTasks()).find(item => item.id == taskId)
    if (!task?.localPath || !task.cloudPath) throw new Error('清理任务缺少本地或 CloudDrive2 目标路径')
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
    const activeStatuses: LX.Subscription.TaskStatus[] = ['resolving', 'downloading', 'downloaded', 'quality_check', 'tagging', 'uploading', 'upload_unconfirmed', 'old_version_cleanup']
    const activeTask = (await global.lx.worker.dbService.getSubscriptionTasks()).find(task => activeStatuses.includes(task.status))
    if (activeTask) throw new Error(`任务“${activeTask.name}”仍在处理中，请等待当前下载或上传结束后再重新扫描`)
    const config = await global.lx.worker.dbService.updateSubscriptionConfig({
      calibrationRootPath: params.rootPath,
      calibrationRecursive: params.recursive,
      calibrationIncludePaths: params.includePaths,
      calibrationExcludePaths: params.excludePaths,
    })
    return executeSubscriptionCalibration(config, params, true)
  })
  mainHandle<LX.Subscription.CalibrationRun | null>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_calibration_run_get, async() => {
    return global.lx.worker.dbService.getSubscriptionCalibrationRun()
  })
  mainHandle<LX.Subscription.CalibrationSummary>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_calibration_resume, async() => {
    const run = await global.lx.worker.dbService.getSubscriptionCalibrationRun()
    if (!run || run.status == 'completed') throw new Error('没有可恢复的扫描任务')
    const config = await global.lx.worker.dbService.getSubscriptionConfig()
    return executeSubscriptionCalibration(config, run.input, false)
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
    // 备份保存在本机软件数据目录，不写入 CloudDrive2 挂载目录
    const backupDir = path.join(global.lxDataPath, 'subscription-backups')
    await fs.promises.mkdir(backupDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '')
    const result = await global.lx.worker.dbService.backupSubscriptionDatabase(path.join(backupDir, `lx-data-${timestamp}.db`))
    // 只保留最近 10 份备份，文件名含时间戳可按名称排序
    const files = (await fs.promises.readdir(backupDir)).filter(name => name.endsWith('.db')).sort()
    for (const name of files.slice(0, Math.max(0, files.length - 10))) {
      await fs.promises.rm(path.join(backupDir, name), { force: true }).catch(() => {})
    }
    return result
  })
  mainHandle<number, LX.Subscription.HistoryItem[]>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_history_get, async({ params }) => {
    return global.lx.worker.dbService.getSubscriptionHistory(params)
  })
  mainHandle<string, number>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_history_clear, async({ params }) => {
    return global.lx.worker.dbService.clearSubscriptionHistory(params)
  })
  mainHandle<string, LX.Subscription.Task>(WIN_MAIN_RENDERER_EVENT_NAME.subscription_history_requeue, async({ params }) => {
    return global.lx.worker.dbService.requeueSubscriptionMusic(params)
  })
}
