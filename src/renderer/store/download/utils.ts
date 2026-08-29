import { appSetting } from '@renderer/store/setting'
import { defaultList, loveList, userLists } from '@renderer/store/list/listManage'
import { filterFileName } from '@common/utils/common'
import { clipFileNameLength } from '@common/utils/tools'
import { joinPath } from '@common/utils/nodejs'

export const buildSavePath = (musicInfo: LX.Download.ListItem) => {
  // 订阅歌曲下载到独立的临时目录（上传确认后自动清理），不与原版下载目录混用
  if (musicInfo.metadata.subscriptionTaskId && appSetting['subscription.tempPath']) {
    return appSetting['subscription.tempPath']
  }
  let savePath = appSetting['download.savePath']
  if (appSetting['download.isSavePathGroupByListName']) {
    let dirName: string | undefined
    const listId = musicInfo.metadata.listId
    switch (listId) {
      case defaultList.id:
        dirName = window.i18n.t(defaultList.name)
        break
      case loveList.id:
        dirName = window.i18n.t(loveList.name)
        break
      default:
        dirName = userLists.find(list => list.id === listId)?.name
        break
    }
    if (dirName) dirName = filterFileName(dirName)
    savePath = joinPath(savePath, clipFileNameLength(dirName ?? window.i18n.t(defaultList.name)))
  }
  return savePath
}
