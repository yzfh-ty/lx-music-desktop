// export const sql = `
//   CREATE TABLE "db_info" (
//     "id" INTEGER NOT NULL UNIQUE,
//     "field_name" TEXT,
//     "field_value" TEXT,
//     PRIMARY KEY("id" AUTOINCREMENT)
//   );

//   CREATE TABLE "my_list" (
//     "id" TEXT NOT NULL,
//     "name" TEXT NOT NULL,
//     "source" TEXT,
//     "sourceListId" TEXT,
//     "position" INTEGER NOT NULL,
//     "locationUpdateTime" INTEGER,
//     PRIMARY KEY("id")
//   );

//   CREATE TABLE "my_list_music_info" (
//     "id" TEXT NOT NULL,
//     "listId" TEXT NOT NULL,
//     "name" TEXT NOT NULL,
//     "singer" TEXT NOT NULL,
//     "source" TEXT NOT NULL,
//     "interval" TEXT,
//     "meta" TEXT NOT NULL,
//     UNIQUE("id","listId")
//   );
//   CREATE INDEX "index_my_list_music_info" ON "my_list_music_info" (
//     "id",
//     "listId"
//   );

//   CREATE TABLE "my_list_music_info_order" (
//     "listId" TEXT NOT NULL,
//     "musicInfoId" TEXT NOT NULL,
//     "order" INTEGER NOT NULL
//   );
//   CREATE INDEX "index_my_list_music_info_order" ON "my_list_music_info_order" (
//     "listId",
//     "musicInfoId"
//   );

//   CREATE TABLE "music_info_other_source" (
//     "source_id" TEXT NOT NULL,
//     "id" TEXT NOT NULL,
//     "source" TEXT NOT NULL,
//     "name" TEXT NOT NULL,
//     "singer" TEXT NOT NULL,
//     "meta" TEXT NOT NULL,
//     "order" INTEGER NOT NULL,
//     UNIQUE("source_id","id")
//   );
//   CREATE INDEX "index_music_info_other_source" ON "music_info_other_source" (
//     "source_id",
//     "id"
//   );

//   -- TODO  "meta" TEXT NOT NULL,
//   CREATE TABLE "lyric" (
//     "id" TEXT NOT NULL,
//     "source" TEXT NOT NULL,
//     "type" TEXT NOT NULL,
//     "text" TEXT NOT NULL
//   );

//   CREATE TABLE "music_url" (
//     "id" TEXT NOT NULL,
//     "url" TEXT NOT NULL
//   );

//   CREATE TABLE "download_list" (
//     "id" TEXT NOT NULL,
//     "isComplate" INTEGER NOT NULL,
//     "status" TEXT NOT NULL,
//     "statusText" TEXT NOT NULL,
//     "progress_downloaded" INTEGER NOT NULL,
//     "progress_total" INTEGER NOT NULL,
//     "url" TEXT,
//     "quality" TEXT NOT NULL,
//     "ext" TEXT NOT NULL,
//     "fileName" TEXT NOT NULL,
//     "filePath" TEXT NOT NULL,
//     "musicInfo" TEXT NOT NULL,
//     "position" INTEGER NOT NULL,
//     PRIMARY KEY("id")
//   );
// `

// export const tables = [
//   'table_db_info',
//   'table_my_list',
//   'table_my_list_music_info',
//   'index_index_my_list_music_info',
//   'table_my_list_music_info_order',
//   'index_index_my_list_music_info_order',
//   'table_music_info_other_source',
//   'index_index_music_info_other_source',
//   'table_lyric',
//   'table_music_url',
//   'table_download_list',
// ]

type Tables = 'db_info'
| 'my_list'
| 'my_list_music_info'
| 'index_my_list_music_info'
| 'my_list_music_info_order'
| 'index_my_list_music_info_order'
| 'music_info_other_source'
| 'index_music_info_other_source'
| 'lyric'
| 'music_url'
| 'download_list'
| 'dislike_list'
| 'subscription_config'
| 'subscription_list'
| 'index_subscription_list_due'
| 'subscription_library'
| 'subscription_music'
| 'index_subscription_music_key'
| 'subscription_task'
| 'index_subscription_task_status'
| 'subscription_history'
| 'index_subscription_history_music_key'
| 'subscription_calibration'
| 'index_subscription_calibration_status'

const tables = new Map<Tables, string>()


tables.set('db_info', `
  CREATE TABLE "db_info" (
    "id" INTEGER NOT NULL UNIQUE,
    "field_name" TEXT,
    "field_value" TEXT,
    PRIMARY KEY("id" AUTOINCREMENT)
  );
`)
tables.set('my_list', `
  CREATE TABLE "my_list" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT,
    "sourceListId" TEXT,
    "position" INTEGER NOT NULL,
    "locationUpdateTime" INTEGER,
    PRIMARY KEY("id")
  );
`)
tables.set('my_list_music_info', `
  CREATE TABLE "my_list_music_info" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "singer" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "interval" TEXT,
    "meta" TEXT NOT NULL,
    UNIQUE("id","listId")
  );
`)
tables.set('index_my_list_music_info', `
  CREATE INDEX "index_my_list_music_info" ON "my_list_music_info" (
    "id",
    "listId"
  );
`)
tables.set('my_list_music_info_order', `
  CREATE TABLE "my_list_music_info_order" (
    "listId" TEXT NOT NULL,
    "musicInfoId" TEXT NOT NULL,
    "order" INTEGER NOT NULL
  );
`)
tables.set('index_my_list_music_info_order', `
  CREATE INDEX "index_my_list_music_info_order" ON "my_list_music_info_order" (
    "listId",
    "musicInfoId"
  );
`)
tables.set('music_info_other_source', `
  CREATE TABLE "music_info_other_source" (
    "source_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "singer" TEXT NOT NULL,
    "meta" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    UNIQUE("source_id","id")
  );
`)
tables.set('index_music_info_other_source', `
  CREATE INDEX "index_music_info_other_source" ON "music_info_other_source" (
    "source_id",
    "id"
  );
`)
tables.set('lyric', `
  -- TODO  "meta" TEXT NOT NULL,
  CREATE TABLE "lyric" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL
  );
`)
tables.set('music_url', `
  CREATE TABLE "music_url" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL
  );
`)
tables.set('download_list', `
  CREATE TABLE "download_list" (
    "id" TEXT NOT NULL,
    "isComplate" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "statusText" TEXT NOT NULL,
    "progress_downloaded" INTEGER NOT NULL,
    "progress_total" INTEGER NOT NULL,
    "url" TEXT,
    "quality" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "musicInfo" TEXT NOT NULL,
    "subscriptionTaskId" TEXT,
    "position" INTEGER NOT NULL,
    PRIMARY KEY("id")
  );
`)
tables.set('dislike_list', `
  CREATE TABLE "dislike_list" (
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" TEXT
  );
`)

tables.set('subscription_config', `
  CREATE TABLE "subscription_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "stop_quality" TEXT NOT NULL DEFAULT 'flac',
    "cd2_root_path" TEXT NOT NULL DEFAULT '',
    "cd2_grpc_url" TEXT NOT NULL DEFAULT '',
    "cd2_api_token" TEXT NOT NULL DEFAULT '',
    "sync_to_cd2" INTEGER NOT NULL DEFAULT 1,
    "disk_threshold_bytes" INTEGER NOT NULL DEFAULT 32212254720,
    "disk_locked" INTEGER NOT NULL DEFAULT 0,
    "disk_paused_at" INTEGER,
    "calibration_root_path" TEXT NOT NULL DEFAULT '',
    "calibration_recursive" INTEGER NOT NULL DEFAULT 1,
    "calibration_include_paths" TEXT NOT NULL DEFAULT '[]',
    "calibration_exclude_paths" TEXT NOT NULL DEFAULT '[]',
    "calibration_completed_at" INTEGER,
    "created_at" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL,
    PRIMARY KEY("id"),
    CHECK("id" = 1)
  );
`)
tables.set('subscription_list', `
  CREATE TABLE "subscription_list" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "list_type" TEXT NOT NULL DEFAULT 'playlist',
    "list_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "interval_minutes" INTEGER,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "last_sync_at" INTEGER,
    "next_sync_at" INTEGER,
    "last_error" TEXT,
    "created_at" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL,
    PRIMARY KEY("id"),
    UNIQUE("source", "list_type", "list_id")
  );
`)
tables.set('index_subscription_list_due', `
  CREATE INDEX "index_subscription_list_due" ON "subscription_list" (
    "enabled",
    "next_sync_at"
  );
`)
tables.set('subscription_library', `
  CREATE TABLE "subscription_library" (
    "music_key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "song_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "singer" TEXT NOT NULL,
    "album_name" TEXT NOT NULL DEFAULT '',
    "duration" INTEGER,
    "music_info" TEXT NOT NULL,
    "cloud_quality" TEXT,
    "cloud_path" TEXT,
    "file_name_format" TEXT,
    "upload_confirmed_at" INTEGER,
    "record_origin" TEXT NOT NULL DEFAULT 'discovered',
    "calibration_status" TEXT,
    "calibrated_at" INTEGER,
    "quality_satisfied" INTEGER NOT NULL DEFAULT 0,
    "created_at" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL,
    PRIMARY KEY("music_key")
  );
`)
tables.set('subscription_music', `
  CREATE TABLE "subscription_music" (
    "subscription_id" TEXT NOT NULL,
    "music_key" TEXT NOT NULL,
    "first_seen_at" INTEGER NOT NULL,
    "last_seen_at" INTEGER NOT NULL,
    PRIMARY KEY("subscription_id", "music_key")
  );
`)
tables.set('index_subscription_music_key', `
  CREATE INDEX "index_subscription_music_key" ON "subscription_music" (
    "music_key"
  );
`)
tables.set('subscription_task', `
  CREATE TABLE "subscription_task" (
    "id" TEXT NOT NULL,
    "music_key" TEXT NOT NULL,
    "subscription_id" TEXT,
    "status" TEXT NOT NULL,
    "requested_quality" TEXT,
    "source_reported_quality" TEXT,
    "file_verified_quality" TEXT,
    "source_used" TEXT,
    "actual_source" TEXT,
    "actual_song_id" TEXT,
    "local_path" TEXT,
    "cloud_path" TEXT,
    "old_cloud_path" TEXT,
    "file_name_format" TEXT,
    "upload_started_at" INTEGER,
    "progress" REAL NOT NULL DEFAULT 0,
    "speed" TEXT NOT NULL DEFAULT '',
    "failure_reason" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "cleanup_at" INTEGER,
    "discovered_at" INTEGER NOT NULL,
    "download_completed_at" INTEGER,
    "upload_completed_at" INTEGER,
    "created_at" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL,
    PRIMARY KEY("id"),
    UNIQUE("music_key")
  );
`)
tables.set('index_subscription_task_status', `
  CREATE INDEX "index_subscription_task_status" ON "subscription_task" (
    "status",
    "updated_at"
  );
`)
tables.set('subscription_history', `
  CREATE TABLE "subscription_history" (
    "id" INTEGER NOT NULL UNIQUE,
    "task_id" TEXT NOT NULL,
    "music_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "snapshot" TEXT,
    "created_at" INTEGER NOT NULL,
    PRIMARY KEY("id" AUTOINCREMENT)
  );
`)
tables.set('index_subscription_history_music_key', `
  CREATE INDEX "index_subscription_history_music_key" ON "subscription_history" (
    "music_key",
    "created_at"
  );
`)
tables.set('subscription_calibration', `
  CREATE TABLE "subscription_calibration" (
    "id" INTEGER NOT NULL UNIQUE,
    "file_path" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "artist" TEXT NOT NULL DEFAULT '',
    "duration" REAL,
    "quality" TEXT,
    "status" TEXT NOT NULL,
    "candidate_music_keys" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "scanned_at" INTEGER NOT NULL,
    "confirmed_at" INTEGER,
    PRIMARY KEY("id" AUTOINCREMENT),
    UNIQUE("file_path")
  );
`)
tables.set('index_subscription_calibration_status', `
  CREATE INDEX "index_subscription_calibration_status" ON "subscription_calibration" (
    "status",
    "scanned_at"
  );
`)

export default tables

export const DB_VERSION = '9'
