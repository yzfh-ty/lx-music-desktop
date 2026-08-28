import type Database from 'better-sqlite3'
import tables, { DB_VERSION } from './tables'

// const migrateV1 = (db: Database.Database) => {
//   const sql = `
//     DROP TABLE "main"."download_list";

//     CREATE TABLE "download_list" (
//       "id" TEXT NOT NULL,
//       "isComplate" INTEGER NOT NULL,
//       "status" TEXT NOT NULL,
//       "statusText" TEXT NOT NULL,
//       "progress_downloaded" INTEGER NOT NULL,
//       "progress_total" INTEGER NOT NULL,
//       "url" TEXT,
//       "quality" TEXT NOT NULL,
//       "ext" TEXT NOT NULL,
//       "fileName" TEXT NOT NULL,
//       "filePath" TEXT NOT NULL,
//       "musicInfo" TEXT NOT NULL,
//       "position" INTEGER NOT NULL,
//       PRIMARY KEY("id")
//     );
//   `
//   db.exec(sql)
//   db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: '2' })
// }

const migrateV1 = (db: Database.Database) => {
  // 修复 v2.4.0 的默认数据库版本号不对的问题
  const existsTable = db.prepare('SELECT name FROM "main".sqlite_master WHERE type=\'table\' AND name=\'dislike_list\';').get()
  if (!existsTable) {
    const sql = tables.get('dislike_list')!
    db.exec(sql)
  }
}

const migrateV2 = (db: Database.Database) => {
  const names = [
    'subscription_config',
    'subscription_list',
    'index_subscription_list_due',
    'subscription_library',
    'subscription_music',
    'index_subscription_music_key',
    'subscription_task',
    'index_subscription_task_status',
    'subscription_history',
    'index_subscription_history_music_key',
  ] as const
  db.exec(names.map(name => tables.get(name)!).join('\n'))
}

const migrateV3 = (db: Database.Database) => {
  const columns = db.prepare('PRAGMA table_info(subscription_config)').all() as Array<{ name: string }>
  const syncValue = columns.some(column => column.name == 'sync_to_cd2') ? 'sync_to_cd2' : '1'
  db.transaction(() => {
    db.exec('ALTER TABLE subscription_config RENAME TO subscription_config_v3;')
    db.exec(tables.get('subscription_config')!)
    db.exec(`
      INSERT INTO subscription_config (
        id, stop_quality, cd2_root_path, cd2_grpc_url, cd2_api_token,
        sync_to_cd2, disk_threshold_bytes, disk_locked, disk_paused_at,
        calibration_completed_at, created_at, updated_at
      )
      SELECT
        id, stop_quality, cd2_root_path, cd2_grpc_url, cd2_api_token,
        ${syncValue}, disk_threshold_bytes, disk_locked, disk_paused_at,
        calibration_completed_at, created_at, updated_at
      FROM subscription_config_v3;
      DROP TABLE subscription_config_v3;
    `)
  })()
}

const migrateV4 = (db: Database.Database) => {
  db.transaction(() => {
    db.exec('ALTER TABLE download_list RENAME TO download_list_v4;')
    db.exec(tables.get('download_list')!)
    db.exec(`
      INSERT INTO download_list (
        id, isComplate, status, statusText, progress_downloaded, progress_total,
        url, quality, ext, fileName, filePath, musicInfo, subscriptionTaskId, position
      )
      SELECT
        id, isComplate, status, statusText, progress_downloaded, progress_total,
        url, quality, ext, fileName, filePath, musicInfo, NULL, position
      FROM download_list_v4;
      DROP TABLE download_list_v4;
    `)
  })()
}

const migrateV5 = (db: Database.Database) => {
  db.transaction(() => {
    db.exec('DROP INDEX index_subscription_task_status;')
    db.exec('ALTER TABLE subscription_task RENAME TO subscription_task_v6;')
    db.exec(tables.get('subscription_task')!)
    db.exec(tables.get('index_subscription_task_status')!)
    db.exec(`
      INSERT INTO subscription_task (
        id, music_key, subscription_id, status, requested_quality,
        source_reported_quality, file_verified_quality, source_used,
        actual_source, actual_song_id, local_path, cloud_path, old_cloud_path,
        file_name_format, upload_started_at, progress, speed, failure_reason,
        retry_count, cleanup_at, discovered_at, download_completed_at,
        upload_completed_at, created_at, updated_at
      )
      SELECT
        id, music_key, subscription_id, status, requested_quality,
        source_reported_quality, file_verified_quality, source_used,
        actual_source, actual_song_id, local_path, cloud_path, old_cloud_path,
        NULL, NULL, progress, speed, failure_reason, retry_count, cleanup_at,
        discovered_at, download_completed_at, upload_completed_at, created_at, updated_at
      FROM subscription_task_v6;
      DROP TABLE subscription_task_v6;
    `)
  })()
}

const migrateV6 = (db: Database.Database) => {
  db.exec(`${tables.get('subscription_calibration')!}\n${tables.get('index_subscription_calibration_status')!}`)
}

const migrateV7 = (db: Database.Database) => {
  db.transaction(() => {
    db.exec('ALTER TABLE subscription_config RENAME TO subscription_config_v8;')
    db.exec(tables.get('subscription_config')!)
    db.exec(`
      INSERT INTO subscription_config (
        id, stop_quality, cd2_root_path, cd2_grpc_url, cd2_api_token,
        sync_to_cd2, disk_threshold_bytes, disk_locked, disk_paused_at,
        calibration_root_path, calibration_recursive,
        calibration_include_paths, calibration_exclude_paths,
        calibration_completed_at, created_at, updated_at
      )
      SELECT
        id, stop_quality, cd2_root_path, cd2_grpc_url, cd2_api_token,
        sync_to_cd2, disk_threshold_bytes, disk_locked, disk_paused_at,
        '', 1, '[]', '[]', calibration_completed_at, created_at, updated_at
      FROM subscription_config_v8;
      DROP TABLE subscription_config_v8;
    `)
  })()
}

const migrateV8 = (db: Database.Database) => {
  db.transaction(() => {
    db.exec('DROP INDEX index_subscription_list_due;')
    db.exec('ALTER TABLE subscription_list RENAME TO subscription_list_v9;')
    db.exec(tables.get('subscription_list')!)
    db.exec(tables.get('index_subscription_list_due')!)
    db.exec(`
      INSERT INTO subscription_list (
        id, source, list_type, list_id, name, interval_minutes, enabled,
        last_sync_at, next_sync_at, last_error, created_at, updated_at
      )
      SELECT id, source, 'playlist', list_id, name, interval_minutes, enabled,
        last_sync_at, next_sync_at, last_error, created_at, updated_at
      FROM subscription_list_v9;
      DROP TABLE subscription_list_v9;
    `)
  })()
}

const migrateV9 = (db: Database.Database) => {
  const columns = db.prepare('PRAGMA table_info(subscription_config)').all() as Array<{ name: string }>
  db.transaction(() => {
    if (!columns.some(column => column.name == 'backup_last_path')) {
      db.exec('ALTER TABLE subscription_config RENAME TO subscription_config_v10;')
      db.exec(tables.get('subscription_config')!)
      db.exec(`
        INSERT INTO subscription_config (
          id, stop_quality, cd2_root_path, cd2_grpc_url, cd2_api_token,
          sync_to_cd2, disk_threshold_bytes, disk_locked, disk_paused_at,
          calibration_root_path, calibration_recursive,
          calibration_include_paths, calibration_exclude_paths,
          calibration_completed_at, created_at, updated_at
        )
        SELECT
          id, stop_quality, cd2_root_path, cd2_grpc_url, cd2_api_token,
          sync_to_cd2, disk_threshold_bytes, disk_locked, disk_paused_at,
          calibration_root_path, calibration_recursive,
          calibration_include_paths, calibration_exclude_paths,
          calibration_completed_at, created_at, updated_at
        FROM subscription_config_v10;
        DROP TABLE subscription_config_v10;
      `)
    }
    db.exec(`${tables.get('subscription_structure_issue')!}\n${tables.get('index_subscription_structure_issue_kind')!}`)
  })()
}

const migrateV10 = (db: Database.Database) => {
  const columns = db.prepare('PRAGMA table_info(subscription_task)').all() as Array<{ name: string }>
  db.transaction(() => {
    if (!columns.some(column => column.name == 'pause_origin')) {
      db.exec('DROP INDEX index_subscription_task_status;')
      db.exec('ALTER TABLE subscription_task RENAME TO subscription_task_v11;')
      db.exec(tables.get('subscription_task')!)
      db.exec(tables.get('index_subscription_task_status')!)
      db.exec(`
        INSERT INTO subscription_task (
          id, music_key, subscription_id, status, requested_quality,
          source_reported_quality, file_verified_quality, source_used,
          actual_source, actual_song_id, local_path, cloud_path, old_cloud_path,
          file_name_format, upload_started_at, progress, speed, failure_reason,
          pause_origin, retry_count, cleanup_at, discovered_at,
          download_completed_at, upload_completed_at, created_at, updated_at
        )
        SELECT
          id, music_key, subscription_id, status, requested_quality,
          source_reported_quality, file_verified_quality, source_used,
          actual_source, actual_song_id, local_path, cloud_path, old_cloud_path,
          file_name_format, upload_started_at, progress, speed, failure_reason,
          CASE WHEN status = 'disk_paused' AND EXISTS (
            SELECT 1 FROM subscription_config WHERE id = 1 AND disk_locked = 1
          ) THEN 'disk' WHEN status = 'disk_paused' THEN 'manual' ELSE NULL END,
          retry_count, cleanup_at, discovered_at, download_completed_at,
          upload_completed_at, created_at, updated_at
        FROM subscription_task_v11;
        DROP TABLE subscription_task_v11;
      `)
    }
    db.prepare('UPDATE subscription_config SET backup_interval_minutes = 1440 WHERE backup_interval_minutes IS NULL').run()
  })()
}

const migrateV11 = (db: Database.Database) => {
  db.exec([
    tables.get('subscription_calibration_run')!,
    tables.get('subscription_calibration_run_file')!,
    tables.get('index_subscription_calibration_run_file_state')!,
  ].join('\n'))
}

export default (db: Database.Database) => {
  // PRAGMA user_version = x
  // console.log(db.prepare('PRAGMA user_version').get().user_version)
  // https://github.com/WiseLibs/better-sqlite3/issues/668#issuecomment-1145285728
  const version = (db.prepare<[string]>('SELECT "field_value" FROM "main"."db_info" WHERE "field_name" = ?').get('version') as { field_value: string }).field_value
  switch (version) {
    case '1':
      migrateV1(db)
      migrateV2(db)
      migrateV4(db)
      migrateV5(db)
      migrateV6(db)
      migrateV7(db)
      migrateV8(db)
      migrateV9(db)
      migrateV10(db)
      migrateV11(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
    case '2':
      migrateV2(db)
      migrateV4(db)
      migrateV5(db)
      migrateV6(db)
      migrateV7(db)
      migrateV8(db)
      migrateV9(db)
      migrateV10(db)
      migrateV11(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
    case '3':
      migrateV3(db)
      migrateV4(db)
      migrateV5(db)
      migrateV6(db)
      migrateV7(db)
      migrateV8(db)
      migrateV9(db)
      migrateV10(db)
      migrateV11(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
    case '4':
      migrateV4(db)
      migrateV5(db)
      migrateV6(db)
      migrateV7(db)
      migrateV8(db)
      migrateV9(db)
      migrateV10(db)
      migrateV11(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
    case '5':
      migrateV5(db)
      migrateV6(db)
      migrateV7(db)
      migrateV8(db)
      migrateV9(db)
      migrateV10(db)
      migrateV11(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
    case '6':
      migrateV6(db)
      migrateV7(db)
      migrateV8(db)
      migrateV9(db)
      migrateV10(db)
      migrateV11(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
    case '7':
      migrateV7(db)
      migrateV8(db)
      migrateV9(db)
      migrateV10(db)
      migrateV11(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
    case '8':
      migrateV8(db)
      migrateV9(db)
      migrateV10(db)
      migrateV11(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
    case '9':
      migrateV9(db)
      migrateV10(db)
      migrateV11(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
    case '10':
      migrateV10(db)
      migrateV11(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
    case '11':
      migrateV11(db)
      db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
      break
  }
}
