<template>
  <div :class="$style.page">
    <header :class="$style.header">
      <div>
        <h2>订阅下载</h2>
        <p>自动发现歌单新增歌曲，统一去重并跟踪下载、上传与清理状态</p>
      </div>
      <base-btn min outline :disabled="busy" @click="refresh">刷新</base-btn>
    </header>

    <base-tab v-model="activeTab" :class="$style.tabs" :list="tabs" />

    <main class="scroll" :class="$style.content">
      <p v-if="notice" :class="[$style.notice, noticeError && $style.error]">{{ notice }}</p>

      <section v-if="activeTab == 'overview'" :class="$style.section">
        <div :class="$style.cards">
          <article v-for="card in dashboardCards" :key="card.label" :class="$style.card">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
          </article>
        </div>
        <div :class="$style.health">
          <div><span>最近同步</span><b>{{ formatTime(state.dashboard?.lastSyncAt) }}</b></div>
          <div><span>自定义音源</span><b :class="userApi.status ? $style.ok : $style.warn">{{ userApi.status ? '已启用' : '未就绪' }}</b></div>
          <div>
            <span>CD2 同步</span>
            <b :class="cd2StatusOk ? $style.ok : $style.warn" :title="state.cd2HealthError">
              {{ cd2StatusText }}
            </b>
          </div>
          <div>
            <span>本地磁盘</span>
            <b :class="state.dashboard?.diskLocked ? $style.warn : $style.ok">
              {{ diskStatusText }}
            </b>
          </div>
          <div><span>下载目录</span><b :title="state.diskInfo?.path">{{ state.diskInfo?.path || '检测失败' }}</b></div>
          <div><span>磁盘保护阈值</span><b>{{ formatBytes(state.config?.diskThresholdBytes) }}</b></div>
        </div>
        <div v-if="state.dashboard?.diskLocked" :class="$style.callout">
          <div>队列已于 {{ formatTime(state.config?.diskPausedAt) }} 锁定，空间恢复后也不会自动继续。</div>
          <base-btn min outline :disabled="busy" @click="handleUnlockDisk">我已清理磁盘，手动恢复</base-btn>
        </div>
        <div :class="$style.callout">
          自动同步按订阅依次执行；失败任务不会因重启、音源切换或再次同步而自动重试。
        </div>
        <div v-if="state.config?.syncToCd2 && !state.config?.calibrationCompletedAt" :class="$style.callout">
          CD2 同步模式首次使用前需要在“校准”页完成一次只读扫描；完成前只同步歌单并建立待处理任务，不会开始自动下载。
        </div>
      </section>

      <section v-else-if="activeTab == 'subscriptions'" :class="$style.section">
        <div :class="$style.formCard">
          <h3>添加歌单订阅</h3>
          <div :class="$style.formRow">
            <base-selection v-model="newItem.source" :class="$style.select" :list="sourceOptions" item-key="id" item-name="name" />
            <base-input v-model="newItem.listId" placeholder="歌单 ID 或原版支持的歌单链接" />
            <base-input v-model="newItem.name" placeholder="订阅名称" />
            <base-input v-model="newItem.interval" type="number" placeholder="周期（分钟，可留空）" />
            <base-btn min outline :disabled="busy" @click="listPickerVisible = true">浏览选择</base-btn>
            <base-btn min :disabled="busy || !canCreate" @click="handleCreate">添加</base-btn>
          </div>
          <p>未设置有效周期时不会自动同步，仍可使用“立即同步”。</p>
        </div>

        <div v-if="state.subscriptions.length" :class="$style.tableWrap">
          <table :class="$style.table">
            <thead><tr><th>名称</th><th>类型</th><th>平台 / 歌单 ID</th><th>周期</th><th>最近同步</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="item in state.subscriptions" :key="item.id">
                <td><b>{{ item.name }}</b><small v-if="item.lastError" :class="$style.rowError">{{ item.lastError }}</small></td>
                <td><span :class="$style.taskStatus">{{ listTypeText(item.listType) }}</span></td>
                <td>{{ item.source }} / {{ displayListId(item) }}</td>
                <td>{{ item.intervalMinutes ? item.intervalMinutes + ' 分钟' : '仅手动' }}</td>
                <td>{{ formatTime(item.lastSyncAt) }}</td>
                <td><span :class="item.enabled ? $style.statusOn : $style.statusOff">{{ item.enabled ? '运行中' : '已暂停' }}</span></td>
                <td :class="$style.actions">
                  <button :disabled="isSyncing(item.id)" @click="handleSync(item)">{{ isSyncing(item.id) ? '同步中' : '立即同步' }}</button>
                  <button @click="handleToggle(item)">{{ item.enabled ? '暂停' : '恢复' }}</button>
                  <button :class="$style.danger" @click="handleRemove(item)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else :class="$style.empty">尚未添加订阅</div>
      </section>

      <section v-else-if="activeTab == 'tasks' || activeTab == 'failed'" :class="$style.section">
        <div :class="$style.taskToolbar">
          <span>{{ activeTab == 'failed' ? '失败任务只允许手动重试' : '当前持久化任务队列' }}</span>
          <base-btn v-if="activeTab == 'failed'" min :disabled="!visibleTasks.length || busy" @click="handleRetryAll">重试全部失败任务</base-btn>
        </div>
        <div v-if="visibleTasks.length" :class="$style.tableWrap">
          <table :class="$style.table">
            <thead><tr><th>歌曲</th><th>音质链路</th><th>状态</th><th>进度</th><th>路径 / 原因</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="task in visibleTasks" :key="task.id">
                <td><b>{{ task.name }}</b><small>{{ task.singer }} · {{ task.source }}:{{ task.songId }}</small></td>
                <td><small>请求 {{ qualityText(task.requestedQuality) }}</small><small>报告 {{ qualityText(task.sourceReportedQuality) }}</small><small>复核 {{ qualityText(task.fileVerifiedQuality) }} / 云端 {{ qualityText(task.cloudQuality) }}</small></td>
                <td><span :class="$style.taskStatus">{{ statusText(task.status) }}</span><small v-if="task.cleanupAt">剩余 {{ cleanupRemaining(task.cleanupAt) }}（{{ formatTime(task.cleanupAt) }}）</small></td>
                <td>{{ task.progress.toFixed(1) }}%<small v-if="task.speed">{{ task.speed }}/s</small></td>
                <td><small>{{ task.failureReason || task.cloudPath || task.existingCloudPath || task.localPath || '—' }}</small></td>
                <td :class="$style.actions">
                  <button v-if="task.status == 'failed'" @click="handleRetry(task)">手动重试</button>
                  <button v-else-if="canPause(task)" @click="handlePause(task)">暂停</button>
                  <button v-else-if="task.status == 'disk_paused'" @click="handleResume(task)">继续</button>
                  <span v-else>—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else :class="$style.empty">暂无任务</div>
      </section>

      <section v-else-if="activeTab == 'history'" :class="$style.section">
        <div v-if="state.history.length" :class="$style.tableWrap">
          <table :class="$style.table">
            <thead><tr><th>时间</th><th>歌曲</th><th>状态</th><th>说明</th><th>歌曲键</th></tr></thead>
            <tbody>
              <tr v-for="item in state.history" :key="item.id">
                <td>{{ formatTime(item.createdAt) }}</td>
                <td><b>{{ item.name }}</b><small>{{ item.singer }}</small></td>
                <td><span :class="$style.taskStatus">{{ statusText(item.status) }}</span></td>
                <td>{{ item.message || '—' }}</td>
                <td><small>{{ item.musicKey }}</small></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else :class="$style.empty">暂无历史记录</div>
      </section>

      <section v-else-if="activeTab == 'calibration'" :class="$style.section">
        <div :class="$style.formCard">
          <h3>一次性云端校准</h3>
          <p>校准只读扫描 CD2 音乐目录，可能触发云端文件读取或缓存下载，但不会删除、移动、重命名、覆盖或重新上传文件。</p>
          <div :class="$style.calibrationGrid">
            <label><span>扫描根目录</span><base-input v-model="calibration.rootPath" placeholder="默认使用 CD2 音乐库根目录" /></label>
            <label><span>包含目录</span><base-input v-model="calibration.includePaths" placeholder="相对根目录，多个用逗号分隔；留空为全部" /></label>
            <label><span>排除目录</span><base-input v-model="calibration.excludePaths" placeholder="相对根目录，多个用逗号分隔" /></label>
            <label>
              <span>扫描子目录</span>
              <base-checkbox id="subscription_calibration_recursive" :model-value="calibration.recursive" label="递归扫描" @update:model-value="calibration.recursive = $event" />
            </label>
          </div>
          <div :class="$style.settingsActions">
            <base-btn :disabled="busy" @click="handleCalibration">开始只读校准</base-btn>
          </div>
          <p v-if="state.config?.calibrationCompletedAt">最近完成：{{ formatTime(state.config?.calibrationCompletedAt) }}</p>
        </div>
        <div v-if="state.calibrationRecords.length" :class="$style.tableWrap">
          <table :class="$style.table">
            <thead><tr><th>云端文件</th><th>标签 / 音质</th><th>校准状态</th><th>候选与人工确认</th></tr></thead>
            <tbody>
              <tr v-for="record in state.calibrationRecords" :key="record.id">
                <td><small>{{ record.filePath }}</small></td>
                <td><b>{{ record.title || '无歌名标签' }}</b><small>{{ record.artist || '无歌手标签' }} · {{ qualityText(record.quality) }} · {{ formatDuration(record.duration) }}</small></td>
                <td><span :class="$style.taskStatus">{{ calibrationStatusText(record.status) }}</span><small v-if="record.error" :class="$style.rowError">{{ record.error }}</small></td>
                <td :class="$style.actions">
                  <template v-if="record.status != 'matched'">
                    <button v-for="key in record.candidateMusicKeys" :key="key" @click="handleCalibrationConfirm(record, key)">确认 {{ key }}</button>
                    <template v-if="record.quality && !record.candidateMusicKeys.length">
                      <base-input v-model="manualCalibrationKeys[record.id]" placeholder="输入平台:歌曲ID" />
                      <button :disabled="!manualCalibrationKeys[record.id]?.trim()" @click="handleCalibrationConfirm(record, manualCalibrationKeys[record.id])">确认关联</button>
                    </template>
                    <span v-if="!record.quality">音质不可确认</span>
                  </template>
                  <span v-else>已确认</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else :class="$style.section">
        <div v-if="settings" :class="$style.settings">
          <label><span>达到此音质后停止升级</span><base-selection v-model="settings.stopQuality" :list="qualityOptions" item-key="id" item-name="name" /></label>
          <label><span>CD2 音乐库根目录</span><base-input v-model="settings.cd2RootPath" placeholder="例如 /mnt/cloud/music" /></label>
          <label><span>CD2 gRPC 地址</span><base-input v-model="settings.cd2GrpcUrl" placeholder="例如 http://127.0.0.1:19798" /></label>
          <label><span>CD2 API Token</span><base-input v-model="settings.cd2ApiToken" type="password" placeholder="Token 仅保存在本机数据库" /></label>
          <label>
            <span>下载完成后同步到 CD2</span>
            <base-checkbox
              id="subscription_sync_to_cd2"
              :model-value="settings.syncToCd2"
              label="启用 CD2 上传、确认与延迟清理"
              @update:model-value="settings.syncToCd2 = $event"
            />
          </label>
          <div v-if="!settings.syncToCd2" :class="$style.callout">
            当前为仅本地下载模式：仍会下载歌曲并按原版设置处理元数据、封面和歌词，但不会复制到 CD2 挂载目录，也不会执行 gRPC 上传确认和 20 分钟延迟清理。
          </div>
          <label><span>本地磁盘阈值（GB）</span><base-input v-model="settings.diskThresholdGb" type="number" /></label>
          <div :class="$style.settingsActions">
            <base-btn :disabled="busy" @click="handleSaveSettings">保存设置</base-btn>
            <base-btn v-if="settings.syncToCd2" outline :disabled="busy" @click="handleTestCd2">测试已保存的 CD2 配置</base-btn>
            <base-btn v-if="state.config?.diskLocked" outline :disabled="busy" @click="handleUnlockDisk">我已清理磁盘，手动恢复</base-btn>
          </div>
          <p>下载目录、文件名格式、并发数、封面、歌词和 LRC 继续使用 LX Music 原版设置。</p>
        </div>
      </section>
    </main>
    <list-picker v-model="listPickerVisible" :source-list="sourceOptions" @select="handleListPickerSelect" />
  </div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from '@common/utils/vueTools'
import { dialog } from '@renderer/plugins/Dialog'
import { userApi } from '@renderer/store'
import {
  createSubscription,
  pauseTask,
  refreshSubscriptionRuntimeStatus,
  refreshSubscriptionState,
  removeSubscription,
  resolveSubscriptionCalibration,
  resumeTask,
  retryTasks,
  runSubscriptionCalibration,
  saveSubscriptionConfig,
  subscriptionState as state,
  syncSubscription,
  testSubscriptionCd2,
  unlockDiskQueue,
  updateSubscription,
} from '@renderer/store/subscription'
import ListPicker from './components/ListPicker.vue'

const activeTab = ref('overview')
const busy = ref(false)
const listPickerVisible = ref(false)
const notice = ref('')
const noticeError = ref(false)
const currentTime = ref(Date.now())
const newItem = reactive({ source: 'wy' as LX.OnlineSource, listType: 'playlist' as LX.Subscription.ListType, listId: '', name: '', interval: '' })
const calibration = reactive({ rootPath: '', includePaths: '', excludePaths: '', recursive: true })
const manualCalibrationKeys = reactive<Record<number, string>>({})
const settings = ref<{
  stopQuality: LX.Subscription.StopQuality
  cd2RootPath: string
  cd2GrpcUrl: string
  cd2ApiToken: string
  syncToCd2: boolean
  diskThresholdGb: string
}>({
  stopQuality: 'flac',
  cd2RootPath: '',
  cd2GrpcUrl: '',
  cd2ApiToken: '',
  syncToCd2: true,
  diskThresholdGb: '30',
})
let calibrationInited = false

const tabs = [
  { id: 'overview', label: '概览' },
  { id: 'subscriptions', label: '订阅管理' },
  { id: 'tasks', label: '任务' },
  { id: 'failed', label: '重试列表' },
  { id: 'history', label: '历史' },
  { id: 'calibration', label: '校准' },
  { id: 'settings', label: '设置' },
]
const sourceOptions: Array<{ id: LX.OnlineSource, name: string }> = [
  { id: 'kw', name: '酷我' }, { id: 'kg', name: '酷狗' }, { id: 'tx', name: 'QQ' },
  { id: 'wy', name: '网易' }, { id: 'mg', name: '咪咕' },
]
const qualityOptions = [
  { id: '128k', name: '128k' }, { id: '320k', name: '320k' },
  { id: 'flac', name: 'FLAC' }, { id: 'flac24bit', name: '24-bit FLAC' },
  { id: 'none', name: '不提前停止' },
]

const dashboardCards = computed(() => [
  { label: '订阅', value: state.dashboard?.subscriptionCount ?? 0 },
  { label: '待处理', value: state.dashboard?.pendingCount ?? 0 },
  { label: '下载中', value: state.dashboard?.downloadingCount ?? 0 },
  { label: '上传中', value: state.dashboard?.uploadingCount ?? 0 },
  { label: '失败', value: state.dashboard?.failedCount ?? 0 },
  { label: '音乐库', value: state.dashboard?.libraryCount ?? 0 },
])
const visibleTasks = computed(() => activeTab.value == 'failed' ? state.tasks.filter(task => task.status == 'failed') : state.tasks)
const canCreate = computed(() => newItem.listId.trim() && newItem.name.trim() && (!newItem.interval || Number(newItem.interval) > 0))
const cd2StatusOk = computed(() => !state.config?.syncToCd2 || state.cd2Health?.writable == true)
const cd2StatusText = computed(() => {
  if (!state.config?.syncToCd2) return '已关闭（仅本地下载）'
  if (state.cd2Health?.writable) return `已挂载且可写：${state.cd2Health.rootPath}`
  return state.cd2HealthError || '尚未检测'
})
const diskStatusText = computed(() => {
  const free = state.diskInfo ? `${formatBytes(state.diskInfo.freeBytes)} 可用` : '检测失败'
  return state.dashboard?.diskLocked ? `已锁定 · ${free}` : free
})

watch(() => state.config, config => {
  if (!config) return
  if (!calibrationInited) {
    calibration.rootPath = config.calibrationRootPath || config.cd2RootPath
    calibration.recursive = config.calibrationRecursive
    calibration.includePaths = config.calibrationIncludePaths.join(', ')
    calibration.excludePaths = config.calibrationExcludePaths.join(', ')
    calibrationInited = true
  }
  settings.value = {
    stopQuality: config.stopQuality,
    cd2RootPath: config.cd2RootPath,
    cd2GrpcUrl: config.cd2GrpcUrl,
    cd2ApiToken: config.cd2ApiToken,
    syncToCd2: config.syncToCd2,
    diskThresholdGb: String(Math.round(config.diskThresholdBytes / 1024 / 1024 / 1024)),
  }
}, { immediate: true })

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
const refresh = async() => run(async() => {
  await refreshSubscriptionState()
  await refreshSubscriptionRuntimeStatus()
}, '数据与运行状态已刷新')
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
}, '订阅已添加')
const handleListPickerSelect = (selection: { source: LX.OnlineSource, listType: LX.Subscription.ListType, listId: string, name: string }) => {
  newItem.source = selection.source
  newItem.listType = selection.listType
  newItem.listId = selection.listId
  newItem.name = selection.name
}
const handleSync = async(item: LX.Subscription.ListItem) => run(
  async() => syncSubscription(item),
  result => result
    ? `同步完成：发现 ${result.discovered}，入队 ${result.queued}，跳过 ${result.skipped}`
    : '该订阅正在同步',
)
const handleToggle = async(item: LX.Subscription.ListItem) => run(
  async() => updateSubscription({ id: item.id, enabled: !item.enabled }),
  item.enabled ? '订阅已暂停' : '订阅已恢复',
)
const handleRemove = async(item: LX.Subscription.ListItem) => {
  if (!await dialog.confirm(`删除订阅“${item.name}”？已下载歌曲、全局音乐库和历史任务不会被删除。`)) return
  await run(async() => removeSubscription(item.id), '订阅已删除')
}
const handleRetry = async(task: LX.Subscription.Task) => run(async() => retryTasks([task.id]), '任务已重新加入队列')
const handleRetryAll = async() => run(async() => retryTasks(visibleTasks.value.map(task => task.id)), '失败任务已重新加入队列')
const handlePause = async(task: LX.Subscription.Task) => run(async() => pauseTask(task), '任务已暂停')
const handleResume = async(task: LX.Subscription.Task) => run(async() => resumeTask(task), '任务已恢复')
const handleSaveSettings = async() => run(async() => {
  const threshold = Number(settings.value.diskThresholdGb)
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('磁盘阈值必须大于 0 GB')
  await saveSubscriptionConfig({
    stopQuality: settings.value.stopQuality,
    cd2RootPath: settings.value.cd2RootPath,
    cd2GrpcUrl: settings.value.cd2GrpcUrl,
    cd2ApiToken: settings.value.cd2ApiToken,
    syncToCd2: settings.value.syncToCd2,
    diskThresholdBytes: Math.round(threshold * 1024 * 1024 * 1024),
  })
}, '设置已保存')
const handleTestCd2 = async() => run(async() => {
  await testSubscriptionCd2()
}, 'CD2 连接与挂载检查通过')
const parsePathList = (value: string) => value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean)
const handleCalibration = async() => run(async() => runSubscriptionCalibration({
  rootPath: calibration.rootPath,
  recursive: calibration.recursive,
  includePaths: parsePathList(calibration.includePaths),
  excludePaths: parsePathList(calibration.excludePaths),
}), result => `校准完成：扫描 ${result.scanned}，自动匹配 ${result.matched}，待人工确认 ${result.unresolved}，读取失败 ${result.failed}`)
const handleCalibrationConfirm = async(record: LX.Subscription.CalibrationRecord, musicKey: string) => run(
  async() => resolveSubscriptionCalibration({ recordId: record.id, musicKey: musicKey.trim() }),
  '校准关联已人工确认',
)
const handleUnlockDisk = async() => run(unlockDiskQueue, '磁盘队列锁定已手动解除，暂停任务已恢复排队')

const isSyncing = (id: string) => state.syncingIds.includes(id)
const listTypeText = (type: LX.Subscription.ListType) => type == 'board' ? '榜单' : '歌单'
const displayListId = (item: LX.Subscription.ListItem) => item.listType == 'board' ? (item.listId.split('__').pop() ?? item.listId) : item.listId
const formatTime = (time?: number | null) => time ? new Date(time).toLocaleString() : '—'
const formatBytes = (bytes?: number | null) => {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  const gb = bytes / 1024 / 1024 / 1024
  return `${gb >= 10 ? gb.toFixed(1) : gb.toFixed(2)} GB`
}
const cleanupRemaining = (cleanupAt: number) => {
  const seconds = Math.max(0, Math.ceil((cleanupAt - currentTime.value) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
const qualityText = (quality?: LX.Subscription.Quality | null) => quality == null ? '—' : quality == 'flac24bit' ? '24-bit FLAC' : quality.toUpperCase()
const formatDuration = (duration?: number | null) => duration == null ? '时长未知' : `${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, '0')}`
const calibrationStatusText = (status: LX.Subscription.CalibrationRecord['status']) => ({ matched: '已匹配', unresolved: '待人工确认', failed: '读取失败' }[status])
const canPause = (task: LX.Subscription.Task) => ['pending', 'downloading'].includes(task.status)
const statusText = (status: LX.Subscription.TaskStatus) => ({
  discovered: '已发现',
  calibrating: '校准中',
  calibration_unresolved: '待人工校准',
  pending: '等待下载',
  disk_paused: '已暂停',
  resolving: '解析音源',
  downloading: '下载中',
  downloaded: '下载完成',
  quality_check: '音质复核',
  tagging: '写入元数据',
  uploading: '上传中',
  old_version_cleanup: '清理旧版本',
  cleanup_wait: '延迟清理',
  uploaded: '已上传',
  failed: '失败',
  local_completed: '仅本地完成',
  quality_skipped: '音质条件跳过',
}[status])

let clockTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  clockTimer = setInterval(() => { currentTime.value = Date.now() }, 1_000)
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

.page { height: 100%; display: flex; flex-flow: column nowrap; overflow: hidden; }
.header { flex: none; min-height: 64px; padding: 10px 18px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; border-bottom: var(--color-list-header-border-bottom); h2 { font-size: 19px; margin: 0 0 4px; } p { margin: 0; color: var(--color-font-label); font-size: 12px; } }
.tabs { flex: none; border-bottom: var(--color-list-header-border-bottom); }
.content { flex: auto; min-height: 0; overflow-y: auto; padding: 16px 18px 30px; box-sizing: border-box; }
.section { max-width: 1180px; margin: 0 auto; }
.notice { padding: 8px 12px; margin: 0 auto 12px; max-width: 1156px; border-radius: 4px; color: var(--color-primary); background: var(--color-primary-alpha-100); &.error { color: #d65b5b; background: rgba(214, 91, 91, .1); } }
.cards { display: grid; grid-template-columns: repeat(6, minmax(90px, 1fr)); gap: 10px; }
.card { padding: 14px; border-radius: 6px; background: var(--color-primary-background); display: flex; flex-direction: column; gap: 6px; span { color: var(--color-font-label); font-size: 12px; } strong { font-size: 24px; color: var(--color-primary); } }
.health { margin-top: 14px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; overflow: hidden; border-radius: 6px; background: var(--color-primary-alpha-100); > div { padding: 12px 14px; background: var(--color-main-background); display: flex; justify-content: space-between; gap: 20px; span { color: var(--color-font-label); } b { font-size: 12px; max-width: 70%; overflow: hidden; text-overflow: ellipsis; } } }
.ok { color: var(--color-primary); }.warn, .rowError { color: #d98d35; }
.callout { margin-top: 14px; padding: 12px 14px; line-height: 1.6; border-left: 4px solid var(--color-primary-alpha-500); background: var(--color-primary-alpha-100); display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.formCard { padding: 14px; border-radius: 6px; background: var(--color-primary-background); h3 { margin: 0 0 12px; } > p { margin: 9px 0 0; color: var(--color-font-label); font-size: 12px; line-height: 1.6; } }
.formRow { display: grid; grid-template-columns: 145px minmax(180px, 2fr) minmax(140px, 1fr) minmax(130px, .8fr) auto auto; gap: 8px; align-items: center; > * { min-width: 0; } }
.select { padding: 0; gap: 10px; }
.tableWrap { margin-top: 14px; overflow-x: auto; border-radius: 6px; border: 1px solid var(--color-primary-alpha-100); }
.table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; th { padding: 10px; color: var(--color-font-label); white-space: nowrap; background: var(--color-primary-background); } td { padding: 10px; border-top: 1px solid var(--color-primary-alpha-100); vertical-align: middle; max-width: 250px; overflow-wrap: anywhere; } small { display: block; margin-top: 4px; color: var(--color-font-label); line-height: 1.4; } }
.actions { white-space: nowrap; button { appearance: none; border: 0; padding: 3px 5px; color: var(--color-primary); background: transparent; cursor: pointer; font-size: 12px; &:hover { text-decoration: underline; } &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; } &:disabled { opacity: .4; cursor: default; } } .danger { color: #d65b5b; } }
.statusOn, .statusOff, .taskStatus { display: inline-block; padding: 2px 7px; border-radius: 10px; background: var(--color-primary-alpha-100); color: var(--color-primary); white-space: nowrap; }.statusOff { color: var(--color-font-label); }
.taskToolbar { display: flex; justify-content: space-between; align-items: center; min-height: 30px; color: var(--color-font-label); }
.empty { height: 220px; display: flex; align-items: center; justify-content: center; color: var(--color-font-label); font-size: 18px; }
.settings { max-width: 760px; display: flex; flex-direction: column; gap: 14px; label { display: grid; grid-template-columns: 190px 1fr; align-items: center; gap: 12px; > span { color: var(--color-font-label); } > :global(ul) { padding: 0; gap: 16px; } } > p { color: var(--color-font-label); font-size: 12px; } }
.settingsActions { display: flex; gap: 10px; padding-left: 202px; }
.calibrationGrid { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; label { display: grid; grid-template-columns: 120px 1fr; align-items: center; gap: 12px; > span { color: var(--color-font-label); } } }
@media (max-width: 900px) { .cards { grid-template-columns: repeat(3, 1fr); } .formRow { grid-template-columns: 1fr 1fr; } }
</style>
