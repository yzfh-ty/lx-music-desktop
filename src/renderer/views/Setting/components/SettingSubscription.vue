<template lang="pug">
dt#subscription {{ $t('setting__subscription') }}
dd
  .gap-top
    base-checkbox(id="setting_subscription_enable" :model-value="appSetting['subscription.enable']" :label="$t('setting__subscription_enable')" @update:model-value="updateSetting({'subscription.enable': $event})")
  .gap-top.p.small.tip
    | {{ $t('setting__subscription_enable_tip') }}

dd.gap-top(:aria-label="$t('setting__subscription_config')")
  h3#subscription_config {{ $t('setting__subscription_config') }}
  div
    .p
      | {{ $t('subscription__setting_stop_quality') }}
      base-selection.gap-left(v-model="form.stopQuality" :class="$style.select" :list="qualityOptions" item-key="id" item-name="name")
    .p
      | {{ $t('subscription__setting_cd2_root') }}
      div
        base-input(v-model="form.cd2RootPath" :class="$style.wide" :placeholder="$t('subscription__setting_cd2_root_placeholder')")
    .p
      | {{ $t('subscription__setting_cd2_url') }}
      div
        base-input(v-model="form.cd2GrpcUrl" :class="$style.wide" :placeholder="$t('subscription__setting_cd2_url_placeholder')")
    .p
      | {{ $t('subscription__setting_cd2_token') }}
      div
        base-input(v-model="form.cd2ApiToken" :class="$style.wide" type="password" :placeholder="$t('subscription__setting_cd2_token_placeholder')")
    .p.gap-top
      base-checkbox(id="setting_subscription_sync_to_cd2" :model-value="form.syncToCd2" :label="$t('subscription__setting_sync')" @update:model-value="form.syncToCd2 = $event")
    .p.small.tip(v-if="!form.syncToCd2") {{ $t('subscription__setting_sync_off_tip') }}
    .p
      | {{ $t('subscription__setting_threshold') }}
      base-input.gap-left(v-model="form.diskThresholdGb" :class="$style.numInput" type="number")
    .p
      base-btn.btn(min :disabled="busy" @click="handleSave") {{ $t('subscription__setting_save') }}
      base-btn.btn(v-if="form.syncToCd2" min outline :disabled="busy" @click="handleTestCd2") {{ $t('subscription__setting_test_cd2') }}
      base-btn.btn(v-if="form.syncToCd2" min outline :disabled="busy" @click="handleBackup") {{ $t('subscription__setting_backup') }}
      base-btn.btn(v-if="state.config?.diskLocked" min outline :disabled="busy" @click="handleUnlockDisk") {{ $t('subscription__disk_unlock') }}
    .p.small(v-if="message") {{ message }}
    .p.small.tip {{ $t('subscription__setting_footer', { time: formatTime(state.config?.backupLastAt), path: state.config?.backupLastPath || '' }) }}

dd.gap-top(:aria-label="$t('subscription__calibration_title')")
  h3#subscription_calibration {{ $t('subscription__calibration_title') }}
  div
    .p.small.tip {{ $t('subscription__calibration_desc') }}
    .p
      | {{ $t('subscription__calibration_root') }}
      div
        base-input(v-model="calibration.rootPath" :class="$style.wide" :placeholder="$t('subscription__calibration_root_placeholder')")
    .p
      | {{ $t('subscription__calibration_include') }}
      div
        base-input(v-model="calibration.includePaths" :class="$style.wide" :placeholder="$t('subscription__calibration_include_placeholder')")
    .p
      | {{ $t('subscription__calibration_exclude') }}
      div
        base-input(v-model="calibration.excludePaths" :class="$style.wide" :placeholder="$t('subscription__calibration_exclude_placeholder')")
    .p
      base-checkbox(id="setting_subscription_calibration_recursive" :model-value="calibration.recursive" :label="$t('subscription__calibration_recursive_label')" @update:model-value="calibration.recursive = $event")
    .p
      base-btn.btn(min :disabled="busy" @click="handleCalibration") {{ $t('subscription__calibration_start') }}
      base-btn.btn(v-if="state.calibrationRun?.status == 'failed'" min outline :disabled="busy" @click="handleCalibrationResume") {{ $t('subscription__calibration_resume') }}
    template(v-if="state.calibrationRun")
      .p.small
        | {{ calibrationRunStatusText(state.calibrationRun?.status) }} · {{ state.calibrationRun?.completed }} / {{ state.calibrationRun?.total }}
      .p(:class="$style.progressLine")
        progress(:max="Math.max(1, state.calibrationRun?.total ?? 0)" :value="state.calibrationRun?.completed ?? 0")
      .p.small.tip(v-if="state.calibrationRun?.currentFile") {{ $t('subscription__calibration_run_current', { file: state.calibrationRun!.currentFile }) }}
      .p.small(v-if="state.calibrationRun?.error" :class="$style.rowError") {{ state.calibrationRun!.error }}
      .p.small(v-if="state.calibrationRun?.status == 'completed'")
        | {{ $t('subscription__calibration_run_summary', { matched: state.calibrationRun!.matched, unresolved: state.calibrationRun!.unresolved, failed: state.calibrationRun!.failed }) }}
    .p.small.tip(v-if="state.config?.calibrationCompletedAt")
      | {{ $t('subscription__calibration_last_run', { time: formatTime(state.config.calibrationCompletedAt) }) }}
    .p.small(v-if="calibrationMessage") {{ calibrationMessage }}
    template(v-if="state.calibrationRecords.length")
      .p.small {{ $t('subscription__calibration_records_title') }}
      div(:class="$style.records")
        div(v-for="record in state.calibrationRecords" :key="record.id" :class="$style.record")
          span(:class="$style.recordFile" :title="record.filePath") {{ record.filePath }}
          span(:class="$style.recordTags" :title="record.error")
            | {{ record.title || $t('subscription__calibration_no_title') }} · {{ record.artist || $t('subscription__calibration_no_artist') }}
          span(:class="$style.recordStatus") {{ calibrationStatusText(record.status) }}
          span(:class="$style.recordActions")
            template(v-if="record.status != 'matched'")
              button(v-for="key in record.candidateMusicKeys" :key="key" @click="handleCalibrationConfirm(record, key)")
                | {{ $t('subscription__calibration_confirm_candidate', { key }) }}
              template(v-if="record.quality && !record.candidateMusicKeys.length")
                input(v-model="manualCalibrationKeys[record.id]" :class="$style.manualInput" :placeholder="$t('subscription__calibration_manual_placeholder')")
                button(:disabled="!manualCalibrationKeys[record.id]?.trim()" @click="handleCalibrationConfirm(record, manualCalibrationKeys[record.id])")
                  | {{ $t('subscription__calibration_manual_confirm') }}
              span(v-if="!record.quality") {{ $t('subscription__calibration_quality_unknown') }}
            span(v-else) {{ $t('subscription__calibration_confirmed') }}

dd.gap-top(:aria-label="$t('setting__subscription_structure')")
  h3#subscription_structure {{ $t('setting__subscription_structure') }}
  div
    .p.small.tip {{ $t('subscription__structure_desc') }}
    .p
      | {{ $t('subscription__structure_root') }}
      div
        base-input(v-model="structureForm.rootPath" :class="$style.wide" :placeholder="$t('subscription__calibration_root_placeholder')")
    .p
      | {{ $t('subscription__structure_interval') }}
      base-input.gap-left(v-model="structureForm.interval" :class="$style.numInput" type="number" :placeholder="$t('subscription__structure_interval_placeholder')")
    .p
      base-checkbox(id="setting_subscription_structure_recursive" :model-value="structureForm.recursive" :label="$t('subscription__calibration_recursive_label')" @update:model-value="structureForm.recursive = $event")
    .p
      base-btn.btn(min :disabled="busy" @click="handleSaveStructure") {{ $t('subscription__structure_save') }}
      base-btn.btn(min outline :disabled="busy" @click="handleStructureValidation") {{ $t('subscription__structure_run') }}
    .p.small(v-if="structureMessage") {{ structureMessage }}
    .p.small.tip
      | {{ $t('subscription__structure_summary', { time: formatTime(state.config?.structureLastRunAt), count: state.structureRecords.length }) }}
    template(v-if="state.structureRecords.length")
      div(:class="$style.records")
        div(v-for="record in state.structureRecords" :key="record.id" :class="$style.record")
          span(:class="$style.recordStatus")
            | {{ record.kind == 'missing' ? $t('subscription__structure_kind_missing') : $t('subscription__structure_kind_untracked') }}
          span(:class="$style.recordFile" :title="record.filePath") {{ record.filePath }}
          span(:class="$style.recordTags") {{ formatTime(record.scannedAt) }}
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from '@common/utils/vueTools'
import { useI18n } from '@root/lang'
import { appSetting, updateSetting } from '@renderer/store/setting'
import {
  ensureSubscriptionConfig,
  refreshSubscriptionCalibrationRun,
  resolveSubscriptionCalibration,
  resumeSubscriptionCalibrationRun,
  runSubscriptionBackup,
  runSubscriptionCalibration,
  runSubscriptionStructureValidation,
  saveSubscriptionConfig,
  subscriptionState as state,
  testSubscriptionCd2,
  unlockDiskQueue,
} from '@renderer/store/subscription'
import type { Ref } from 'vue'

const t = useI18n()

const busy = ref(false)
const message = ref('')
const calibrationMessage = ref('')
const structureMessage = ref('')
const form = reactive({
  stopQuality: 'flac' as LX.Subscription.StopQuality,
  cd2RootPath: '',
  cd2GrpcUrl: '',
  cd2ApiToken: '',
  syncToCd2: true,
  diskThresholdGb: '30',
})
const structureForm = reactive({
  rootPath: '',
  recursive: true,
  interval: '',
})
const calibration = reactive({ rootPath: '', includePaths: '', excludePaths: '', recursive: true })
const manualCalibrationKeys = reactive<Record<number, string>>({})
let formInited = false

// 下面这些列表都要是 computed，切换语言时才会跟着变
const qualityOptions = computed(() => [
  { id: '128k', name: '128k' }, { id: '320k', name: '320k' },
  { id: 'flac', name: 'FLAC' }, { id: 'flac24bit', name: '24-bit FLAC' },
  { id: 'none', name: t('subscription__setting_stop_quality_none') },
])

watch(() => state.config, config => {
  if (!config || formInited) return
  form.stopQuality = config.stopQuality
  form.cd2RootPath = config.cd2RootPath
  form.cd2GrpcUrl = config.cd2GrpcUrl
  form.cd2ApiToken = config.cd2ApiToken
  form.syncToCd2 = config.syncToCd2
  form.diskThresholdGb = String(Math.round(config.diskThresholdBytes / 1024 / 1024 / 1024))
  structureForm.rootPath = config.structureRootPath || config.cd2RootPath
  structureForm.recursive = config.structureRecursive
  structureForm.interval = config.structureIntervalMinutes == null ? '' : String(config.structureIntervalMinutes)
  calibration.rootPath = config.calibrationRootPath || config.cd2RootPath
  calibration.recursive = config.calibrationRecursive
  calibration.includePaths = config.calibrationIncludePaths.join(', ')
  calibration.excludePaths = config.calibrationExcludePaths.join(', ')
  formInited = true
}, { immediate: true })

let clockTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void ensureSubscriptionConfig().catch(err => {
    message.value = err instanceof Error ? err.message : String(err)
  })
  clockTimer = setInterval(() => {
    if (['collecting', 'running'].includes(state.calibrationRun?.status ?? '')) void refreshSubscriptionCalibrationRun()
  }, 1_000)
})
onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer)
})

const formatTime = (time?: number | null) => time ? new Date(time).toLocaleString() : t('subscription__none')

const run = async<T>(msg: Ref<string>, action: () => Promise<T>, success: string | ((result: T) => string)) => {
  busy.value = true
  msg.value = ''
  try {
    const result = await action()
    msg.value = typeof success == 'function' ? success(result) : success
  } catch (err) {
    msg.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

const handleSave = () => {
  const threshold = Number(form.diskThresholdGb)
  if (!Number.isFinite(threshold) || threshold <= 0) {
    message.value = t('subscription__setting_threshold_invalid')
    return
  }
  void run(message, async() => {
    await saveSubscriptionConfig({
      stopQuality: form.stopQuality,
      cd2RootPath: form.cd2RootPath,
      cd2GrpcUrl: form.cd2GrpcUrl,
      cd2ApiToken: form.cd2ApiToken,
      syncToCd2: form.syncToCd2,
      diskThresholdBytes: Math.round(threshold * 1024 * 1024 * 1024),
    })
  }, t('subscription__setting_saved'))
}
const handleTestCd2 = async() => run(message, async() => {
  await testSubscriptionCd2()
}, t('subscription__setting_test_cd2_ok'))
const handleBackup = async() => run(message, runSubscriptionBackup, result => t('subscription__setting_backup_done', { path: result.path }))
const handleUnlockDisk = async() => run(message, unlockDiskQueue, t('subscription__disk_unlocked'))

const parsePathList = (value: string) => value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean)
const calibrationRunStatusText = (status?: LX.Subscription.CalibrationRun['status']) => ({
  collecting: t('subscription__calibration_run_collecting'),
  running: t('subscription__calibration_run_running'),
  failed: t('subscription__calibration_run_failed'),
  completed: t('subscription__calibration_run_completed'),
}[status ?? 'collecting'])
const calibrationStatusText = (status: LX.Subscription.CalibrationRecord['status']) => ({
  matched: t('subscription__calibration_status_matched'),
  unresolved: t('subscription__calibration_status_unresolved'),
  failed: t('subscription__calibration_status_failed'),
}[status])
const runCalibrationWithProgress = async(action: () => Promise<LX.Subscription.CalibrationSummary>) => {
  const timer = setInterval(() => { void refreshSubscriptionCalibrationRun() }, 700)
  try {
    await run(calibrationMessage, action, result => t('subscription__calibration_done', {
      scanned: result.scanned,
      matched: result.matched,
      unresolved: result.unresolved,
      failed: result.failed,
    }))
  } finally {
    clearInterval(timer)
    await refreshSubscriptionCalibrationRun()
  }
}
const handleCalibration = async() => runCalibrationWithProgress(async() => runSubscriptionCalibration({
  rootPath: calibration.rootPath,
  recursive: calibration.recursive,
  includePaths: parsePathList(calibration.includePaths),
  excludePaths: parsePathList(calibration.excludePaths),
}))
const handleCalibrationResume = async() => runCalibrationWithProgress(resumeSubscriptionCalibrationRun)
const handleCalibrationConfirm = async(record: LX.Subscription.CalibrationRecord, musicKey: string) => run(
  calibrationMessage,
  async() => resolveSubscriptionCalibration({ recordId: record.id, musicKey: musicKey.trim() }),
  () => t('subscription__calibration_confirmed_tip'),
)

const handleSaveStructure = async() => {
  const interval = structureForm.interval.trim() ? Number(structureForm.interval) : null
  if (interval != null && (!Number.isInteger(interval) || interval <= 0)) {
    structureMessage.value = t('subscription__structure_interval_invalid')
    return
  }
  await run(structureMessage, async() => {
    await saveSubscriptionConfig({
      structureRootPath: structureForm.rootPath,
      structureRecursive: structureForm.recursive,
      structureIntervalMinutes: interval,
    })
  }, t('subscription__structure_saved'))
}

const handleStructureValidation = async() => {
  if (!structureForm.rootPath.trim()) {
    structureMessage.value = t('subscription__structure_need_config')
    return
  }
  const interval = structureForm.interval.trim() ? Number(structureForm.interval) : null
  if (interval != null && (!Number.isInteger(interval) || interval <= 0)) {
    structureMessage.value = t('subscription__structure_interval_invalid')
    return
  }
  await run(structureMessage, async() => {
    await saveSubscriptionConfig({
      structureRootPath: structureForm.rootPath,
      structureRecursive: structureForm.recursive,
      structureIntervalMinutes: interval,
    })
    const summary = await runSubscriptionStructureValidation({
      rootPath: structureForm.rootPath,
      recursive: structureForm.recursive,
    })
    return summary
  }, summary => t('subscription__structure_done', {
    scanned: summary.scanned,
    present: summary.present,
    missing: summary.missing,
    untracked: summary.untracked,
  }))
}
</script>

<style lang="less" module>
.select {
  width: 150px;
}
.numInput {
  width: 90px;
}
.wide {
  width: 100%;
  max-width: 580px;
  box-sizing: border-box;
}
.progressLine {
  progress {
    width: 100%;
    max-width: 580px;
    accent-color: var(--color-primary);
  }
}
.rowError {
  color: #d98d35;
}
.records {
  max-height: 300px;
  overflow-y: auto;
}
.record {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  font-size: 12px;
  border-bottom: 1px solid var(--color-primary-alpha-100);
}
.recordFile {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recordTags {
  flex: none;
  width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-font-label);
}
.recordStatus {
  flex: none;
  width: 80px;
  color: var(--color-font-label);
}
.recordActions {
  flex: none;
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
    &:disabled {
      opacity: .4;
      cursor: default;
    }
  }
}
.manualInput {
  width: 110px;
  padding: 2px 6px;
  font-size: 12px;
}
</style>
