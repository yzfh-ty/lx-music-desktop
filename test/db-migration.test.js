'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { compileOnce, buildDir } = require('./helpers/compile')
const { DatabaseWrapper } = require('./helpers/sqlite-adapter')

compileOnce()
const tablesModule = require(path.join(buildDir, 'main/worker/dbService/tables.js'))
const migrateModule = require(path.join(buildDir, 'main/worker/dbService/migrate.js'))
const tables = tablesModule.default ?? tablesModule.tables
const migrate = migrateModule.default ?? migrateModule

test('v12 数据库升级后补齐 Docker 路径映射字段并保留旧配置', () => {
  const db = new DatabaseWrapper(':memory:')
  const oldTables = Array.from(tables.entries()).map(([name, sql]) => {
    if (name != 'subscription_config') return sql
    return sql
      .replace('    "cd2_local_mount_path" TEXT NOT NULL DEFAULT \'\',\n', '')
      .replace('    "cd2_api_mount_point" TEXT NOT NULL DEFAULT \'\',\n', '')
  }).join('\n')
  db.exec(`${oldTables}\nINSERT INTO db_info (field_name, field_value) VALUES ('version', '12');`)
  const now = Date.now()
  db.prepare(`
    INSERT INTO subscription_config (id, cd2_root_path, cd2_grpc_url, cd2_api_token, created_at, updated_at)
    VALUES (1, '/home/yzfh/CloudNAS/music', 'http://127.0.0.1:19798', 'token', ?, ?)
  `).run(now, now)

  migrate(db)

  const row = db.prepare(`
    SELECT cd2_root_path, cd2_local_mount_path, cd2_api_mount_point
    FROM subscription_config WHERE id = 1
  `).get()
  assert.deepEqual({ ...row }, {
    cd2_root_path: '/home/yzfh/CloudNAS/music',
    cd2_local_mount_path: '',
    cd2_api_mount_point: '',
  })
  assert.equal(db.prepare("SELECT field_value FROM db_info WHERE field_name = 'version'").pluck().get(), '13')
  db.close()
})
