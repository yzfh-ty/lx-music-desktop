declare namespace LX {
  namespace Subscription {
    type Quality = '128k' | '320k' | 'flac' | 'flac24bit'
    type StopQuality = Quality | 'none'
    type ListType = 'board' | 'playlist'
    type PauseOrigin = 'manual' | 'disk'
    type TaskStatus = 'discovered'
    | 'calibrating'
    | 'calibration_unresolved'
    | 'pending'
    | 'disk_paused'
    | 'resolving'
    | 'downloading'
    | 'downloaded'
    | 'quality_check'
    | 'tagging'
    | 'uploading'
    | 'upload_unconfirmed'
    | 'old_version_cleanup'
    | 'cleanup_wait'
    | 'local_completed'
    | 'quality_skipped'
    | 'uploaded'
    | 'failed'

    interface Config {
      stopQuality: StopQuality
      cd2RootPath: string
      cd2GrpcUrl: string
      cd2ApiToken: string
      syncToCd2: boolean
      diskThresholdBytes: number
      diskLocked: boolean
      diskPausedAt: number | null
      calibrationRootPath: string
      calibrationRecursive: boolean
      calibrationIncludePaths: string[]
      calibrationExcludePaths: string[]
      calibrationCompletedAt: number | null
      structureRootPath: string
      structureRecursive: boolean
      structureIntervalMinutes: number | null
      structureLastRunAt: number | null
      backupIntervalMinutes: number | null
      backupLastAt: number | null
      backupLastPath: string
      createdAt: number
      updatedAt: number
    }

    interface ConfigUpdate {
      stopQuality?: StopQuality
      cd2RootPath?: string
      cd2GrpcUrl?: string
      cd2ApiToken?: string
      syncToCd2?: boolean
      diskThresholdBytes?: number
      diskLocked?: boolean
      diskPausedAt?: number | null
      calibrationRootPath?: string
      calibrationRecursive?: boolean
      calibrationIncludePaths?: string[]
      calibrationExcludePaths?: string[]
      calibrationCompletedAt?: number | null
      structureRootPath?: string
      structureRecursive?: boolean
      structureIntervalMinutes?: number | null
      structureLastRunAt?: number | null
      backupIntervalMinutes?: number | null
      backupLastAt?: number | null
      backupLastPath?: string
    }

    interface ListItem {
      id: string
      source: LX.OnlineSource
      listType: ListType
      listId: string
      name: string
      intervalMinutes: number | null
      enabled: boolean
      lastSyncAt: number | null
      nextSyncAt: number | null
      lastError: string | null
      createdAt: number
      updatedAt: number
    }

    interface ListCreate {
      source: LX.OnlineSource
      listType: ListType
      listId: string
      name: string
      intervalMinutes: number | null
    }

    interface ListUpdate {
      id: string
      name?: string
      intervalMinutes?: number | null
      enabled?: boolean
      lastSyncAt?: number | null
      nextSyncAt?: number | null
      lastError?: string | null
    }

    interface SyncTrack {
      id: string
      source: LX.OnlineSource
      name: string
      singer: string
      albumName?: string
      interval?: string | null
      duration?: number | null
      musicInfo: LX.Music.MusicInfoOnline
    }

    interface SyncInput {
      subscriptionId: string
      subscriptionName?: string
      tracks: SyncTrack[]
      syncedAt: number
    }

    interface SyncResult {
      discovered: number
      queued: number
      skipped: number
      total: number
    }

    interface Task {
      id: string
      musicKey: string
      subscriptionId: string | null
      source: LX.OnlineSource
      songId: string
      name: string
      singer: string
      albumName: string
      duration: number | null
      status: TaskStatus
      requestedQuality: Quality | null
      sourceReportedQuality: Quality | null
      fileVerifiedQuality: Quality | null
      cloudQuality: Quality | null
      sourceUsed: string | null
      actualSource: string | null
      actualSongId: string | null
      localPath: string | null
      existingCloudPath: string | null
      cloudPath: string | null
      oldCloudPath: string | null
      fileNameFormat: string | null
      uploadStartedAt: number | null
      progress: number
      speed: string
      failureReason: string | null
      pauseOrigin: PauseOrigin | null
      retryCount: number
      cleanupAt: number | null
      discoveredAt: number
      downloadCompletedAt: number | null
      uploadCompletedAt: number | null
      createdAt: number
      updatedAt: number
      musicInfo: LX.Music.MusicInfoOnline
    }

    interface TaskUpdate extends Partial<Omit<Task, 'id' | 'musicKey' | 'source' | 'songId' | 'createdAt' | 'musicInfo'>> {
      id: string
    }

    interface Dashboard {
      subscriptionCount: number
      pendingCount: number
      downloadingCount: number
      uploadingCount: number
      unconfirmedCount: number
      failedCount: number
      cleanupCount: number
      libraryCount: number
      lastSyncAt: number | null
      diskLocked: boolean
    }

    interface AudioInspection {
      codec: string
      container: string
      extension: LX.Download.FileExt | null
      bitrate: number | null
      sampleRate: number | null
      bitDepth: number | null
      duration: number | null
      quality: Quality | null
    }

    interface DiskInfo {
      path: string
      freeBytes: number
      totalBytes: number
      overlapsCd2Root: boolean
    }

    interface Cd2CopyResult {
      cloudPath: string
      oldCloudPath: string | null
      expectedDestPath: string
      copiedAt: number
    }

    interface Cd2UploadStatus {
      /**
       * running: CloudDrive2 传输任务仍在进行
       * success: CloudDrive2 已明确确认上传成功
       * failed: CloudDrive2 明确报告传输任务失败
       * unconfirmed: 暂时无法取得明确结论（未关联到传输任务、多任务冲突、gRPC 不可用等），
       *              既不能当作成功启动延迟清理，也不能当作失败要求重新下载
       */
      state: 'unconfirmed' | 'running' | 'success' | 'failed'
      progress: number
      message: string
      /** 结论是否由云端文件校验而非传输任务列表得出 */
      verifiedByCloudFile?: boolean
    }

    interface Cd2Health {
      rootPath: string
      mountPath: string
      sourceDir: string
      writable: boolean
    }

    interface CalibrationScanInput {
      rootPath: string
      recursive: boolean
      includePaths: string[]
      excludePaths: string[]
    }

    interface CalibrationFile {
      filePath: string
      title: string
      artist: string
      duration: number | null
      quality: Quality | null
      error: string | null
    }

    interface CalibrationRecord extends CalibrationFile {
      id: number
      status: 'matched' | 'unresolved' | 'failed'
      candidateMusicKeys: string[]
      scannedAt: number
      confirmedAt: number | null
    }

    interface CalibrationSummary {
      scanned: number
      matched: number
      unresolved: number
      failed: number
    }

    interface CalibrationRun {
      status: 'collecting' | 'running' | 'failed' | 'completed'
      input: CalibrationScanInput
      total: number
      completed: number
      currentFile: string
      matched: number
      unresolved: number
      failed: number
      error: string | null
      startedAt: number
      updatedAt: number
    }

    interface CalibrationConfirmInput {
      recordId: number
      musicKey: string
    }

    interface StructureValidationInput {
      rootPath: string
      recursive: boolean
    }

    interface StructureValidationImport extends StructureValidationInput {
      files: string[]
      scannedAt: number
    }

    interface StructureValidationRecord {
      id: number
      kind: 'missing' | 'untracked'
      filePath: string
      musicKey: string | null
      scannedAt: number
    }

    interface StructureValidationSummary {
      scanned: number
      present: number
      missing: number
      untracked: number
      scannedAt: number
    }

    interface BackupResult {
      path: string
      createdAt: number
    }

    interface ManualSyncParams {
      musicKey: string
      localPath: string
      fileName: string
      quality: Quality
      deleteLocal: boolean
    }

    interface ManualSyncResult {
      confirmed: boolean
      skipped: boolean
      cleaned: boolean
    }

    interface HistoryItem {
      id: number
      taskId: string
      musicKey: string
      name: string
      singer: string
      albumName: string
      duration: number | null
      source: LX.OnlineSource
      status: TaskStatus
      message: string | null
      snapshot: Record<string, unknown> | null
      requestedQuality: Quality | null
      sourceReportedQuality: Quality | null
      fileVerifiedQuality: Quality | null
      cloudQuality: Quality | null
      sourceUsed: string | null
      actualSource: string | null
      actualSongId: string | null
      localPath: string | null
      cloudPath: string | null
      oldCloudPath: string | null
      fileNameFormat: string | null
      retryCount: number
      cleanupAt: number | null
      uploadConfirmedAt: number | null
      recordOrigin: 'discovered' | 'calibrated' | 'uploaded'
      calibrationStatus: string | null
      calibratedAt: number | null
      qualitySatisfied: boolean
      stopQuality: StopQuality | null
      createdAt: number
    }
  }
}
