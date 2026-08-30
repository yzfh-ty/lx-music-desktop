import {
  downloadTasksGet,
  // downloadListClear,
  downloadTasksCreate,
  downloadTasksRemove,
  downloadTasksUpdate,
  copySubscriptionToCd2,
  getSubscriptionTasks,
  updateSubscriptionTask,
  syncManualDownloadToCd2,
} from '@renderer/utils/ipc'
import {
  downloadList,
} from './state'
import { markRaw, toRaw } from '@common/utils/vueTools'
import { getMusicUrl, getMusicUrlDetail, getPicUrl, getLyricInfo } from '@renderer/core/music/online'
import { appSetting } from '../setting'
import { qualityList } from '..'
import { proxyCallback } from '@renderer/worker/utils'
import { arrPush, arrUnshift, joinPath } from '@renderer/utils'
import { DOWNLOAD_STATUS } from '@common/constants'
import { proxy } from '../index'
import { buildSavePath } from './utils'

const waitingUpdateTasks = new Map<string, LX.Download.ListItem>()
let timer: NodeJS.Timeout | null = null
const throttleUpdateTask = (tasks: LX.Download.ListItem[]) => {
  for (const task of tasks) waitingUpdateTasks.set(task.id, toRaw(task))
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void downloadTasksUpdate(Array.from(waitingUpdateTasks.values()))
    waitingUpdateTasks.clear()
  }, 100)
}

const runingTask = new Map<string, LX.Download.ListItem>()

// const initDownloadList = (list: LX.Download.ListItem[]) => {
//   downloadList.splice(0, downloadList.length, ...list)
// }

export const getDownloadList = async(): Promise<LX.Download.ListItem[]> => {
  if (!downloadList.length) {
    const list = await downloadTasksGet()
    for (const downloadInfo of list) {
      markRaw(downloadInfo.metadata)
      switch (downloadInfo.status) {
        case DOWNLOAD_STATUS.RUN:
        case DOWNLOAD_STATUS.WAITING:
          downloadInfo.status = DOWNLOAD_STATUS.PAUSE
          downloadInfo.statusText = window.i18n.t('download___status_paused')
        default:
          break
      }
    }
    arrPush(downloadList, list)
  }
  return downloadList
}

const addTasks = async(list: LX.Download.ListItem[]) => {
  const addMusicLocationType = appSetting['list.addMusicLocationType']

  await downloadTasksCreate(list.map(i => toRaw(i)), addMusicLocationType)

  if (addMusicLocationType === 'top') {
    arrUnshift(downloadList, list)
  } else {
    arrPush(downloadList, list)
  }
  window.app_event.downloadListUpdate()
}

const setStatusText = (downloadInfo: LX.Download.ListItem, text: string) => { // 设置状态文本
  downloadInfo.statusText = text
  throttleUpdateTask([downloadInfo])
}

const setUrl = (downloadInfo: LX.Download.ListItem, url: string) => {
  downloadInfo.metadata.url = url
  throttleUpdateTask([downloadInfo])
}

const updateFilePath = (downloadInfo: LX.Download.ListItem, filePath: string) => {
  downloadInfo.metadata.filePath = filePath
  throttleUpdateTask([downloadInfo])
}

const setProgress = (downloadInfo: LX.Download.ListItem, progress: LX.Download.ProgressInfo) => {
  downloadInfo.total = progress.total
  downloadInfo.downloaded = progress.downloaded
  downloadInfo.writeQueue = progress.writeQueue
  if (progress.progress == 100) {
    downloadInfo.speed = ''
    downloadInfo.progress = 99.99
    setStatusText(downloadInfo, window.i18n.t('download_status_write_queue', { num: progress.writeQueue }))
  } else {
    downloadInfo.speed = progress.speed
    downloadInfo.progress = progress.progress
  }
  throttleUpdateTask([downloadInfo])
  if (downloadInfo.metadata.subscriptionTaskId) {
    void updateSubscriptionTask({
      id: downloadInfo.metadata.subscriptionTaskId,
      status: 'downloading',
      progress: downloadInfo.progress,
      speed: downloadInfo.speed,
    })
  }
}

const setStatus = (downloadInfo: LX.Download.ListItem, status: LX.Download.DownloadTaskStatus, statusText?: string) => { // 设置状态及状态文本
  if (statusText == null) {
    switch (status) {
      case DOWNLOAD_STATUS.RUN:
        statusText = window.i18n.t('download___status_running')
        break
      case DOWNLOAD_STATUS.WAITING:
        statusText = window.i18n.t('download___status_waiting')
        break
      case DOWNLOAD_STATUS.PAUSE:
        statusText = window.i18n.t('download___status_paused')
        break
      case DOWNLOAD_STATUS.ERROR:
        statusText = window.i18n.t('download___status_error')
        break
      case DOWNLOAD_STATUS.COMPLETED:
        statusText = window.i18n.t('download___status_completed')
        break
      default:
        statusText = ''
        break
    }
  }

  if (downloadInfo.statusText == statusText && downloadInfo.status == status) return

  if (status == DOWNLOAD_STATUS.COMPLETED) downloadInfo.isComplate = true
  downloadInfo.statusText = statusText
  downloadInfo.status = status
  throttleUpdateTask([downloadInfo])
}

// 修复 1.1.x版本 酷狗源歌词格式
const fixKgLyric = (lrc: string) => /\[00:\d\d:\d\d.\d+\]/.test(lrc) ? lrc.replace(/(?:\[00:(\d\d:\d\d.\d+\]))/gm, '[$1') : lrc

const getProxy = () => {
  return proxy.enable && proxy.host ? {
    host: proxy.host,
    port: parseInt(proxy.port || '80'),
  } : proxy.envProxy ? {
    host: proxy.envProxy.host,
    port: parseInt(proxy.envProxy.port || '80'),
  } : undefined
}
/**
 * 设置歌曲meta信息
 * @param downloadInfo 下载任务信息
 */
const saveMeta = async(downloadInfo: LX.Download.ListItem) => {
  if (downloadInfo.metadata.quality === 'ape') return
  const isUseOtherSource = appSetting['download.isUseOtherSource']
  const tasks: [Promise<string | null>, Promise<LX.Player.LyricInfo | null>] = [
    appSetting['download.isEmbedPic']
      ? downloadInfo.metadata.musicInfo.meta.picUrl
        ? Promise.resolve(downloadInfo.metadata.musicInfo.meta.picUrl)
        : getPicUrl({ musicInfo: downloadInfo.metadata.musicInfo, isRefresh: false, allowToggleSource: isUseOtherSource }).catch(err => {
          console.log(err)
          return null
        })
      : Promise.resolve(null),
    appSetting['download.isEmbedLyric']
      ? getLyricInfo({ musicInfo: downloadInfo.metadata.musicInfo, isRefresh: false, allowToggleSource: isUseOtherSource }).catch(err => {
        console.log(err)
        return null
      })
      : Promise.resolve(null),
  ]
  await Promise.all(tasks).then(async([imgUrl, lyrics]) => {
    const info = {
      filePath: downloadInfo.metadata.filePath,
      isEmbedLyricLx: appSetting['download.isEmbedLyricLx'],
      isEmbedLyricT: appSetting['download.isEmbedLyricT'],
      isEmbedLyricR: appSetting['download.isEmbedLyricR'],
      title: downloadInfo.metadata.musicInfo.name,
      artist: downloadInfo.metadata.musicInfo.singer?.replaceAll('、', ';'),
      album: downloadInfo.metadata.musicInfo.meta.albumName,
      APIC: imgUrl,
    }
    await window.lx.worker.download.writeMeta(info, lyrics ?? { lyric: '' }, getProxy())
  })
}

/**
 * 保存歌词文件
 * @param downloadInfo 下载任务信息
 */
const downloadLyric = async(downloadInfo: LX.Download.ListItem) => {
  if (!appSetting['download.isDownloadLrc']) return
  const lrcs = await getLyricInfo({
    musicInfo: downloadInfo.metadata.musicInfo,
    isRefresh: false,
    allowToggleSource: appSetting['download.isUseOtherSource'],
  })
  if (lrcs.lyric) {
    lrcs.lyric = fixKgLyric(lrcs.lyric)
    const info = {
      filePath: downloadInfo.metadata.filePath.substring(0, downloadInfo.metadata.filePath.lastIndexOf('.')) + '.lrc',
      format: appSetting['download.lrcFormat'],
      downloadLxlrc: appSetting['download.isDownloadLxLrc'],
      downloadTlrc: appSetting['download.isDownloadTLrc'],
      downloadRlrc: appSetting['download.isDownloadRLrc'],
    }
    await window.lx.worker.download.saveLrc(lrcs, info)
  }
}

const qualityRank: Record<LX.Subscription.Quality, number> = { '128k': 1, '320k': 2, flac: 3, flac24bit: 4 }
const subscriptionSkipToken = '__LX_SUBSCRIPTION_SKIP__'

const removeSubscriptionDownloadEntry = async(downloadInfo: LX.Download.ListItem) => {
  await window.lx.worker.download.removeTask(downloadInfo.id)
  await downloadTasksRemove([downloadInfo.id])
  runingTask.delete(downloadInfo.id)
  const index = downloadList.findIndex(item => item.id == downloadInfo.id)
  if (index >= 0) downloadList.splice(index, 1)
  window.app_event.downloadListUpdate()
  void checkStartTask()
}

const markSubscriptionDownloadSkipped = async(downloadInfo: LX.Download.ListItem, reason: string) => {
  const taskId = downloadInfo.metadata.subscriptionTaskId
  if (taskId) {
    const task = (await getSubscriptionTasks()).find(item => item.id == taskId)
    await updateSubscriptionTask({
      id: taskId,
      status: task?.cloudQuality || task?.existingCloudPath ? 'uploaded' : 'discovered',
      failureReason: reason,
      speed: '',
      progress: 0,
    })
  }
}

// 手动下载的 CloudDrive2 同步：上传到 CloudDrive2 音乐库根目录，按设置决定是否清理本地文件；
// 失败只反映在下载列表状态文本上，本地文件始终保留
const syncManualDownloadCd2 = async(downloadInfo: LX.Download.ListItem, deleteLocal: boolean) => {
  try {
    setStatusText(downloadInfo, window.i18n.t('download_status_cd2_syncing'))
    const result = await syncManualDownloadToCd2({
      musicKey: `${downloadInfo.metadata.musicInfo.source}:${downloadInfo.metadata.musicInfo.id}`,
      localPath: downloadInfo.metadata.filePath,
      fileName: downloadInfo.metadata.fileName,
      quality: downloadInfo.metadata.quality as LX.Subscription.Quality,
      deleteLocal,
    })
    setStatusText(downloadInfo, result.skipped
      ? window.i18n.t('download_status_cd2_skipped')
      : result.cleaned
        ? window.i18n.t('download_status_cd2_done_cleaned')
        : window.i18n.t('download_status_cd2_done'))
  } catch (err) {
    setStatusText(downloadInfo, window.i18n.t('download_status_cd2_failed', {
      message: err instanceof Error ? err.message : String(err),
    }))
  }
}

const skipSubscriptionDownload = async(downloadInfo: LX.Download.ListItem, reason: string) => {
  await markSubscriptionDownloadSkipped(downloadInfo, reason)
  await removeSubscriptionDownloadEntry(downloadInfo)
}

const getUrl = async(downloadInfo: LX.Download.ListItem, isRefresh: boolean = false) => {
  if (downloadInfo.metadata.subscriptionTaskId) {
    const taskId = downloadInfo.metadata.subscriptionTaskId
    await updateSubscriptionTask({ id: taskId, status: 'resolving', requestedQuality: downloadInfo.metadata.quality as LX.Subscription.Quality })
    const result = await getMusicUrlDetail({
      musicInfo: downloadInfo.metadata.musicInfo,
      quality: downloadInfo.metadata.quality,
      allowToggleSource: appSetting['download.isUseOtherSource'],
    })
    const report = result.detail.sourceReportedQuality
    const task = (await getSubscriptionTasks()).find(item => item.id == taskId)
    // 音源报告音质仅用于下载前的快速跳过；旧版音源只返回 URL（report 为空）时照常下载，
    // 升级与否交由下载后的本地文件复核把关
    if (report && task?.cloudQuality && qualityRank[report] <= qualityRank[task.cloudQuality]) {
      await updateSubscriptionTask({ id: taskId, sourceReportedQuality: report })
      await markSubscriptionDownloadSkipped(downloadInfo, `音源报告音质 ${report} 未高于云端音质 ${task.cloudQuality}`)
      return subscriptionSkipToken
    }
    await updateSubscriptionTask({
      id: taskId,
      status: 'downloading',
      sourceReportedQuality: report ?? null,
      sourceUsed: appSetting['common.apiSource'],
      actualSource: result.musicInfo.source,
      actualSongId: result.musicInfo.id,
      failureReason: null,
    })
    return result.detail.url
  }
  let toggleMusicInfo = downloadInfo.metadata.musicInfo.meta.toggleMusicInfo
  return (toggleMusicInfo ? getMusicUrl({
    musicInfo: toggleMusicInfo,
    isRefresh,
    quality: downloadInfo.metadata.quality,
    allowToggleSource: false,
  }) : Promise.reject(new Error('not found'))).catch(() => {
    return getMusicUrl({
      musicInfo: downloadInfo.metadata.musicInfo,
      isRefresh: false,
      quality: downloadInfo.metadata.quality,
      allowToggleSource: appSetting['download.isUseOtherSource'],
    })
  }).catch(() => '')
}
const handleRefreshUrl = (downloadInfo: LX.Download.ListItem) => {
  setStatusText(downloadInfo, window.i18n.t('download_status_error_refresh_url'))
  if (downloadInfo.metadata.subscriptionTaskId) {
    void getUrl(downloadInfo, true).then(async url => {
      if (url == subscriptionSkipToken) {
        await removeSubscriptionDownloadEntry(downloadInfo)
        return
      }
      if (!url) throw new Error(window.i18n.t('download_status_error_url_failed'))
      setUrl(downloadInfo, url)
      await window.lx.worker.download.updateUrl(downloadInfo.id, url)
    }).catch(err => { handleError(downloadInfo, err instanceof Error ? err.message : String(err)) })
    return
  }
  let toggleMusicInfo = downloadInfo.metadata.musicInfo.meta.toggleMusicInfo
  ;(toggleMusicInfo ? getMusicUrl({
    musicInfo: toggleMusicInfo,
    isRefresh: true,
    quality: downloadInfo.metadata.quality,
    allowToggleSource: false,
  }) : Promise.reject(new Error('not found'))).catch(() => {
    return getMusicUrl({
      musicInfo: downloadInfo.metadata.musicInfo,
      isRefresh: true,
      quality: downloadInfo.metadata.quality,
      allowToggleSource: appSetting['download.isUseOtherSource'],
    })
  })
    .catch(() => '')
    .then(url => {
    // commit('setStatusText', { downloadInfo, text: '链接刷新成功' })
      setUrl(downloadInfo, url)
      void window.lx.worker.download.updateUrl(downloadInfo.id, url)
    })
    .catch(err => {
      console.log(err)
      handleError(downloadInfo, err.message)
    })
}
const handleError = (downloadInfo: LX.Download.ListItem, message?: string) => {
  setStatus(downloadInfo, DOWNLOAD_STATUS.ERROR, message)
  void window.lx.worker.download.removeTask(downloadInfo.id)
  runingTask.delete(downloadInfo.id)
  if (downloadInfo.metadata.subscriptionTaskId) {
    void updateSubscriptionTask({
      id: downloadInfo.metadata.subscriptionTaskId,
      status: 'failed',
      failureReason: message ?? '下载失败',
      speed: '',
    })
  }
  void checkStartTask()
}

export const resumeSubscriptionPostProcess = async(downloadInfo: LX.Download.ListItem, ignoreUnsupportedMetadata = false) => {
  const taskId = downloadInfo.metadata.subscriptionTaskId!
  try {
    await updateSubscriptionTask({ id: taskId, status: 'quality_check', localPath: downloadInfo.metadata.filePath, downloadCompletedAt: Date.now(), progress: 100, speed: '' })
    const inspection = await window.lx.worker.download.inspectAudioFile(downloadInfo.metadata.filePath)
    if (inspection.extension && inspection.extension != downloadInfo.metadata.ext) {
      const oldPath = downloadInfo.metadata.filePath
      const oldSuffix = `.${downloadInfo.metadata.ext}`
      const fileBase = oldPath.toLowerCase().endsWith(oldSuffix) ? oldPath.slice(0, -oldSuffix.length) : oldPath
      const correctedPath = `${fileBase}.${inspection.extension}`
      await window.lx.worker.download.renameLocalFile(oldPath, correctedPath)
      downloadInfo.metadata.ext = inspection.extension
      downloadInfo.metadata.fileName = downloadInfo.metadata.fileName.replace(/\.[^.]+$/, `.${inspection.extension}`)
      updateFilePath(downloadInfo, correctedPath)
      await updateSubscriptionTask({ id: taskId, localPath: correctedPath })
    }
    const task = (await getSubscriptionTasks()).find(item => item.id == taskId)
    if (!inspection.quality) {
      await window.lx.worker.download.removeLocalFile(downloadInfo.metadata.filePath)
      await skipSubscriptionDownload(downloadInfo, '无法从本地文件识别可比较的实际音质')
      return
    }
    if (task?.cloudQuality && qualityRank[inspection.quality] <= qualityRank[task.cloudQuality]) {
      await window.lx.worker.download.removeLocalFile(downloadInfo.metadata.filePath)
      await skipSubscriptionDownload(downloadInfo, `本地复核音质 ${inspection.quality} 未高于云端音质 ${task.cloudQuality}`)
      return
    }
    if (!ignoreUnsupportedMetadata && !['mp3', 'flac'].includes(downloadInfo.metadata.ext)) {
      throw new Error(`当前 ${downloadInfo.metadata.ext.toUpperCase()} 格式不支持内嵌订阅所需的完整元数据，未上传到 CloudDrive2`)
    }
    await updateSubscriptionTask({ id: taskId, status: 'tagging', fileVerifiedQuality: inspection.quality })
    if (!ignoreUnsupportedMetadata) await saveMeta(downloadInfo)
    await downloadLyric(downloadInfo)
    await updateSubscriptionTask({ id: taskId, localPath: downloadInfo.metadata.filePath })
    const finalTask = await copySubscriptionToCd2(taskId)
    downloadInfo.progress = 100
    setStatus(downloadInfo, DOWNLOAD_STATUS.COMPLETED,
      finalTask.status == 'local_completed' ? '仅本地完成' : window.i18n.t('download___status_completed'))
    void window.lx.worker.download.removeTask(downloadInfo.id)
    runingTask.delete(downloadInfo.id)
    void checkStartTask()
  } catch (err) {
    handleError(downloadInfo, err instanceof Error ? err.message : String(err))
  }
}

export const resumeSubscriptionTaskPostProcess = async(task: LX.Subscription.Task, ignoreUnsupportedMetadata = false) => {
  if (!task.localPath) throw new Error('订阅后处理任务缺少本地文件路径')
  const existing = downloadList.find(item => item.metadata.subscriptionTaskId == task.id && item.metadata.filePath)
  if (existing) return resumeSubscriptionPostProcess(existing, ignoreUnsupportedMetadata)
  const fileName = task.localPath.split(/[\\/]/).pop() ?? `${task.name}.mp3`
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (!['mp3', 'flac', 'wav', 'ape'].includes(extension ?? '')) throw new Error('订阅后处理任务的本地文件扩展名不受支持')
  const downloadInfo: LX.Download.ListItem = {
    id: `subscription_postprocess_${task.id}_${Date.now()}`,
    isComplate: false,
    status: DOWNLOAD_STATUS.ERROR,
    statusText: '',
    downloaded: 0,
    total: 0,
    progress: 100,
    speed: '',
    writeQueue: 0,
    metadata: {
      musicInfo: task.musicInfo,
      url: null,
      quality: (task.requestedQuality ?? task.fileVerifiedQuality ?? '128k') as LX.Quality,
      ext: extension as LX.Download.FileExt,
      fileName,
      filePath: task.localPath,
      subscriptionTaskId: task.id,
    },
  }
  return resumeSubscriptionPostProcess(downloadInfo, ignoreUnsupportedMetadata)
}

const handleStartTask = async(downloadInfo: LX.Download.ListItem) => {
  if (!downloadInfo.metadata.url) {
    setStatusText(downloadInfo, window.i18n.t('download_status_url_getting'))
    let url: string
    try {
      url = await getUrl(downloadInfo)
    } catch (err) {
      handleError(downloadInfo, err instanceof Error ? err.message : String(err))
      return
    }
    if (url == subscriptionSkipToken) {
      await removeSubscriptionDownloadEntry(downloadInfo)
      return
    }
    if (!url) {
      handleError(downloadInfo, window.i18n.t('download_status_error_url_failed'))
      return
    }
    setUrl(downloadInfo, url)
    if (downloadInfo.status != DOWNLOAD_STATUS.RUN) return
  }

  const savePath = buildSavePath(downloadInfo)
  const filePath = joinPath(savePath, downloadInfo.metadata.fileName)
  if (downloadInfo.metadata.filePath != filePath) updateFilePath(downloadInfo, filePath)

  setStatusText(downloadInfo, window.i18n.t('download_status_start'))

  await window.lx.worker.download.startTask(toRaw(downloadInfo), savePath, appSetting['download.skipExistFile'], proxyCallback((event: LX.Download.DownloadTaskActions) => {
    // console.log(event)
    switch (event.action) {
      case 'start':
        setStatus(downloadInfo, DOWNLOAD_STATUS.RUN)
        break
      case 'complete':
        if (downloadInfo.metadata.subscriptionTaskId) {
          // 下载已结束，先释放下载槽位；音质复核、元数据与上传属于后续任务阶段
          void window.lx.worker.download.removeTask(downloadInfo.id)
          runingTask.delete(downloadInfo.id)
          void checkStartTask()
          void resumeSubscriptionPostProcess(downloadInfo)
          break
        }
        downloadInfo.progress = 100
        void saveMeta(downloadInfo)
        void downloadLyric(downloadInfo)
        void window.lx.worker.download.removeTask(downloadInfo.id)
        runingTask.delete(downloadInfo.id)
        setStatus(downloadInfo, DOWNLOAD_STATUS.COMPLETED)
        // 手动下载的 CloudDrive2 同步：上传并保留本地，或上传后清理本地（在下载设置中配置）
        if (appSetting['download.cd2SyncMode'] != 'off') {
          void syncManualDownloadCd2(downloadInfo, appSetting['download.cd2SyncMode'] == 'clean')
        }
        void checkStartTask()
        break
      case 'refreshUrl':
        handleRefreshUrl(downloadInfo)
        break
      case 'statusText':
        setStatusText(downloadInfo, event.data)
        break
      case 'progress':
        setProgress(downloadInfo, event.data)
        break
      case 'error':
        handleError(downloadInfo, event.data.error
          ? window.i18n.t(event.data.error) + (event.data.message ?? '')
          : event.data.message,
        )
        break
      default:
        break
    }
  }), getProxy())
}
const startTask = async(downloadInfo: LX.Download.ListItem) => {
  setStatus(downloadInfo, DOWNLOAD_STATUS.RUN)
  runingTask.set(downloadInfo.id, downloadInfo)
  void handleStartTask(downloadInfo)
}

const getStartTask = (list: LX.Download.ListItem[]): LX.Download.ListItem | null => {
  let downloadCount = 0
  const waitList = list.filter(item => {
    if (item.status == DOWNLOAD_STATUS.WAITING) return true
    if (item.status == DOWNLOAD_STATUS.RUN) ++downloadCount
    return false
  })
  // console.log(downloadCount, waitList)
  return downloadCount < appSetting['download.maxDownloadNum'] ? waitList.shift() ?? null : null
}

const checkStartTask = async() => {
  if (runingTask.size >= appSetting['download.maxDownloadNum']) return
  let result = getStartTask(downloadList)
  // console.log(result)
  while (result) {
    await startTask(result)
    result = getStartTask(downloadList)
  }
}

/**
 * 过滤重复任务
 * @param list
 */
const filterTask = (list: LX.Download.ListItem[]) => {
  const set = new Set<string>()
  for (const item of downloadList) set.add(item.id)
  return list.filter(item => {
    if (set.has(item.id)) return false
    markRaw(item.metadata)
    set.add(item.id)
    return true
  })
}
/**
 * 创建下载任务
 * @param list 要下载的歌曲
 * @param quality 下载音质
 */
export const createDownloadTasks = async(list: LX.Music.MusicInfoOnline[], quality: LX.Quality, listId?: string, subscriptionTaskId?: string) => {
  if (!list.length) return []
  const createdTasks = await window.lx.worker.download.createDownloadTasks(list, quality,
    appSetting['download.fileName'], toRaw(qualityList.value), listId)
  if (subscriptionTaskId) {
    for (const task of createdTasks) {
      task.id = `${task.id}_subscription_${subscriptionTaskId}_${Date.now()}`
      task.metadata.subscriptionTaskId = subscriptionTaskId
    }
  }
  const tasks = filterTask(createdTasks)

  if (tasks.length) await addTasks(tasks)
  void checkStartTask()
  return tasks
}

/**
 * 开始下载任务
 * @param list
 */
export const startDownloadTasks = async(list: LX.Download.ListItem[]) => {
  for (const downloadInfo of list) {
    switch (downloadInfo.status) {
      case DOWNLOAD_STATUS.PAUSE:
      case DOWNLOAD_STATUS.ERROR:
        if (runingTask.size < appSetting['download.maxDownloadNum']) void startTask(downloadInfo)
        else setStatus(downloadInfo, DOWNLOAD_STATUS.WAITING)
      default:
        break
    }
  }
  void checkStartTask()
}

/**
 * 暂停下载任务
 * @param list
 */
export const pauseDownloadTasks = async(list: LX.Download.ListItem[]) => {
  for (const downloadInfo of list) {
    switch (downloadInfo.status) {
      case DOWNLOAD_STATUS.RUN:
        void window.lx.worker.download.pauseTask(downloadInfo.id)
        runingTask.delete(downloadInfo.id)
      case DOWNLOAD_STATUS.WAITING:
      case DOWNLOAD_STATUS.ERROR:
        setStatus(downloadInfo, DOWNLOAD_STATUS.PAUSE)
      default:
        break
    }
    if (downloadInfo.metadata.subscriptionTaskId && !downloadInfo.isComplate && downloadInfo.status == DOWNLOAD_STATUS.PAUSE) {
      void updateSubscriptionTask({
        id: downloadInfo.metadata.subscriptionTaskId,
        status: 'disk_paused',
        pauseOrigin: 'manual',
        failureReason: '用户在下载列表中暂停',
        speed: '',
      })
    }
  }
  void checkStartTask()
}

/**
 * 移除下载任务
 * @param ids 要移除的任务Id
 */
export const removeDownloadTasks = async(ids: string[]) => {
  await downloadTasksRemove(ids)

  const idsSet = new Set<string>(ids)
  const newList = downloadList.filter(task => {
    if (!idsSet.has(task.id)) return true
    if (runingTask.has(task.id)) {
      void window.lx.worker.download.removeTask(task.id)
      runingTask.delete(task.id)
    }
    if (task.metadata.subscriptionTaskId && !task.isComplate) {
      void updateSubscriptionTask({
        id: task.metadata.subscriptionTaskId,
        status: 'failed',
        failureReason: '订阅下载任务已从原版下载列表中移除',
        speed: '',
      })
    }
    return false
  })
  downloadList.splice(0, downloadList.length)
  arrPush(downloadList, newList)


  void checkStartTask()
  window.app_event.downloadListUpdate()
}
