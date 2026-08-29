'use strict'
// 顶替 src/main/worker/dbService/db.ts，让真实的 subscription 模块跑在 node:sqlite 上
const { DatabaseWrapper } = require('../helpers/sqlite-adapter')

let db = null
const initTestDB = (schemaSql) => {
  db = new DatabaseWrapper(':memory:')
  db.exec(schemaSql)
  return db
}
const getDB = () => db
const closeTestDB = () => { if (db) { db.close(); db = null } }

module.exports = { getDB, initTestDB, closeTestDB, init: () => true }
