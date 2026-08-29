<template>
  <div :class="$style.subscription">
    <div :class="$style.header">
      <base-tab v-model="activeTab" :list="tabs" />
    </div>
    <div :class="[$style.content, $style.contentFixed]">
      <p v-if="notice" :class="[$style.notice, noticeError && $style.error]">{{ notice }}</p>

      <div v-if="isTaskTab && state.config?.diskLocked" :class="$style.lockBar">
        <span>{{ $t('subscription__disk_locked_tip', { time: formatTime(state.config!.diskPausedAt) }) }}</span>
        <base-btn min outline :disabled="busy" @click="handleUnlockDisk">{{ $t('subscription__disk_unlock') }}</base-btn>
      </div>

      <template v-if="isTaskTab">
        <div v-if="activeTab == 'failed'" :class="$style.toolbar">
          <span>{{ $t('subscription__task_failed_only') }}</span>
          <div :class="$style.toolbarActions">
            <base-btn min outline :disabled="!selectedRetryIds.length || busy" @click="handleRetrySelected">
              {{ $t('subscription__task_retry_selected', { count: selectedRetryIds.length }) }}
            </base-btn>
            <base-btn min :disabled="!visibleTasks.length || busy" @click="handleRetryAll">
              {{ $t('subscription__task_retry_all') }}
            </base-btn>
          </div>
        </div>
        <div class="thead" :class="$style.thead">
          <table>
            <thead>
              <tr>
                <th class="num" style="width: 5%;">#</th>
                <th class="nobreak">{{ $t('music_name') }}</th>
                <th class="nobreak" style="width: 20%;">{{ $t('download__progress') }}</th>
                <th class="nobreak" style="width: 22%;">{{ $t('download__status') }}</th>
                <th class="nobreak" style="width: 10%;">{{ $t('download__quality') }}</th>
                <th class="nobreak" style="width: 13%;">{{ $t('action') }}</th>
              </tr>
            </thead>
          </table>
        </div>
        <div v-if="visibleTasks.length" :class="$style.listContent">
          <base-virtualized-list
            v-slot="{ item, index }: { item: LX.Subscription.Task, index: number }" :list="visibleTasks" key-name="id" :item-height="listItemHeight"
            container-class="scroll" content-class="list"
          >
            <div
              class="list-item" :class="{ selected: selectedRetryIds.includes(item.id) }"
              @click="toggleTaskSelected(item)" @contextmenu="showMenu($event, item)"
            >
              <div class="list-item-cell no-select num" style="flex: 0 0 5%;">{{ index + 1 }}</div>
              <div class="list-item-cell auto name">
                <span class="select name" :aria-label="taskTitle(item)">{{ taskTitle(item) }}</span>
              </div>
              <div class="list-item-cell" style="flex: 0 0 20%;">{{ item.progress.toFixed(1) }}%<span v-if="item.speed"> - {{ item.speed }}/s</span></div>
              <div class="list-item-cell" style="flex: 0 0 22%;" :aria-label="statusDetailText(item)" :title="statusDetailText(item)">{{ statusDetailText(item) }}</div>
              <div class="list-item-cell" style="flex: 0 0 10%;">{{ shortQualityText(effectiveQuality(item)) }}</div>
              <div class="list-item-cell" style="flex: 0 0 13%; padding-left: 0; padding-right: 0;" @click.stop>
                <material-list-buttons
                  :index="index" :download-btn="false" :play-btn="false" :list-add-btn="false" :file-btn="false" :remove-btn="false"
                  :start-btn="item.status == 'failed' || item.status == 'disk_paused'"
                  :pause-btn="canPause(item)"
                  :search-btn="item.status == 'upload_unconfirmed'"
                  @btn-click="handleListBtnClick"
                />
              </div>
            </div>
          </base-virtualized-list>
        </div>
        <div v-else :class="$style.noItem"><p>{{ $t('subscription__task_empty') }}</p></div>
      </template>

      <template v-else-if="activeTab == 'history'">
        <div :class="$style.filterBar">
          <base-input v-model="historyFilter.keyword" :placeholder="$t('subscription__history_search')" />
          <base-selection v-model="historyFilter.source" :list="historySourceOptions" item-key="id" item-name="name" />
          <base-selection v-model="historyFilter.status" :list="historyStatusOptions" item-key="id" item-name="name" />
        </div>
        <div class="thead" :class="$style.thead">
          <table>
            <thead>
              <tr>
                <th class="num" style="width: 5%;">#</th>
                <th class="nobreak" style="width: 15%;">{{ $t('subscription__history_col_time') }}</th>
                <th class="nobreak">{{ $t('music_name') }}</th>
                <th class="nobreak" style="width: 10%;">{{ $t('download__quality') }}</th>
                <th class="nobreak" style="width: 24%;">{{ $t('subscription__col_status') }}</th>
                <th class="nobreak" style="width: 13%;">{{ $t('action') }}</th>
              </tr>
            </thead>
          </table>
        </div>
        <div v-if="visibleHistory.length" :class="$style.listContent">
          <base-virtualized-list
            v-slot="{ item, index }: { item: LX.Subscription.HistoryItem, index: number }" :list="visibleHistory" key-name="id" :item-height="listItemHeight"
            container-class="scroll" content-class="list"
          >
            <div class="list-item">
              <div class="list-item-cell no-select num" style="flex: 0 0 5%;">{{ index + 1 }}</div>
              <div class="list-item-cell" style="flex: 0 0 15%;">{{ formatTime(item.createdAt) }}</div>
              <div class="list-item-cell auto name">
                <span class="select name" :aria-label="historyTitle(item)" :title="historyTitle(item)">{{ item.name }}</span>
              </div>
              <div class="list-item-cell" style="flex: 0 0 10%;">{{ shortQualityText(historyQuality(item)) }}</div>
              <div class="list-item-cell" style="flex: 0 0 24%;" :aria-label="historyStatusText(item)" :title="historyStatusText(item)">
                {{ historyStatusText(item) }}
              </div>
              <div :class="$style.rowActions" style="flex: 0 0 13%;" @click.stop>
                <button @click="handleHistoryRequeue(item)">{{ $t('subscription__history_requeue') }}</button>
                <button :class="$style.danger" @click="handleHistoryClear(item)">{{ $t('subscription__history_clear') }}</button>
              </div>
            </div>
          </base-virtualized-list>
        </div>
        <div v-else :class="$style.noItem"><p>{{ $t('subscription__history_empty') }}</p></div>
      </template>

      <template v-else-if="activeTab == 'subscriptions'">
        <div :class="$style.addForm">
          <base-selection v-model="newItem.source" :class="$style.select" :list="sourceOptions" item-key="id" item-name="name" />
          <base-input v-model="newItem.listId" :placeholder="$t('subscription__add_list_id')" />
          <base-input v-model="newItem.name" :placeholder="$t('subscription__add_name')" />
          <base-input v-model="newItem.interval" type="number" :placeholder="$t('subscription__add_interval')" />
          <base-btn min outline :disabled="busy" @click="listPickerVisible = true">{{ $t('subscription__add_browse') }}</base-btn>
          <base-btn min :disabled="busy || !canCreate" @click="handleCreate">{{ $t('subscription__add_submit') }}</base-btn>
          <p :class="$style.addTip">{{ $t('subscription__add_tip') }}</p>
        </div>
        <div v-if="editingSubscriptionId" :class="$style.editForm">
          <label>
            <span>{{ $t('subscription__edit_name') }}</span>
            <base-input v-model="subscriptionEdit.name" />
          </label>
          <label>
            <span>{{ $t('subscription__edit_interval') }}</span>
            <base-input v-model="subscriptionEdit.interval" type="number" :placeholder="$t('subscription__edit_interval_placeholder')" />
          </label>
          <base-btn min :disabled="busy || !subscriptionEdit.name.trim()" @click="handleSaveSubscriptionEdit">{{ $t('subscription__edit_save') }}</base-btn>
          <base-btn min outline :disabled="busy" @click="cancelSubscriptionEdit">{{ $t('subscription__edit_cancel') }}</base-btn>
        </div>
        <div class="thead" :class="$style.thead">
          <table>
            <thead>
              <tr>
                <th class="num" style="width: 5%;">#</th>
                <th class="nobreak">{{ $t('subscription__col_name') }}</th>
                <th class="nobreak" style="width: 16%;">{{ $t('subscription__col_platform') }}</th>
                <th class="nobreak" style="width: 10%;">{{ $t('subscription__col_interval') }}</th>
                <th class="nobreak" style="width: 16%;">{{ $t('subscription__col_last_sync') }}</th>
                <th class="nobreak" style="width: 10%;">{{ $t('subscription__col_status') }}</th>
                <th class="nobreak" style="width: 14%;">{{ $t('action') }}</th>
              </tr>
            </thead>
          </table>
        </div>
        <div v-if="state.subscriptions.length" :class="$style.listContent">
          <base-virtualized-list
            v-slot="{ item, index }: { item: LX.Subscription.ListItem, index: number }" :list="state.subscriptions" key-name="id" :item-height="listItemHeight"
            container-class="scroll" content-class="list"
          >
            <div class="list-item">
              <div class="list-item-cell no-select num" style="flex: 0 0 5%;">{{ index + 1 }}</div>
              <div class="list-item-cell auto name">
                <span class="select name" :aria-label="item.name" :title="item.lastError || item.name">{{ item.name }}</span>
              </div>
              <div class="list-item-cell" style="flex: 0 0 16%;">{{ item.source }} · {{ listTypeText(item.listType) }}</div>
              <div class="list-item-cell" style="flex: 0 0 10%;">{{ intervalText(item.intervalMinutes) }}</div>
              <div class="list-item-cell" style="flex: 0 0 16%;">{{ formatTime(item.lastSyncAt) }}</div>
              <div class="list-item-cell" style="flex: 0 0 10%;">
                {{ item.enabled ? $t('subscription__state_running') : $t('subscription__state_paused') }}
              </div>
              <div :class="$style.rowActions" style="flex: 0 0 14%;" @click.stop>
                <button :disabled="isSyncing(item.id)" @click="handleSync(item)">
                  {{ isSyncing(item.id) ? $t('subscription__action_syncing') : $t('subscription__action_sync') }}
                </button>
                <button @click="startSubscriptionEdit(item)">{{ $t('subscription__action_edit') }}</button>
                <button @click="handleToggle(item)">
                  {{ item.enabled ? $t('subscription__action_pause') : $t('subscription__action_resume') }}
                </button>
                <button :class="$style.danger" @click="handleRemove(item)">{{ $t('subscription__action_remove') }}</button>
              </div>
            </div>
          </base-virtualized-list>
        </div>
        <div v-else :class="$style.noItem"><p>{{ $t('subscription__empty') }}</p></div>
      </template>

    </div>
    <base-menu v-model="isShowItemMenu" :menus="menus" :xy="menuLocation" item-name="name" @menu-click="handleMenuClick" />
    <list-picker v-model="listPickerVisible" :source-list="sourceOptions" @select="handleListPickerSelect" />
  </div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from '@common/utils/vueTools'
import { dialog } from '@renderer/plugins/Dialog'
import { isFullscreen } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import { downloadList } from '@renderer/store/download/state'
import { formatMusicName, getFontSizeWithScreen } from '@renderer/utils'
import { useI18n } from '@root/lang'
import {
  clearSubscriptionHistory,
  createSubscription,
  ignoreTaskMetadataAndUpload,
  pauseTask,
  recheckSubscriptionUpload,
  refreshSubscriptionRuntimeStatus,
  refreshSubscriptionState,
  requeueSubscriptionHistoryMusic,
  removeSubscription,
  resumeTask,
  retryTasks,
  subscriptionState as state,
  syncSubscription,
  unlockDiskQueue,
  updateSubscription,
  uploadLocalCompletedTask,
} from '@renderer/store/subscription'
import ListPicker from './components/ListPicker.vue'

const t = useI18n()

const activeTab = ref('tasks')
const busy = ref(false)
const listPickerVisible = ref(false)
const notice = ref('')
const noticeError = ref(false)
const currentTime = ref(Date.now())
const editingSubscriptionId = ref<string | null>(null)
const selectedRetryIds = ref<string[]>([])
const newItem = reactive({ source: 'wy' as LX.OnlineSource, listType: 'playlist' as LX.Subscription.ListType, listId: '', name: '', interval: '' })
const subscriptionEdit = reactive({ name: '', interval: '' })
const historyFilter = reactive({ keyword: '', source: 'all', status: 'all' })

const isShowItemMenu = ref(false)
const menuLocation = reactive({ x: 0, y: 0 })
const menuTask = shallowRef<LX.Subscription.Task | null>(null)

// 下面这些列表都要是 computed，切换语言时才会跟着变
const tabs = computed(() => [
  { id: 'tasks', label: t('subscription__tab_tasks') },
  { id: 'failed', label: t('subscription__tab_failed') },
  { id: 'history', label: t('subscription__tab_history') },
  { id: 'subscriptions', label: t('subscription__tab_subscriptions') },
])
const sourceIds: LX.OnlineSource[] = ['kw', 'kg', 'tx', 'wy', 'mg']
const sourceOptions = computed<Array<{ id: LX.OnlineSource, name: string }>>(() =>
  sourceIds.map(id => ({ id, name: t(`source_${id}` as 'source_kw') })))
const historySourceOptions = computed(() => [
  { id: 'all', name: t('subscription__history_all_sources') },
  ...sourceOptions.value,
])
const historyStatusOptions = computed(() => [
  { id: 'all', name: t('subscription__history_all_statuses') },
  ...([
    'pending', 'downloading', 'tagging', 'uploading', 'upload_unconfirmed',
    'cleanup_wait', 'uploaded', 'local_completed', 'failed', 'calibration_unresolved',
  ] as LX.Subscription.TaskStatus[]).map(id => ({ id, name: statusText(id) })),
])

const downloadTaskStatusMap: Partial<Record<LX.Download.DownloadTaskStatus, LX.Subscription.TaskStatus>> = {
  run: 'downloading',
  waiting: 'pending',
  pause: 'disk_paused',
  error: 'failed',
}
// base-virtualized-list 是无类型的 JS 组件，模板里必须显式标注 v-slot 的解构类型才能过 noImplicitAny。
// 注意只能用全局的 LX 命名空间：vue-loader 把模板编译成独立的 TS 模块，看不到这里的局部类型别名。
const liveTasks = computed<LX.Subscription.Task[]>(() => state.tasks.map(task => {
  const downloadInfo = downloadList.find(item => item.metadata.subscriptionTaskId == task.id)
  if (!downloadInfo || downloadInfo.isComplate) return task
  const status = downloadTaskStatusMap[downloadInfo.status] ?? task.status
  return {
    ...task,
    status,
    progress: downloadInfo.progress,
    speed: downloadInfo.speed,
    failureReason: downloadInfo.status == 'error' ? downloadInfo.statusText || task.failureReason : task.failureReason,
  }
}))
const visibleTasks = computed(() => activeTab.value == 'failed' ? liveTasks.value.filter(task => task.status == 'failed') : liveTasks.value)
const isTaskTab = computed(() => activeTab.value == 'tasks' || activeTab.value == 'failed')
const listItemHeight = computed(() => Math.ceil((isFullscreen.value ? getFontSizeWithScreen() : appSetting['common.fontSize']) * 2.3))
const visibleHistory = computed(() => {
  const keyword = historyFilter.keyword.trim().toLocaleLowerCase()
  return state.history.filter(item => {
    if (keyword && !`${item.name} ${item.singer} ${item.musicKey}`.toLocaleLowerCase().includes(keyword)) return false
    if (historyFilter.source != 'all' && item.source != historyFilter.source) return false
    if (historyFilter.status != 'all' && item.status != historyFilter.status) return false
    return true
  })
})
const canCreate = computed(() => newItem.listId.trim() && newItem.name.trim() && (!newItem.interval || Number(newItem.interval) > 0))
const menus = computed(() => {
  const task = menuTask.value
  return [
    { name: t('subscription__task_action_retry'), action: 'retry', hide: task?.status != 'failed' },
    { name: t('subscription__task_action_ignore_meta'), action: 'ignoreMeta', hide: !(task && canIgnoreMetadata(task)) },
    { name: t('subscription__task_action_recheck'), action: 'recheck', hide: task?.status != 'upload_unconfirmed' },
    { name: t('subscription__task_action_reupload'), action: 'reupload', hide: task?.status != 'upload_unconfirmed' },
    {
      name: t('subscription__task_action_upload'),
      action: 'upload',
      hide: !(task?.status == 'local_completed' && state.config?.syncToCd2),
    },
    { name: t('subscription__task_action_pause'), action: 'pause', hide: !(task && canPause(task)) },
    { name: t('subscription__task_action_resume'), action: 'resume', hide: task?.status != 'disk_paused' },
  ]
})

watch(activeTab, () => {
  if (activeTab.value != 'failed') selectedRetryIds.value = []
})

const run = async<T>(action: () => Promise<T>, success: string | ((result: T) => string)) => {
  busy.value = true
  notice.value = ''
  noticeError.value = false
  try {
    const result = await action()
    notice.value = typeof success == 'function' ? success(result) : success
  } catch (err) {
    notice.value = err instanceof Error ? err.message : String(err)
    noticeError.value = true
  } finally {
    busy.value = false
  }
}
const handleCreate = async() => run(async() => {
  await createSubscription({
    source: newItem.source,
    listType: newItem.listType,
    listId: newItem.listId,
    name: newItem.name,
    intervalMinutes: newItem.interval ? Number(newItem.interval) : null,
  })
  newItem.listId = ''
  newItem.name = ''
  newItem.interval = ''
}, () => t('subscription__added'))
const handleListPickerSelect = (selection: { source: LX.OnlineSource, listType: LX.Subscription.ListType, listId: string, name: string }) => {
  newItem.source = selection.source
  newItem.listType = selection.listType
  newItem.listId = selection.listId
  newItem.name = selection.name
}
const handleSync = async(item: LX.Subscription.ListItem) => run(
  async() => syncSubscription(item),
  result => result
    ? t('subscription__sync_done', { discovered: result.discovered, queued: result.queued, skipped: result.skipped })
    : t('subscription__sync_busy'),
)
const handleToggle = async(item: LX.Subscription.ListItem) => run(
  async() => updateSubscription({ id: item.id, enabled: !item.enabled }),
  () => item.enabled ? t('subscription__paused_tip') : t('subscription__resumed_tip'),
)
const startSubscriptionEdit = (item: LX.Subscription.ListItem) => {
  editingSubscriptionId.value = item.id
  subscriptionEdit.name = item.name
  subscriptionEdit.interval = item.intervalMinutes == null ? '' : String(item.intervalMinutes)
}
const cancelSubscriptionEdit = () => { editingSubscriptionId.value = null }
const handleSaveSubscriptionEdit = async() => run(async() => {
  if (!editingSubscriptionId.value) return
  const interval = subscriptionEdit.interval.trim() ? Number(subscriptionEdit.interval) : null
  if (interval != null && (!Number.isInteger(interval) || interval <= 0)) throw new Error(t('subscription__edit_interval_invalid'))
  await updateSubscription({ id: editingSubscriptionId.value, name: subscriptionEdit.name, intervalMinutes: interval })
  editingSubscriptionId.value = null
}, () => t('subscription__edit_saved'))
const handleRemove = async(item: LX.Subscription.ListItem) => {
  if (!await dialog.confirm(t('subscription__remove_confirm', { name: item.name }))) return
  await run(async() => removeSubscription(item.id), () => t('subscription__removed'))
}
const handleRetry = async(task: LX.Subscription.Task) => run(
  async() => retryTasks([task.id]),
  () => t('subscription__task_retried'),
)
const handleRetrySelected = async() => run(async() => {
  const count = await retryTasks(selectedRetryIds.value)
  selectedRetryIds.value = []
  return count
}, count => t('subscription__task_retried_count', { count }))
const handleRetryAll = async() => run(async() => {
  const count = await retryTasks(visibleTasks.value.map(task => task.id))
  selectedRetryIds.value = []
  return count
}, count => t('subscription__task_retried_failed_count', { count }))
const toggleTaskSelected = (task: LX.Subscription.Task) => {
  const index = selectedRetryIds.value.indexOf(task.id)
  if (index >= 0) selectedRetryIds.value.splice(index, 1)
  else selectedRetryIds.value.push(task.id)
}
const handleUploadLocal = async(task: LX.Subscription.Task) => {
  if (!await dialog.confirm(t('subscription__task_upload_confirm', { name: task.name }))) return
  await run(async() => uploadLocalCompletedTask(task), () => t('subscription__task_upload_started'))
}
const handleIgnoreMetadata = async(task: LX.Subscription.Task) => {
  if (!await dialog.confirm(t('subscription__task_ignore_meta_confirm', { name: task.name }))) return
  await run(async() => ignoreTaskMetadataAndUpload(task), () => t('subscription__task_ignore_meta_done'))
}
const handleHistoryRequeue = async(item: LX.Subscription.HistoryItem) => {
  if (!await dialog.confirm(t('subscription__history_requeue_confirm', { name: item.name }))) return
  await run(async() => requeueSubscriptionHistoryMusic(item.musicKey), () => t('subscription__history_requeued'))
}
const handleHistoryClear = async(item: LX.Subscription.HistoryItem) => {
  if (!await dialog.confirm(t('subscription__history_clear_confirm', { name: item.name }))) return
  await run(async() => clearSubscriptionHistory(item.musicKey), () => t('subscription__history_cleared'))
}
const handlePause = async(task: LX.Subscription.Task) => run(async() => pauseTask(task), () => t('subscription__task_paused'))
const handleResume = async(task: LX.Subscription.Task) => run(async() => resumeTask(task), () => t('subscription__task_resumed'))
const handleRecheckUpload = async(task: LX.Subscription.Task) => run(
  async() => recheckSubscriptionUpload(task),
  result => result.status == 'upload_unconfirmed'
    ? t('subscription__task_recheck_pending', { reason: result.failureReason ?? t('subscription__task_recheck_waiting') })
    : t('subscription__task_recheck_done', { status: statusText(result.status) }),
)
const showMenu = (event: MouseEvent, task: LX.Subscription.Task) => {
  menuTask.value = task
  menuLocation.x = event.pageX
  menuLocation.y = event.pageY
  if (isShowItemMenu.value) return
  void nextTick(() => {
    isShowItemMenu.value = true
  })
}
const handleMenuClick = (action: { action?: string }) => {
  isShowItemMenu.value = false
  const task = menuTask.value
  if (!action.action || !task) return
  switch (action.action) {
    case 'retry':
      void handleRetry(task)
      break
    case 'ignoreMeta':
      void handleIgnoreMetadata(task)
      break
    case 'recheck':
      void handleRecheckUpload(task)
      break
    case 'reupload':
      void handleRetry(task)
      break
    case 'upload':
      void handleUploadLocal(task)
      break
    case 'pause':
      void handlePause(task)
      break
    case 'resume':
      void handleResume(task)
      break
  }
}
const handleListBtnClick = ({ action, index }: { action: string, index: number }) => {
  const task = visibleTasks.value[index]
  if (!task) return
  switch (action) {
    case 'start':
      if (task.status == 'failed') void handleRetry(task)
      else if (task.status == 'disk_paused') void handleResume(task)
      break
    case 'pause':
      void handlePause(task)
      break
    case 'search':
      void handleRecheckUpload(task)
      break
  }
}
const handleUnlockDisk = async() => run(unlockDiskQueue, () => t('subscription__disk_unlocked'))

const isSyncing = (id: string) => state.syncingIds.includes(id)
const listTypeText = (type: LX.Subscription.ListType) =>
  type == 'board' ? t('subscription__type_board') : t('subscription__type_playlist')
const intervalText = (minutes?: number | null) =>
  minutes ? t('subscription__interval_minutes', { num: minutes }) : t('subscription__interval_manual')
const formatTime = (time?: number | null) => time ? new Date(time).toLocaleString() : t('subscription__none')
const cleanupRemaining = (cleanupAt: number) => {
  const seconds = Math.max(0, Math.ceil((cleanupAt - currentTime.value) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
const canPause = (task: LX.Subscription.Task) => ['pending', 'downloading'].includes(task.status)
// 按任务数据本身判断，而不是去匹配失败原因里的字样：
// 失败原因由主进程生成并落库，拿字符串做条件会在文案变动或翻译后悄悄失效。
// 这里的条件与 resumeSubscriptionPostProcess 里抛出该错误的条件保持一致。
const metadataCapableExtensions = ['mp3', 'flac']
const canIgnoreMetadata = (task: LX.Subscription.Task) => {
  if (task.status != 'failed' || !task.localPath) return false
  const extension = task.localPath.split('.').pop()?.toLowerCase()
  return !!extension && !metadataCapableExtensions.includes(extension)
}
const statusText = (status: LX.Subscription.TaskStatus) => t(`subscription__status_${status}` as 'subscription__status_pending')
const taskStatusText = (task: LX.Subscription.Task) => task.status == 'disk_paused'
  ? task.pauseOrigin == 'manual' ? t('subscription__status_disk_paused_manual') : t('subscription__status_disk_paused_disk')
  : statusText(task.status)
const taskTitle = (task: LX.Subscription.Task) => formatMusicName(appSetting['download.fileName'], task.name, task.singer)
const effectiveQuality = (task: LX.Subscription.Task) =>
  task.fileVerifiedQuality ?? task.sourceReportedQuality ?? task.requestedQuality ?? task.cloudQuality
const shortQualityText = (quality?: LX.Subscription.Quality | null) =>
  quality == null ? t('subscription__none') : quality == 'flac24bit' ? 'FLAC Hires' : quality.toUpperCase()
// 状态列在一行内说清楚「现在卡在哪里」：失败和待确认直接带上原因，延迟清理带上倒计时
const statusDetailText = (task: LX.Subscription.Task) => {
  const base = taskStatusText(task)
  if (task.status == 'cleanup_wait' && task.cleanupAt) {
    return `${base} · ${t('subscription__task_remaining', { time: cleanupRemaining(task.cleanupAt) })}`
  }
  if (task.failureReason && ['failed', 'upload_unconfirmed', 'disk_paused', 'calibration_unresolved'].includes(task.status)) {
    return `${base} · ${task.failureReason}`
  }
  return base
}
const historyTitle = (item: LX.Subscription.HistoryItem) =>
  `${formatMusicName(appSetting['download.fileName'], item.name, item.singer)} · ${item.source}${item.albumName ? ` · ${item.albumName}` : ''}`
const historyQuality = (item: LX.Subscription.HistoryItem) =>
  item.fileVerifiedQuality ?? item.sourceReportedQuality ?? item.requestedQuality ?? item.cloudQuality
const historyStatusText = (item: LX.Subscription.HistoryItem) =>
  item.message ? `${statusText(item.status)} · ${item.message}` : statusText(item.status)

let clockTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  clockTimer = setInterval(() => {
    currentTime.value = Date.now()
  }, 1_000)
  void Promise.all([refreshSubscriptionState(), refreshSubscriptionRuntimeStatus()]).catch(err => {
    notice.value = err instanceof Error ? err.message : String(err)
    noticeError.value = true
  })
})
onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.subscription {
  position: relative;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
}
.header {
  flex: none;
  padding: 8px 10px 0;
  border-bottom: var(--color-list-header-border-bottom);
}
.content {
  flex: auto;
  min-height: 0;
  display: flex;
  flex-flow: column nowrap;
  padding: 10px 12px 0;
  font-size: 13px;
  overflow-y: auto;
}
.contentFixed {
  overflow: hidden;
  padding-bottom: 0;
}
.notice {
  flex: none;
  padding: 6px 10px;
  margin: 0 0 10px;
  border-radius: 4px;
  color: var(--color-primary);
  background: var(--color-primary-alpha-100);
  &.error {
    color: #d65b5b;
    background: rgba(214, 91, 91, .1);
  }
}
.lockBar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 10px;
  padding: 8px 12px;
  border-radius: 4px;
  color: #d98d35;
  background: rgba(217, 141, 53, .1);
}
.toolbar {
  flex: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  padding: 0 2px 8px;
  color: var(--color-font-label);
  font-size: 12px;
}
.toolbarActions {
  display: flex;
  gap: 8px;
}
.thead {
  flex: none;
  th {
    color: var(--color-font-label);
  }
  th:first-child {
    text-align: center;
  }
  input {
    cursor: pointer;
    vertical-align: middle;
  }
}
.listContent {
  flex: auto;
  min-height: 0;
}
.noItem {
  flex: auto;
  display: flex;
  align-items: center;
  justify-content: center;

  p {
    font-size: 20px;
    color: var(--color-font-label);
  }
}
.rowActions {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow: hidden;
  button {
    appearance: none;
    border: 0;
    padding: 2px 4px;
    color: var(--color-primary);
    background: transparent;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
    &:hover {
      text-decoration: underline;
    }
    &:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 1px;
    }
    &:disabled {
      opacity: .4;
      cursor: default;
    }
  }
  input {
    cursor: pointer;
  }
  .danger {
    color: #d65b5b;
  }
}
.filterBar {
  flex: none;
  display: grid;
  grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0 0 10px;
  --selection-width: 100%;
}
.addForm {
  flex: none;
  display: grid;
  grid-template-columns: 145px minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  margin: 0 0 12px;
  > * {
    min-width: 0;
  }
  // Selection 组件默认固定 300px 宽，不约束会溢出网格轨道压到相邻输入框
  --selection-width: 100%;
}
.addTip {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--color-font-label);
  font-size: 12px;
  line-height: 1.5;
}
.select {
  padding: 0;
}
.editForm {
  flex: none;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr) auto auto;
  gap: 10px;
  align-items: end;
  margin: 0 0 12px;
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    span {
      color: var(--color-font-label);
      font-size: 12px;
    }
  }
}
.rowError {
  color: #d98d35;
}
</style>
