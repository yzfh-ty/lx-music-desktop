import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { getDB } from '../../db'

const QUALITY_RANK: Record<LX.Subscription.Quality, number> = {
  '128k': 1,
  '320k': 2,
  flac: 3,
  flac24bit: 4,
}

interface SubscriptionRow {
  id: string
  source: LX.OnlineSource
  list_type: LX.Subscription.ListType
  list_id: string
  name: string
  interval_minutes: number | null
  enabled: number
  last_sync_at: number | null
  next_sync_at: number | null
  last_error: string | null
  created_at: number
  updated_at: number
}

interface ConfigRow {
  stop_quality: LX.Subscription.StopQuality
  cd2_root_path: string
  cd2_grpc_url: string
  cd2_api_token: string
  sync_to_cd2: number
  disk_threshold_bytes: number
  disk_locked: number
  disk_paused_at: number | null
  calibration_root_path: string
  calibration_recursive: number
  calibration_include_paths: string
  calibration_exclude_paths: string
  calibration_completed_at: number | null
  structure_root_path: string
  structure_recursive: number
  structure_interval_minutes: number | null
  structure_last_run_at: number | null
  backup_interval_minutes: number | null
  backup_last_at: number | null
  backup_last_path: string
  created_at: number
  updated_at: number
}

interface TaskRow {
  id: string
  music_key: string
  subscription_id: string | null
  source: LX.OnlineSource
  song_id: string
  name: string
  singer: string
  album_name: string
  duration: number | null
  music_info: string
  cloud_quality: LX.Subscription.Quality | null
  library_cloud_path: string | null
  status: LX.Subscription.TaskStatus
  requested_quality: LX.Subscription.Quality | null
  source_reported_quality: LX.Subscription.Quality | null
  file_verified_quality: LX.Subscription.Quality | null
  source_used: string | null
  actual_source: string | null
  actual_song_id: string | null
  local_path: string | null
  task_cloud_path: string | null
  old_cloud_path: string | null
  file_name_format: string | null
  upload_started_at: number | null
  progress: number
  speed: string
  failure_reason: string | null
  pause_origin: LX.Subscription.PauseOrigin | null
  retry_count: number
  cleanup_at: number | null
  discovered_at: number
  download_completed_at: number | null
  upload_completed_at: number | null
  created_at: number
  updated_at: number
}

interface CalibrationRow {
  id: number
  file_path: string
  title: string
  artist: string
  duration: number | null
  quality: LX.Subscription.Quality | null
  status: 'matched' | 'unresolved' | 'failed'
  candidate_music_keys: string
  error: string | null
  scanned_at: number
  confirmed_at: number | null
}

interface CalibrationRunRow {
  status: LX.Subscription.CalibrationRun['status']
  root_path: string
  recursive: number
  include_paths: string
  exclude_paths: string
  total: number
  completed: number
  current_file: string
  matched: number
  unresolved: number
  failed: number
  error: string | null
  started_at: number
  updated_at: number
}

interface CalibrationRunFileRow {
  file_path: string
  position: number
  state: 'pending' | 'completed'
  title: string
  artist: string
  duration: number | null
  quality: LX.Subscription.Quality | null
  error: string | null
}

const toSubscription = (row: SubscriptionRow): LX.Subscription.ListItem => ({
  id: row.id,
  source: row.source,
  listType: row.list_type,
  listId: row.list_id,
  name: row.name,
  intervalMinutes: row.interval_minutes,
  enabled: row.enabled == 1,
  lastSyncAt: row.last_sync_at,
  nextSyncAt: row.next_sync_at,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toConfig = (row: ConfigRow): LX.Subscription.Config => ({
  stopQuality: row.stop_quality,
  cd2RootPath: row.cd2_root_path,
  cd2GrpcUrl: row.cd2_grpc_url,
  cd2ApiToken: row.cd2_api_token,
  syncToCd2: row.sync_to_cd2 == 1,
  diskThresholdBytes: row.disk_threshold_bytes,
  diskLocked: row.disk_locked == 1,
  diskPausedAt: row.disk_paused_at,
  calibrationRootPath: row.calibration_root_path,
  calibrationRecursive: row.calibration_recursive == 1,
  calibrationIncludePaths: JSON.parse(row.calibration_include_paths) as string[],
  calibrationExcludePaths: JSON.parse(row.calibration_exclude_paths) as string[],
  calibrationCompletedAt: row.calibration_completed_at,
  structureRootPath: row.structure_root_path,
  structureRecursive: row.structure_recursive == 1,
  structureIntervalMinutes: row.structure_interval_minutes,
  structureLastRunAt: row.structure_last_run_at,
  backupIntervalMinutes: row.backup_interval_minutes,
  backupLastAt: row.backup_last_at,
  backupLastPath: row.backup_last_path,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toTask = (row: TaskRow): LX.Subscription.Task => ({
  id: row.id,
  musicKey: row.music_key,
  subscriptionId: row.subscription_id,
  source: row.source,
  songId: row.song_id,
  name: row.name,
  singer: row.singer,
  albumName: row.album_name,
  duration: row.duration,
  status: row.status,
  requestedQuality: row.requested_quality,
  sourceReportedQuality: row.source_reported_quality,
  fileVerifiedQuality: row.file_verified_quality,
  cloudQuality: row.cloud_quality,
  sourceUsed: row.source_used,
  actualSource: row.actual_source,
  actualSongId: row.actual_song_id,
  localPath: row.local_path,
  existingCloudPath: row.library_cloud_path,
  cloudPath: row.task_cloud_path,
  oldCloudPath: row.old_cloud_path,
  fileNameFormat: row.file_name_format,
  uploadStartedAt: row.upload_started_at,
  progress: row.progress,
  speed: row.speed,
  failureReason: row.failure_reason,
  pauseOrigin: row.pause_origin,
  retryCount: row.retry_count,
  cleanupAt: row.cleanup_at,
  discoveredAt: row.discovered_at,
  downloadCompletedAt: row.download_completed_at,
  uploadCompletedAt: row.upload_completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  musicInfo: JSON.parse(row.music_info) as LX.Music.MusicInfoOnline,
})

const toTaskHistorySnapshot = (task: LX.Subscription.Task, stopQuality = getSubscriptionConfig().stopQuality) => ({
  requestedQuality: task.requestedQuality,
  sourceReportedQuality: task.sourceReportedQuality,
  fileVerifiedQuality: task.fileVerifiedQuality,
  cloudQuality: task.cloudQuality,
  sourceUsed: task.sourceUsed,
  actualSource: task.actualSource,
  actualSongId: task.actualSongId,
  localPath: task.localPath,
  cloudPath: task.cloudPath ?? task.existingCloudPath,
  oldCloudPath: task.oldCloudPath,
  fileNameFormat: task.fileNameFormat,
  retryCount: task.retryCount,
  cleanupAt: task.cleanupAt,
  discoveredAt: task.discoveredAt,
  downloadCompletedAt: task.downloadCompletedAt,
  uploadCompletedAt: task.uploadCompletedAt,
  stopQuality,
})

const taskSelect = `
  SELECT t.*, l.source, l.song_id, l.name, l.singer, l.album_name, l.duration,
    l.music_info, l.cloud_quality, l.cloud_path AS library_cloud_path,
    t.cloud_path AS task_cloud_path
  FROM subscription_task t
  JOIN subscription_library l ON l.music_key = t.music_key
`

const getConfigRow = (): ConfigRow => {
  const db = getDB()
  let row = db.prepare('SELECT * FROM subscription_config WHERE id = 1').get() as ConfigRow | undefined
  if (!row) {
    const now = Date.now()
    db.prepare('INSERT INTO subscription_config (id, created_at, updated_at) VALUES (1, ?, ?)').run(now, now)
    row = db.prepare('SELECT * FROM subscription_config WHERE id = 1').get() as ConfigRow
  }
  return row
}

export const getSubscriptionConfig = (): LX.Subscription.Config => toConfig(getConfigRow())

export const updateSubscriptionConfig = (input: LX.Subscription.ConfigUpdate): LX.Subscription.Config => {
  const current = getSubscriptionConfig()
  const next = { ...current, ...input, updatedAt: Date.now() }
  if (next.structureIntervalMinutes != null && (!Number.isInteger(next.structureIntervalMinutes) || next.structureIntervalMinutes <= 0)) {
    throw new Error('目录校验周期必须是正整数分钟')
  }
  if (next.backupIntervalMinutes != null && (!Number.isInteger(next.backupIntervalMinutes) || next.backupIntervalMinutes <= 0)) {
    throw new Error('数据库备份周期必须是正整数分钟')
  }
  const db = getDB()
  db.transaction(() => {
    db.prepare(`
      UPDATE subscription_config SET
      stop_quality = @stopQuality,
      cd2_root_path = @cd2RootPath,
      cd2_grpc_url = @cd2GrpcUrl,
      cd2_api_token = @cd2ApiToken,
      sync_to_cd2 = @syncToCd2,
      disk_threshold_bytes = @diskThresholdBytes,
      disk_locked = @diskLocked,
      disk_paused_at = @diskPausedAt,
      calibration_root_path = @calibrationRootPath,
      calibration_recursive = @calibrationRecursive,
      calibration_include_paths = @calibrationIncludePaths,
      calibration_exclude_paths = @calibrationExcludePaths,
      calibration_completed_at = @calibrationCompletedAt,
      structure_root_path = @structureRootPath,
      structure_recursive = @structureRecursive,
      structure_interval_minutes = @structureIntervalMinutes,
      structure_last_run_at = @structureLastRunAt,
      backup_interval_minutes = @backupIntervalMinutes,
      backup_last_at = @backupLastAt,
      backup_last_path = @backupLastPath,
      updated_at = @updatedAt
      WHERE id = 1
    `).run({
      ...next,
      syncToCd2: next.syncToCd2 ? 1 : 0,
      diskLocked: next.diskLocked ? 1 : 0,
      calibrationRecursive: next.calibrationRecursive ? 1 : 0,
      structureRecursive: next.structureRecursive ? 1 : 0,
      calibrationIncludePaths: JSON.stringify(next.calibrationIncludePaths),
      calibrationExcludePaths: JSON.stringify(next.calibrationExcludePaths),
    })
    if ('stopQuality' in input) {
      db.prepare(`
        UPDATE subscription_library SET
          quality_satisfied = CASE
            WHEN cloud_quality IS NULL OR @stopQuality = 'none' THEN 0
            WHEN (CASE cloud_quality WHEN '128k' THEN 1 WHEN '320k' THEN 2 WHEN 'flac' THEN 3 WHEN 'flac24bit' THEN 4 ELSE 0 END)
              >= (CASE @stopQuality WHEN '128k' THEN 1 WHEN '320k' THEN 2 WHEN 'flac' THEN 3 WHEN 'flac24bit' THEN 4 ELSE 99 END)
              THEN 1 ELSE 0
          END,
          updated_at = @updatedAt
      `).run({ stopQuality: next.stopQuality, updatedAt: next.updatedAt })
    }
  })()
  return getSubscriptionConfig()
}

export const getSubscriptions = (): LX.Subscription.ListItem[] => {
  return (getDB().prepare('SELECT * FROM subscription_list ORDER BY created_at DESC').all() as SubscriptionRow[]).map(toSubscription)
}

export const getDueSubscriptions = (now: number): LX.Subscription.ListItem[] => {
  return (getDB().prepare(`
    SELECT * FROM subscription_list
    WHERE enabled = 1 AND interval_minutes IS NOT NULL AND next_sync_at IS NOT NULL AND next_sync_at <= ?
    ORDER BY next_sync_at ASC
  `).all(now) as SubscriptionRow[]).map(toSubscription)
}

export const createSubscription = (input: LX.Subscription.ListCreate): LX.Subscription.ListItem => {
  const source = input.source.trim() as LX.OnlineSource
  const listType = input.listType == 'board' ? 'board' : 'playlist'
  const listId = input.listId.trim()
  const name = input.name.trim()
  if (!source || !listId || !name) throw new Error('订阅平台、歌单 ID 和名称不能为空')
  if (input.intervalMinutes != null && (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes <= 0)) {
    throw new Error('同步周期必须是正整数分钟')
  }
  const now = Date.now()
  const item: LX.Subscription.ListItem = {
    id: randomUUID(),
    source,
    listType,
    listId,
    name,
    intervalMinutes: input.intervalMinutes,
    enabled: true,
    lastSyncAt: null,
    nextSyncAt: input.intervalMinutes == null ? null : now + input.intervalMinutes * 60_000,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  }
  try {
    getDB().prepare(`
      INSERT INTO subscription_list (
        id, source, list_type, list_id, name, interval_minutes, enabled,
        last_sync_at, next_sync_at, last_error, created_at, updated_at
      ) VALUES (
        @id, @source, @listType, @listId, @name, @intervalMinutes, @enabled,
        @lastSyncAt, @nextSyncAt, @lastError, @createdAt, @updatedAt
      )
    `).run({ ...item, enabled: 1 })
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) throw new Error('该歌单已订阅')
    throw err
  }
  return item
}

export const updateSubscription = (input: LX.Subscription.ListUpdate): LX.Subscription.ListItem => {
  const row = getDB().prepare('SELECT * FROM subscription_list WHERE id = ?').get(input.id) as SubscriptionRow | undefined
  if (!row) throw new Error('订阅不存在')
  const current = toSubscription(row)
  const now = Date.now()
  const next = { ...current, ...input, updatedAt: now }
  if (next.intervalMinutes != null && (!Number.isInteger(next.intervalMinutes) || next.intervalMinutes <= 0)) {
    throw new Error('同步周期必须是正整数分钟')
  }
  if ('intervalMinutes' in input || ('enabled' in input && input.enabled)) {
    next.nextSyncAt = next.enabled && next.intervalMinutes != null ? now + next.intervalMinutes * 60_000 : null
  } else if ('enabled' in input && !input.enabled) {
    next.nextSyncAt = null
  }
  getDB().prepare(`
    UPDATE subscription_list SET
      name = @name, interval_minutes = @intervalMinutes, enabled = @enabled,
      last_sync_at = @lastSyncAt, next_sync_at = @nextSyncAt,
      last_error = @lastError, updated_at = @updatedAt
    WHERE id = @id
  `).run({ ...next, enabled: next.enabled ? 1 : 0 })
  return next
}

export const removeSubscription = (id: string): void => {
  const db = getDB()
  db.transaction(() => {
    db.prepare('DELETE FROM subscription_music WHERE subscription_id = ?').run(id)
    db.prepare('DELETE FROM subscription_list WHERE id = ?').run(id)
  })()
}

const isSatisfied = (quality: LX.Subscription.Quality | null, stopQuality: LX.Subscription.StopQuality) => {
  return quality != null && stopQuality != 'none' && QUALITY_RANK[quality] >= QUALITY_RANK[stopQuality]
}

const normalizeCalibrationText = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')

const toCalibrationRecord = (row: CalibrationRow): LX.Subscription.CalibrationRecord => ({
  id: row.id,
  filePath: row.file_path,
  title: row.title,
  artist: row.artist,
  duration: row.duration,
  quality: row.quality,
  status: row.status,
  candidateMusicKeys: JSON.parse(row.candidate_music_keys) as string[],
  error: row.error,
  scannedAt: row.scanned_at,
  confirmedAt: row.confirmed_at,
})

const toCalibrationRun = (row: CalibrationRunRow): LX.Subscription.CalibrationRun => ({
  status: row.status,
  input: {
    rootPath: row.root_path,
    recursive: row.recursive == 1,
    includePaths: JSON.parse(row.include_paths) as string[],
    excludePaths: JSON.parse(row.exclude_paths) as string[],
  },
  total: row.total,
  completed: row.completed,
  currentFile: row.current_file,
  matched: row.matched,
  unresolved: row.unresolved,
  failed: row.failed,
  error: row.error,
  startedAt: row.started_at,
  updatedAt: row.updated_at,
})

export const getSubscriptionCalibrationRun = (): LX.Subscription.CalibrationRun | null => {
  const row = getDB().prepare('SELECT * FROM subscription_calibration_run WHERE id = 1').get() as CalibrationRunRow | undefined
  return row ? toCalibrationRun(row) : null
}

export const beginSubscriptionCalibrationRun = (input: LX.Subscription.CalibrationScanInput): LX.Subscription.CalibrationRun => {
  const now = Date.now()
  const db = getDB()
  db.transaction(() => {
    db.prepare('DELETE FROM subscription_calibration_run_file').run()
    db.prepare(`
      INSERT INTO subscription_calibration_run (
        id, status, root_path, recursive, include_paths, exclude_paths,
        total, completed, current_file, matched, unresolved, failed,
        error, started_at, updated_at
      ) VALUES (1, 'collecting', ?, ?, ?, ?, 0, 0, '', 0, 0, 0, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status, root_path = excluded.root_path,
        recursive = excluded.recursive, include_paths = excluded.include_paths,
        exclude_paths = excluded.exclude_paths, total = 0, completed = 0,
        current_file = '', matched = 0, unresolved = 0, failed = 0,
        error = NULL, started_at = excluded.started_at, updated_at = excluded.updated_at
    `).run(input.rootPath, input.recursive ? 1 : 0, JSON.stringify(input.includePaths), JSON.stringify(input.excludePaths), now, now)
  })()
  return getSubscriptionCalibrationRun()!
}

export const prepareSubscriptionCalibrationFiles = (files: string[]): LX.Subscription.CalibrationRun => {
  const db = getDB()
  const now = Date.now()
  db.transaction(() => {
    db.prepare('DELETE FROM subscription_calibration_run_file').run()
    const insert = db.prepare(`
      INSERT INTO subscription_calibration_run_file (file_path, position, state)
      VALUES (?, ?, 'pending')
    `)
    files.forEach((filePath, index) => insert.run(filePath, index))
    db.prepare(`
      UPDATE subscription_calibration_run SET status = 'running', total = ?,
        completed = 0, current_file = '', error = NULL, updated_at = ? WHERE id = 1
    `).run(files.length, now)
  })()
  return getSubscriptionCalibrationRun()!
}

export const getPendingSubscriptionCalibrationFiles = (): string[] => {
  return getDB().prepare(`
    SELECT file_path FROM subscription_calibration_run_file
    WHERE state = 'pending' ORDER BY position
  `).pluck().all() as string[]
}

export const saveSubscriptionCalibrationFile = (file: LX.Subscription.CalibrationFile): LX.Subscription.CalibrationRun => {
  const db = getDB()
  const now = Date.now()
  db.transaction(() => {
    db.prepare(`
      UPDATE subscription_calibration_run_file SET state = 'completed', title = ?,
        artist = ?, duration = ?, quality = ?, error = ? WHERE file_path = ?
    `).run(file.title, file.artist, file.duration, file.quality, file.error, file.filePath)
    const completed = Number(db.prepare("SELECT COUNT(*) FROM subscription_calibration_run_file WHERE state = 'completed'").pluck().get())
    db.prepare(`
      UPDATE subscription_calibration_run SET status = 'running', completed = ?,
        current_file = ?, error = NULL, updated_at = ? WHERE id = 1
    `).run(completed, file.filePath, now)
  })()
  return getSubscriptionCalibrationRun()!
}

export const getSubscriptionCalibrationRunFiles = (): LX.Subscription.CalibrationFile[] => {
  const rows = getDB().prepare(`
    SELECT * FROM subscription_calibration_run_file ORDER BY position
  `).all() as CalibrationRunFileRow[]
  return rows.filter(row => row.state == 'completed').map(row => ({
    filePath: row.file_path,
    title: row.title,
    artist: row.artist,
    duration: row.duration,
    quality: row.quality,
    error: row.error,
  }))
}

export const completeSubscriptionCalibrationRun = (summary: LX.Subscription.CalibrationSummary): LX.Subscription.CalibrationRun => {
  const now = Date.now()
  getDB().prepare(`
    UPDATE subscription_calibration_run SET status = 'completed', completed = total,
      current_file = '', matched = ?, unresolved = ?, failed = ?,
      error = NULL, updated_at = ? WHERE id = 1
  `).run(summary.matched, summary.unresolved, summary.failed, now)
  return getSubscriptionCalibrationRun()!
}

export const failSubscriptionCalibrationRun = (message: string): LX.Subscription.CalibrationRun => {
  getDB().prepare(`
    UPDATE subscription_calibration_run SET status = 'failed', error = ?, updated_at = ? WHERE id = 1
  `).run(message, Date.now())
  return getSubscriptionCalibrationRun()!
}

export const resumeSubscriptionCalibrationRun = (): LX.Subscription.CalibrationRun => {
  const run = getSubscriptionCalibrationRun()
  if (!run) throw new Error('没有可恢复的扫描任务')
  getDB().prepare(`
    UPDATE subscription_calibration_run SET status = CASE WHEN total > 0 THEN 'running' ELSE 'collecting' END,
      error = NULL, updated_at = ? WHERE id = 1
  `).run(Date.now())
  return getSubscriptionCalibrationRun()!
}

const applyCalibrationMatch = (
  musicKey: string,
  file: LX.Subscription.CalibrationFile,
  confirmedAt: number,
) => {
  if (!file.quality) throw new Error('扫描文件的音质无法比较')
  const db = getDB()
  const config = getSubscriptionConfig()
  db.prepare(`
    UPDATE subscription_library SET cloud_quality = ?, cloud_path = ?,
      upload_confirmed_at = ?, record_origin = 'calibrated', calibration_status = 'matched',
      calibrated_at = ?, quality_satisfied = ?, updated_at = ?
    WHERE music_key = ?
  `).run(file.quality, file.filePath, confirmedAt, confirmedAt,
    isSatisfied(file.quality, config.stopQuality) ? 1 : 0, confirmedAt, musicKey)
  db.prepare(`
    UPDATE subscription_task SET status = 'uploaded', cloud_path = ?, old_cloud_path = NULL,
      local_path = NULL, file_verified_quality = ?, failure_reason = NULL,
      cleanup_at = NULL, upload_completed_at = ?, progress = 100, speed = '', updated_at = ?
    WHERE music_key = ? AND status IN ('discovered', 'pending', 'disk_paused', 'failed', 'quality_skipped', 'calibration_unresolved', 'uploaded')
  `).run(file.filePath, file.quality, confirmedAt, confirmedAt, musicKey)
}

export const importSubscriptionCalibration = (files: LX.Subscription.CalibrationFile[]): LX.Subscription.CalibrationSummary => {
  const db = getDB()
  const scannedAt = Date.now()
  const library = db.prepare('SELECT music_key, name, singer, duration FROM subscription_library').all() as Array<{
    music_key: string
    name: string
    singer: string
    duration: number | null
  }>
  const prepared = files.map(file => {
    const title = normalizeCalibrationText(file.title)
    const artist = normalizeCalibrationText(file.artist)
    const candidates = file.error != null || !title || !artist || file.duration == null
      ? []
      : library.filter(item => item.duration != null &&
        normalizeCalibrationText(item.name) == title &&
        normalizeCalibrationText(item.singer) == artist &&
        Math.abs(item.duration - file.duration!) <= 3)
        .map(item => item.music_key)
    return { file, candidates }
  })
  const candidateFileCount = new Map<string, number>()
  for (const item of prepared) {
    if (item.file.error != null || item.file.quality == null) continue
    for (const musicKey of item.candidates) candidateFileCount.set(musicKey, (candidateFileCount.get(musicKey) ?? 0) + 1)
  }
  const summary: LX.Subscription.CalibrationSummary = { scanned: files.length, matched: 0, unresolved: 0, failed: 0 }
  const upsert = db.prepare(`
    INSERT INTO subscription_calibration (
      file_path, title, artist, duration, quality, status,
      candidate_music_keys, error, scanned_at, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      title = excluded.title, artist = excluded.artist, duration = excluded.duration,
      quality = excluded.quality, status = excluded.status,
      candidate_music_keys = excluded.candidate_music_keys, error = excluded.error,
      scanned_at = excluded.scanned_at, confirmed_at = excluded.confirmed_at
  `)
  db.transaction(() => {
    db.prepare(`
      UPDATE subscription_library SET calibration_status = NULL, updated_at = ?
      WHERE calibration_status = 'calibration_unresolved'
    `).run(scannedAt)
    db.prepare(`
      UPDATE subscription_task SET status = 'pending', failure_reason = NULL, updated_at = ?
      WHERE status = 'calibration_unresolved'
    `).run(scannedAt)
    for (const { file, candidates } of prepared) {
      let status: CalibrationRow['status']
      let error = file.error
      if (file.error) {
        status = 'failed'
        summary.failed++
      } else if (!file.quality) {
        status = 'unresolved'
        error = '无法识别可比较的音质'
        summary.unresolved++
      } else if (!file.title || !file.artist || file.duration == null) {
        status = 'unresolved'
        error = '缺少歌名、歌手或时长标签'
        summary.unresolved++
      } else if (candidates.length != 1 || candidateFileCount.get(candidates[0]) != 1) {
        status = 'unresolved'
        error = candidates.length > 1 || (candidates.length == 1 && candidateFileCount.get(candidates[0]) != 1)
          ? '匹配到多个候选或同一歌曲对应多个文件'
          : '未找到可唯一关联的订阅歌曲'
        summary.unresolved++
      } else {
        status = 'matched'
        error = null
        applyCalibrationMatch(candidates[0], file, scannedAt)
        summary.matched++
      }
      upsert.run(file.filePath, file.title, file.artist, file.duration, file.quality,
        status, JSON.stringify(candidates), error, scannedAt, status == 'matched' ? scannedAt : null)
      if (status == 'unresolved' && candidates.length) {
        const reason = `网盘歌曲待人工确认：${file.filePath}`
        for (const musicKey of candidates) {
          db.prepare(`
            UPDATE subscription_library SET calibration_status = 'calibration_unresolved', updated_at = ?
            WHERE music_key = ?
          `).run(scannedAt, musicKey)
          db.prepare(`
            UPDATE subscription_task SET status = 'calibration_unresolved', failure_reason = ?,
              progress = 0, speed = '', updated_at = ?
            WHERE music_key = ? AND status NOT IN ('uploading', 'upload_unconfirmed', 'old_version_cleanup', 'cleanup_wait', 'local_completed')
          `).run(reason, scannedAt, musicKey)
        }
      }
    }
    db.prepare('UPDATE subscription_config SET calibration_completed_at = ?, updated_at = ? WHERE id = 1').run(scannedAt, scannedAt)
  })()
  return summary
}

export const getSubscriptionCalibrationRecords = (): LX.Subscription.CalibrationRecord[] => {
  return (getDB().prepare(`
    SELECT * FROM subscription_calibration
    ORDER BY CASE status WHEN 'unresolved' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END, scanned_at DESC
  `).all() as CalibrationRow[]).map(toCalibrationRecord)
}

export const confirmSubscriptionCalibration = (input: LX.Subscription.CalibrationConfirmInput): LX.Subscription.CalibrationRecord => {
  const db = getDB()
  const row = db.prepare('SELECT * FROM subscription_calibration WHERE id = ?').get(input.recordId) as CalibrationRow | undefined
  if (!row) throw new Error('待确认记录不存在')
  if (!db.prepare('SELECT 1 FROM subscription_library WHERE music_key = ?').get(input.musicKey)) throw new Error('目标订阅歌曲不存在')
  const record = toCalibrationRecord(row)
  const confirmedAt = Date.now()
  db.transaction(() => {
    const existing = db.prepare('SELECT cloud_path, record_origin FROM subscription_library WHERE music_key = ?').get(input.musicKey) as {
      cloud_path: string | null
      record_origin: string | null
    } | undefined
    if (!existing) throw new Error('人工确认的歌曲键不存在于订阅音乐库')
    if (existing.cloud_path && existing.cloud_path != record.filePath && existing.record_origin == 'calibrated') {
      throw new Error('该歌曲已关联另一个待确认文件，请先处理重复关联')
    }
    applyCalibrationMatch(input.musicKey, record, confirmedAt)
    db.prepare(`
      UPDATE subscription_calibration SET status = 'matched', candidate_music_keys = ?,
        error = NULL, confirmed_at = ? WHERE id = ?
    `).run(JSON.stringify([input.musicKey]), confirmedAt, input.recordId)
    for (const musicKey of record.candidateMusicKeys.filter(key => key != input.musicKey)) {
      const stillUnresolved = db.prepare(`
        SELECT 1 FROM subscription_calibration c, json_each(c.candidate_music_keys)
        WHERE c.status = 'unresolved' AND json_each.value = ? LIMIT 1
      `).get(musicKey)
      if (stillUnresolved) continue
      db.prepare(`
        UPDATE subscription_library SET calibration_status = NULL, updated_at = ?
        WHERE music_key = ? AND calibration_status = 'calibration_unresolved'
      `).run(confirmedAt, musicKey)
      db.prepare(`
        UPDATE subscription_task SET status = 'pending', failure_reason = NULL, updated_at = ?
        WHERE music_key = ? AND status = 'calibration_unresolved'
      `).run(confirmedAt, musicKey)
    }
  })()
  return getSubscriptionCalibrationRecords().find(item => item.id == input.recordId)!
}

export const ingestSubscriptionSync = (input: LX.Subscription.SyncInput): LX.Subscription.SyncResult => {
  const db = getDB()
  const subscription = db.prepare('SELECT * FROM subscription_list WHERE id = ?').get(input.subscriptionId) as SubscriptionRow | undefined
  if (!subscription) throw new Error('订阅不存在')
  const config = getSubscriptionConfig()
  const result: LX.Subscription.SyncResult = { discovered: 0, queued: 0, skipped: 0, total: input.tracks.length }

  db.transaction(() => {
    const findLibrary = db.prepare('SELECT cloud_quality, cloud_path, calibration_status FROM subscription_library WHERE music_key = ?')
    const insertLibrary = db.prepare(`
      INSERT INTO subscription_library (
        music_key, source, song_id, name, singer, album_name, duration,
        music_info, created_at, updated_at
      ) VALUES (
        @musicKey, @source, @songId, @name, @singer, @albumName, @duration,
        @musicInfo, @createdAt, @updatedAt
      )
    `)
    const updateLibraryInfo = db.prepare(`
      UPDATE subscription_library SET
        name = @name, singer = @singer, album_name = @albumName,
        duration = @duration, music_info = @musicInfo, updated_at = @updatedAt
      WHERE music_key = @musicKey
    `)
    const saveRelation = db.prepare(`
      INSERT INTO subscription_music (subscription_id, music_key, first_seen_at, last_seen_at)
      VALUES (@subscriptionId, @musicKey, @now, @now)
      ON CONFLICT(subscription_id, music_key) DO UPDATE SET last_seen_at = excluded.last_seen_at
    `)
    const findTask = db.prepare('SELECT status FROM subscription_task WHERE music_key = ?')
    const insertTask = db.prepare(`
      INSERT INTO subscription_task (
        id, music_key, subscription_id, status, discovered_at, created_at, updated_at
      ) VALUES (@id, @musicKey, @subscriptionId, @status, @now, @now, @now)
    `)
    const resetUploadedTask = db.prepare(`
      UPDATE subscription_task SET subscription_id = @subscriptionId, status = 'pending',
        requested_quality = NULL, source_reported_quality = NULL, file_verified_quality = NULL,
        source_used = NULL, actual_source = NULL, actual_song_id = NULL,
        local_path = NULL, cloud_path = NULL, old_cloud_path = NULL,
        file_name_format = NULL, upload_started_at = NULL,
        progress = 0, speed = '', failure_reason = NULL, cleanup_at = NULL,
        download_completed_at = NULL, upload_completed_at = NULL, updated_at = @now
      WHERE music_key = @musicKey
    `)
    const history = db.prepare(`
      INSERT INTO subscription_history (task_id, music_key, status, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    const seen = new Set<string>()
    for (const track of input.tracks) {
      const musicKey = `${track.source}:${track.id}`
      if (seen.has(musicKey)) continue
      seen.add(musicKey)
      const payload = {
        musicKey,
        source: track.source,
        songId: track.id,
        name: track.name,
        singer: track.singer,
        albumName: track.albumName ?? '',
        duration: track.duration ?? null,
        musicInfo: JSON.stringify(track.musicInfo),
        createdAt: input.syncedAt,
        updatedAt: input.syncedAt,
      }
      let library = findLibrary.get(musicKey) as { cloud_quality: LX.Subscription.Quality | null, cloud_path: string | null, calibration_status: string | null } | undefined
      if (!library) {
        insertLibrary.run(payload)
        library = { cloud_quality: null, cloud_path: null, calibration_status: null }
        result.discovered++
      } else {
        updateLibraryInfo.run(payload)
      }
      saveRelation.run({ subscriptionId: input.subscriptionId, musicKey, now: input.syncedAt })

      const task = findTask.get(musicKey) as { status: LX.Subscription.TaskStatus } | undefined
      const hasUnknownCloudQuality = library.calibration_status == 'calibration_unresolved' ||
        (library.cloud_path != null && library.cloud_quality == null)
      if (hasUnknownCloudQuality || isSatisfied(library.cloud_quality, config.stopQuality) || task?.status == 'failed') {
        result.skipped++
        continue
      }
      if (!task) {
        const taskId = randomUUID()
        insertTask.run({ id: taskId, musicKey, subscriptionId: input.subscriptionId, status: 'pending', now: input.syncedAt })
        history.run(taskId, musicKey, 'pending', '歌单同步发现歌曲', input.syncedAt)
        result.queued++
      } else if (['uploaded', 'discovered', 'quality_skipped'].includes(task.status)) {
        resetUploadedTask.run({ musicKey, subscriptionId: input.subscriptionId, now: input.syncedAt })
        history.run(db.prepare('SELECT id FROM subscription_task WHERE music_key = ?').pluck().get(musicKey), musicKey, 'pending', '发现潜在音质升级', input.syncedAt)
        result.queued++
      } else {
        result.skipped++
      }
    }

    const interval = subscription.interval_minutes
    db.prepare(`
      UPDATE subscription_list SET name = COALESCE(?, name), last_sync_at = ?,
        next_sync_at = ?, last_error = NULL, updated_at = ? WHERE id = ?
    `).run(input.subscriptionName?.trim() ?? null, input.syncedAt, interval == null ? null : input.syncedAt + interval * 60_000, input.syncedAt, input.subscriptionId)
  })()
  return result
}

export const setSubscriptionSyncError = (id: string, message: string): void => {
  const now = Date.now()
  getDB().prepare(`
    UPDATE subscription_list SET last_error = ?,
      next_sync_at = CASE WHEN interval_minutes IS NULL THEN NULL ELSE ? + interval_minutes * 60000 END,
      updated_at = ? WHERE id = ?
  `).run(message, now, now, id)
}

export const getSubscriptionTasks = (status?: LX.Subscription.TaskStatus): LX.Subscription.Task[] => {
  const rows = status
    ? getDB().prepare(`${taskSelect} WHERE t.status = ? ORDER BY t.updated_at DESC`).all(status)
    : getDB().prepare(`${taskSelect} ORDER BY t.updated_at DESC`).all()
  return (rows as TaskRow[]).map(toTask)
}

export const updateSubscriptionTask = (input: LX.Subscription.TaskUpdate): LX.Subscription.Task => {
  const currentRow = getDB().prepare(`${taskSelect} WHERE t.id = ?`).get(input.id) as TaskRow | undefined
  if (!currentRow) throw new Error('任务不存在')
  const current = toTask(currentRow)
  const next = { ...current, ...input, updatedAt: Date.now() }
  if ((next.status == 'uploading' || next.status == 'upload_unconfirmed') && !getSubscriptionConfig().syncToCd2) {
    next.status = 'local_completed'
    next.progress = 100
    next.speed = ''
    next.cleanupAt = null
    next.uploadCompletedAt = null
    next.uploadStartedAt = null
    next.failureReason = null
  }
  getDB().transaction(() => {
    getDB().prepare(`
      UPDATE subscription_task SET
        subscription_id = @subscriptionId, status = @status,
        requested_quality = @requestedQuality, source_reported_quality = @sourceReportedQuality,
        file_verified_quality = @fileVerifiedQuality, source_used = @sourceUsed,
        actual_source = @actualSource, actual_song_id = @actualSongId,
        local_path = @localPath, cloud_path = @cloudPath, old_cloud_path = @oldCloudPath,
        file_name_format = @fileNameFormat, upload_started_at = @uploadStartedAt,
        progress = @progress, speed = @speed, failure_reason = @failureReason,
        pause_origin = @pauseOrigin,
        retry_count = @retryCount, cleanup_at = @cleanupAt,
        download_completed_at = @downloadCompletedAt, upload_completed_at = @uploadCompletedAt,
        updated_at = @updatedAt
      WHERE id = @id
    `).run(next)
    if (next.status != current.status || next.failureReason != current.failureReason) {
      getDB().prepare(`
        INSERT INTO subscription_history (task_id, music_key, status, message, snapshot, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(next.id, next.musicKey, next.status,
        next.status == 'local_completed' ? 'CD2 同步已关闭，任务仅保留本地成品' : next.failureReason,
        JSON.stringify(toTaskHistorySnapshot(next)), next.updatedAt)
    }
  })()
  return getSubscriptionTasks().find(task => task.id == input.id)!
}

export const retrySubscriptionTasks = (ids: string[]): number => {
  const db = getDB()
  const now = Date.now()
  let count = 0
  db.transaction(() => {
    const update = db.prepare(`
      UPDATE subscription_task SET status = CASE
          WHEN upload_completed_at IS NOT NULL AND old_cloud_path IS NOT NULL THEN 'old_version_cleanup'
          WHEN local_path IS NOT NULL AND file_verified_quality IS NOT NULL THEN 'tagging'
          WHEN local_path IS NOT NULL THEN 'quality_check'
          ELSE 'pending'
        END, failure_reason = NULL, pause_origin = NULL,
        progress = 0, speed = '', retry_count = retry_count + 1, updated_at = ?
      WHERE id = ? AND status IN ('failed', 'upload_unconfirmed')
    `)
    const find = db.prepare('SELECT music_key, status FROM subscription_task WHERE id = ?')
    const history = db.prepare(`
      INSERT INTO subscription_history (task_id, music_key, status, message, created_at)
      VALUES (?, ?, ?, '用户手动重试', ?)
    `)
    for (const id of ids) {
      const result = update.run(now, id)
      if (!result.changes) continue
      const task = find.get(id) as { music_key: string, status: LX.Subscription.TaskStatus }
      history.run(id, task.music_key, task.status, now)
      count++
    }
  })()
  return count
}

export const confirmSubscriptionUpload = (input: {
  taskId: string
  cloudPath: string
  cloudQuality: LX.Subscription.Quality
  fileNameFormat: string
  confirmedAt: number
  cleanupAt: number
}): LX.Subscription.Task => {
  const db = getDB()
  const row = db.prepare('SELECT music_key FROM subscription_task WHERE id = ?').get(input.taskId) as { music_key: string } | undefined
  if (!row) throw new Error('任务不存在')
  const config = getSubscriptionConfig()
  const task = db.prepare('SELECT old_cloud_path FROM subscription_task WHERE id = ?').get(input.taskId) as { old_cloud_path: string | null }
  const nextStatus: LX.Subscription.TaskStatus = task.old_cloud_path ? 'old_version_cleanup' : 'cleanup_wait'
  db.transaction(() => {
    db.prepare(`
      UPDATE subscription_library SET cloud_quality = ?, cloud_path = ?, file_name_format = ?,
        upload_confirmed_at = ?, record_origin = 'uploaded', quality_satisfied = ?, updated_at = ?
      WHERE music_key = ?
    `).run(input.cloudQuality, input.cloudPath, input.fileNameFormat, input.confirmedAt,
      isSatisfied(input.cloudQuality, config.stopQuality) ? 1 : 0, input.confirmedAt, row.music_key)
    db.prepare(`
      UPDATE subscription_task SET status = ?, cloud_path = ?,
        file_verified_quality = ?, upload_completed_at = ?, cleanup_at = ?,
        progress = 100, failure_reason = NULL, updated_at = ? WHERE id = ?
    `).run(nextStatus, input.cloudPath, input.cloudQuality, input.confirmedAt, input.cleanupAt, input.confirmedAt, input.taskId)
    const confirmedTask = toTask(db.prepare(`${taskSelect} WHERE t.id = ?`).get(input.taskId) as TaskRow)
    db.prepare(`
      INSERT INTO subscription_history (task_id, music_key, status, message, snapshot, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.taskId, row.music_key, nextStatus,
      nextStatus == 'old_version_cleanup' ? 'CD2 已确认新版本上传成功，等待清理旧扩展名版本' : 'CD2 已确认上传成功',
      JSON.stringify(toTaskHistorySnapshot(confirmedTask, config.stopQuality)), input.confirmedAt)
  })()
  return getSubscriptionTasks().find(task => task.id == input.taskId)!
}

export const getSubscriptionDashboard = (): LX.Subscription.Dashboard => {
  const db = getDB()
  const count = (sql: string, ...params: unknown[]) => Number(db.prepare(sql).pluck().get(...params) ?? 0)
  const config = getSubscriptionConfig()
  return {
    subscriptionCount: count('SELECT COUNT(*) FROM subscription_list'),
    pendingCount: count("SELECT COUNT(*) FROM subscription_task WHERE status IN ('discovered', 'pending', 'disk_paused', 'resolving')"),
    downloadingCount: count("SELECT COUNT(*) FROM subscription_task WHERE status IN ('downloading', 'downloaded', 'quality_check', 'tagging')"),
    uploadingCount: count("SELECT COUNT(*) FROM subscription_task WHERE status IN ('uploading', 'old_version_cleanup')"),
    unconfirmedCount: count("SELECT COUNT(*) FROM subscription_task WHERE status = 'upload_unconfirmed'"),
    failedCount: count("SELECT COUNT(*) FROM subscription_task WHERE status = 'failed'"),
    cleanupCount: count("SELECT COUNT(*) FROM subscription_task WHERE status = 'cleanup_wait'"),
    libraryCount: count('SELECT COUNT(*) FROM subscription_library'),
    lastSyncAt: (db.prepare('SELECT MAX(last_sync_at) FROM subscription_list').pluck().get() as number | null) ?? null,
    diskLocked: config.diskLocked,
  }
}

export const getSubscriptionHistory = (limit = 500): LX.Subscription.HistoryItem[] => {
  const safeLimit = Math.max(1, Math.min(2_000, Math.trunc(limit)))
  const rows = getDB().prepare(`
    SELECT h.*, l.name, l.singer, l.album_name, l.duration, l.source,
      l.cloud_quality AS library_cloud_quality, l.cloud_path AS library_cloud_path,
      l.file_name_format AS library_file_name_format, l.upload_confirmed_at,
      l.record_origin, l.calibration_status, l.calibrated_at, l.quality_satisfied,
      t.requested_quality, t.source_reported_quality, t.file_verified_quality,
      t.source_used, t.actual_source, t.actual_song_id, t.local_path,
      t.cloud_path AS task_cloud_path, t.old_cloud_path, t.file_name_format AS task_file_name_format,
      t.retry_count, t.cleanup_at
    FROM subscription_history h
    JOIN subscription_library l ON l.music_key = h.music_key
    LEFT JOIN subscription_task t ON t.id = h.task_id
    ORDER BY h.created_at DESC, h.id DESC
    LIMIT ?
  `).all(safeLimit) as Array<{
    id: number
    task_id: string
    music_key: string
    name: string
    singer: string
    album_name: string
    duration: number | null
    source: LX.OnlineSource
    library_cloud_quality: LX.Subscription.Quality | null
    library_cloud_path: string | null
    library_file_name_format: string | null
    upload_confirmed_at: number | null
    record_origin: LX.Subscription.HistoryItem['recordOrigin']
    calibration_status: string | null
    calibrated_at: number | null
    quality_satisfied: number
    requested_quality: LX.Subscription.Quality | null
    source_reported_quality: LX.Subscription.Quality | null
    file_verified_quality: LX.Subscription.Quality | null
    source_used: string | null
    actual_source: string | null
    actual_song_id: string | null
    local_path: string | null
    task_cloud_path: string | null
    old_cloud_path: string | null
    task_file_name_format: string | null
    retry_count: number | null
    cleanup_at: number | null
    status: LX.Subscription.TaskStatus
    message: string | null
    snapshot: string | null
    created_at: number
  }>
  return rows.map(row => {
    let snapshot: Record<string, unknown> | null = null
    try {
      snapshot = row.snapshot ? JSON.parse(row.snapshot) as Record<string, unknown> : null
    } catch {}
    const hasSnapshotValue = (key: string) => snapshot != null && Object.prototype.hasOwnProperty.call(snapshot, key)
    const quality = (key: string, fallback: LX.Subscription.Quality | null) => {
      if (!hasSnapshotValue(key)) return fallback
      const value = snapshot?.[key]
      return ['128k', '320k', 'flac', 'flac24bit'].includes(String(value)) ? value as LX.Subscription.Quality : null
    }
    const stringValue = (key: string, fallback: string | null) => hasSnapshotValue(key)
      ? typeof snapshot?.[key] == 'string' ? snapshot[key] : null
      : fallback
    const numberValue = (key: string, fallback: number | null) => hasSnapshotValue(key)
      ? typeof snapshot?.[key] == 'number' ? snapshot[key] : null
      : fallback
    const stopQualityValue = snapshot?.stopQuality
    const stopQuality = ['128k', '320k', 'flac', 'flac24bit', 'none'].includes(String(stopQualityValue))
      ? stopQualityValue as LX.Subscription.StopQuality
      : null
    return {
      id: row.id,
      taskId: row.task_id,
      musicKey: row.music_key,
      name: row.name,
      singer: row.singer,
      albumName: row.album_name,
      duration: row.duration,
      source: row.source,
      status: row.status,
      message: row.message,
      snapshot,
      requestedQuality: quality('requestedQuality', row.requested_quality),
      sourceReportedQuality: quality('sourceReportedQuality', row.source_reported_quality),
      fileVerifiedQuality: quality('fileVerifiedQuality', row.file_verified_quality),
      cloudQuality: quality('cloudQuality', row.library_cloud_quality),
      sourceUsed: stringValue('sourceUsed', row.source_used),
      actualSource: stringValue('actualSource', row.actual_source),
      actualSongId: stringValue('actualSongId', row.actual_song_id),
      localPath: stringValue('localPath', row.local_path),
      cloudPath: stringValue('cloudPath', row.task_cloud_path ?? row.library_cloud_path),
      oldCloudPath: stringValue('oldCloudPath', row.old_cloud_path),
      fileNameFormat: stringValue('fileNameFormat', row.task_file_name_format ?? row.library_file_name_format),
      retryCount: numberValue('retryCount', row.retry_count) ?? 0,
      cleanupAt: numberValue('cleanupAt', row.cleanup_at),
      uploadConfirmedAt: row.upload_confirmed_at,
      recordOrigin: row.record_origin,
      calibrationStatus: row.calibration_status,
      calibratedAt: row.calibrated_at,
      qualitySatisfied: row.quality_satisfied == 1,
      stopQuality,
      createdAt: row.created_at,
    }
  })
}

export const clearSubscriptionHistory = (musicKey: string): number => {
  if (!getDB().prepare('SELECT 1 FROM subscription_library WHERE music_key = ?').get(musicKey)) throw new Error('歌曲不存在于订阅音乐库')
  return getDB().prepare('DELETE FROM subscription_history WHERE music_key = ?').run(musicKey).changes
}

export const requeueSubscriptionMusic = (musicKey: string): LX.Subscription.Task => {
  const db = getDB()
  const row = db.prepare(`${taskSelect} WHERE t.music_key = ?`).get(musicKey) as TaskRow | undefined
  if (!row) throw new Error('歌曲任务不存在')
  const current = toTask(row)
  if (['resolving', 'downloading', 'quality_check', 'tagging', 'uploading', 'upload_unconfirmed', 'old_version_cleanup', 'cleanup_wait'].includes(current.status)) {
    throw new Error('该歌曲正在处理中，不能重复加入队列')
  }
  if (current.status == 'calibration_unresolved') throw new Error('该歌曲仍有待人工确认的网盘记录')
  if (current.localPath) throw new Error('该歌曲仍保留本地成品，请在任务页面继续原任务或完成上传')
  if (current.existingCloudPath && !current.cloudQuality) throw new Error('该歌曲的云端音质尚未确认，请先完成扫描')
  const now = Date.now()
  db.transaction(() => {
    db.prepare(`
      UPDATE subscription_task SET
        status = 'pending', requested_quality = NULL, source_reported_quality = NULL,
        file_verified_quality = NULL, source_used = NULL, actual_source = NULL,
        actual_song_id = NULL, local_path = NULL, cloud_path = NULL,
        old_cloud_path = NULL, file_name_format = NULL, upload_started_at = NULL,
        progress = 0, speed = '', failure_reason = NULL, pause_origin = NULL,
        cleanup_at = NULL, download_completed_at = NULL, upload_completed_at = NULL,
        updated_at = ?
      WHERE music_key = ?
    `).run(now, musicKey)
    const next = toTask(db.prepare(`${taskSelect} WHERE t.music_key = ?`).get(musicKey) as TaskRow)
    db.prepare(`
      INSERT INTO subscription_history (task_id, music_key, status, message, snapshot, created_at)
      VALUES (?, ?, 'pending', '用户手动重新检查下载或音质升级', ?, ?)
    `).run(next.id, musicKey, JSON.stringify(toTaskHistorySnapshot(next)), now)
  })()
  return getSubscriptionTasks().find(task => task.musicKey == musicKey)!
}

const comparablePath = (input: string) => {
  const resolved = path.resolve(input).replace(/[\\/]+$/, '')
  return process.platform == 'win32' ? resolved.toLowerCase() : resolved
}

const isPathInScope = (rootPath: string, targetPath: string, recursive: boolean) => {
  const root = comparablePath(rootPath)
  const target = comparablePath(targetPath)
  return recursive ? target.startsWith(`${root}${path.sep}`) : comparablePath(path.dirname(target)) == root
}

export const importSubscriptionStructureValidation = (input: LX.Subscription.StructureValidationImport): LX.Subscription.StructureValidationSummary => {
  const rootPath = path.resolve(input.rootPath)
  const files = Array.from(new Set(input.files.map(filePath => path.resolve(filePath))))
  const fileKeys = new Set(files.map(comparablePath))
  const tracked = getDB().prepare(`
    SELECT music_key, cloud_path
    FROM subscription_library
    WHERE cloud_path IS NOT NULL AND cloud_path != ''
  `).all() as Array<{ music_key: string, cloud_path: string }>
  const scopedTracked = tracked.filter(item => isPathInScope(rootPath, item.cloud_path, input.recursive))
  const trackedByPath = new Map(scopedTracked.map(item => [comparablePath(item.cloud_path), item]))
  const missing = scopedTracked.filter(item => !fileKeys.has(comparablePath(item.cloud_path)))
  const untracked = files.filter(filePath => !trackedByPath.has(comparablePath(filePath)))
  const present = scopedTracked.length - missing.length
  const db = getDB()
  db.transaction(() => {
    db.prepare('DELETE FROM subscription_structure_issue').run()
    const insert = db.prepare(`
      INSERT INTO subscription_structure_issue (kind, file_path, music_key, scanned_at)
      VALUES (?, ?, ?, ?)
    `)
    for (const item of missing) insert.run('missing', path.resolve(item.cloud_path), item.music_key, input.scannedAt)
    for (const filePath of untracked) insert.run('untracked', filePath, null, input.scannedAt)
    db.prepare('UPDATE subscription_config SET structure_last_run_at = ?, updated_at = ? WHERE id = 1')
      .run(input.scannedAt, input.scannedAt)
  })()
  return { scanned: files.length, present, missing: missing.length, untracked: untracked.length, scannedAt: input.scannedAt }
}

export const getSubscriptionStructureValidationRecords = (): LX.Subscription.StructureValidationRecord[] => {
  const rows = getDB().prepare(`
    SELECT id, kind, file_path, music_key, scanned_at
    FROM subscription_structure_issue
    ORDER BY kind, file_path
  `).all() as Array<{
    id: number
    kind: LX.Subscription.StructureValidationRecord['kind']
    file_path: string
    music_key: string | null
    scanned_at: number
  }>
  return rows.map(row => ({
    id: row.id,
    kind: row.kind,
    filePath: row.file_path,
    musicKey: row.music_key,
    scannedAt: row.scanned_at,
  }))
}

export const backupSubscriptionDatabase = async(destination: string): Promise<LX.Subscription.BackupResult> => {
  const backupPath = path.resolve(destination)
  await getDB().backup(backupPath)
  const createdAt = Date.now()
  getDB().prepare('UPDATE subscription_config SET backup_last_at = ?, backup_last_path = ?, updated_at = ? WHERE id = 1')
    .run(createdAt, backupPath, createdAt)
  return { path: backupPath, createdAt }
}
