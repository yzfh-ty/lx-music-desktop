'use strict'
/**
 * 用 Node 22 内置的 node:sqlite 顶替 better-sqlite3。
 * 仓库里的 better_sqlite3.node 是 Windows/Electron 的二进制，在 Linux 下加载不了，
 * 但只要把 better-sqlite3 用到的那部分 API 对齐，就能让**真实的** dbService 模块跑起来，
 * 而不是在测试里另抄一份 SQL。
 */
const { DatabaseSync } = require('node:sqlite')

/** better-sqlite3 允许传入含有多余键的对象做具名绑定，node:sqlite 不允许，这里过滤一下 */
const namedParamsOf = (sql) => {
  const names = new Set()
  // 去掉字符串字面量，避免把 '@xxx' 之类的内容误当成参数
  const stripped = sql.replace(/'(?:[^']|'')*'/g, "''")
  for (const m of stripped.matchAll(/[@:$]([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1])
  return names
}

const normalizeValue = (value) => {
  if (value === undefined) return null
  if (typeof value == 'boolean') return value ? 1 : 0
  if (value === null || typeof value == 'number' || typeof value == 'string' || typeof value == 'bigint') return value
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value
  // better-sqlite3 遇到对象会抛错；这里同样拒绝，避免测试悄悄放过错误的绑定
  throw new TypeError(`无法绑定的参数类型: ${Object.prototype.toString.call(value)}`)
}

const bindArgs = (sql, args) => {
  if (args.length == 1 && args[0] != null && typeof args[0] == 'object' && !Array.isArray(args[0]) &&
      !Buffer.isBuffer(args[0]) && !(args[0] instanceof Uint8Array)) {
    const wanted = namedParamsOf(sql)
    const out = {}
    for (const [key, value] of Object.entries(args[0])) {
      if (!wanted.has(key)) continue // better-sqlite3 会忽略多余的键
      out[key] = normalizeValue(value)
    }
    return [out]
  }
  return args.map(normalizeValue)
}

class StatementWrapper {
  constructor(db, sql) {
    this.sql = sql
    this.stmt = db.prepare(sql)
    this._pluck = false
  }

  pluck(enabled = true) { this._pluck = enabled; return this }

  run(...args) {
    const result = this.stmt.run(...bindArgs(this.sql, args))
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
  }

  get(...args) {
    const row = this.stmt.get(...bindArgs(this.sql, args))
    if (row === undefined) return undefined
    return this._pluck ? Object.values(row)[0] : row
  }

  all(...args) {
    const rows = this.stmt.all(...bindArgs(this.sql, args))
    return this._pluck ? rows.map(r => Object.values(r)[0]) : rows
  }
}

class DatabaseWrapper {
  constructor(location = ':memory:') {
    this.db = new DatabaseSync(location)
    this.db.exec('PRAGMA foreign_keys = ON;')
  }

  prepare(sql) { return new StatementWrapper(this.db, sql) }
  exec(sql) { this.db.exec(sql); return this }
  pragma(sql) { try { this.db.exec(`PRAGMA ${sql};`) } catch { /* WAL 等在内存库上不适用 */ } return [] }
  close() { this.db.close() }

  transaction(fn) {
    return (...args) => {
      this.db.exec('BEGIN')
      try {
        const result = fn(...args)
        this.db.exec('COMMIT')
        return result
      } catch (err) {
        try { this.db.exec('ROLLBACK') } catch { /* ignore */ }
        throw err
      }
    }
  }
}

module.exports = { DatabaseWrapper }
