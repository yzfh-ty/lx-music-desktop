'use strict'
/**
 * i18n 完整性校验。
 *
 * 检查四件事：
 *   1. 三份语言文件的键集完全一致、按字典序排列（仓库原有约定）
 *   2. 代码里引用的每个 key 都真实存在
 *   3. 语言文件里没有从未被引用的订阅相关键（死键）
 *   4. 订阅页的源码里没有残留的硬编码中文
 *
 *   node --test test/i18n.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const langDir = path.join(repoRoot, 'src/lang')

const load = name => JSON.parse(fs.readFileSync(path.join(langDir, `${name}.json`), 'utf8'))
const zhCn = load('zh-cn')
const zhTw = load('zh-tw')
const enUs = load('en-us')

/** 订阅相关的源码文件 */
const sourceFiles = [
  'src/renderer/views/Subscription/index.vue',
  'src/renderer/views/Subscription/components/ListPicker.vue',
  'src/renderer/views/Setting/components/SettingSubscription.vue',
  'src/renderer/components/layout/Aside/NavBar.vue',
]
/**
 * 额外扫描 i18n key 引用、但不参与「硬编码中文」检查的文件。
 * store 里剩下的中文都是写进数据库的诊断信息（failure_reason），
 * 要国际化得先把存储格式从「文本」改成「key + 参数」，属于另一件事。
 */
const keySourceOnly = ['src/renderer/store/subscription/index.ts']
const readSource = f => fs.readFileSync(path.join(repoRoot, f), 'utf8')
const allSource = [...sourceFiles, ...keySourceOnly].map(readSource).join('\n')

/** 收集代码里 $t('x') / t('x') 形式引用的静态 key */
const referencedKeys = () => {
  const keys = new Set()
  for (const m of allSource.matchAll(/\$?\bt\(\s*'([a-z0-9_]+)'/g)) keys.add(m[1])
  for (const m of allSource.matchAll(/i18n\.t\(\s*'([a-z0-9_]+)'/g)) keys.add(m[1])
  return keys
}

/** 模板字符串拼出来的动态 key，需要按其取值范围展开 */
const dynamicKeys = () => {
  const keys = new Set()
  // statusText: `subscription__status_${status}`
  const statuses = [
    'discovered', 'calibrating', 'calibration_unresolved', 'pending', 'disk_paused',
    'resolving', 'downloading', 'downloaded', 'quality_check', 'tagging', 'uploading',
    'upload_unconfirmed', 'old_version_cleanup', 'cleanup_wait', 'uploaded', 'failed',
    'local_completed', 'quality_skipped',
  ]
  for (const s of statuses) keys.add(`subscription__status_${s}`)
  // sourceOptions: `source_${id}`
  for (const s of ['kw', 'kg', 'tx', 'wy', 'mg']) keys.add(`source_${s}`)
  return keys
}

// ------------------------------------------------------------ 语言文件本身

test('三份语言文件的键集完全一致', () => {
  const a = Object.keys(zhCn).sort()
  const b = Object.keys(zhTw).sort()
  const c = Object.keys(enUs).sort()
  assert.deepEqual(b, a, 'zh-tw 与 zh-cn 的键集不一致')
  assert.deepEqual(c, a, 'en-us 与 zh-cn 的键集不一致')
})

for (const [name, json] of [['zh-cn', zhCn], ['zh-tw', zhTw], ['en-us', enUs]]) {
  test(`${name}.json 的键按字典序排列`, () => {
    const keys = Object.keys(json)
    assert.deepEqual(keys, [...keys].sort(), '键顺序被打乱，会让后续 diff 很难读')
  })

  test(`${name}.json 没有空值`, () => {
    const empty = Object.keys(json).filter(k => typeof json[k] != 'string' || !json[k].trim())
    assert.deepEqual(empty, [], `存在空翻译: ${empty.join(', ')}`)
  })
}

test('同一个键在三种语言里的占位符集合一致', () => {
  const placeholders = value => (value.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort()
  const mismatched = []
  for (const key of Object.keys(zhCn)) {
    const cn = placeholders(zhCn[key])
    const tw = placeholders(zhTw[key])
    const en = placeholders(enUs[key])
    if (JSON.stringify(cn) != JSON.stringify(tw) || JSON.stringify(cn) != JSON.stringify(en)) {
      mismatched.push(`${key}: zh-cn=${cn} zh-tw=${tw} en-us=${en}`)
    }
  }
  assert.deepEqual(mismatched, [], `占位符不匹配会导致某些语言下变量丢失:\n${mismatched.join('\n')}`)
})

test('繁体文案没有残留简体特征字', () => {
  // 挑几个最容易漏掉的：这些字在繁体里必定写成另一个形态
  const simplifiedOnly = /[载设备网数据库间队际证质检验准]/
  const suspects = Object.keys(zhTw)
    .filter(k => k.startsWith('subscription'))
    .filter(k => simplifiedOnly.test(zhTw[k]))
  assert.deepEqual(suspects, [], `疑似未转换的繁体条目: ${suspects.join(', ')}`)
})

// ------------------------------------------------------------ 代码与键的对应

test('代码里引用的每个 i18n key 都存在', () => {
  const missing = [...referencedKeys(), ...dynamicKeys()].filter(k => zhCn[k] === undefined)
  assert.deepEqual(missing, [], `引用了不存在的 key: ${missing.join(', ')}`)
})

test('语言文件里没有从未被引用的订阅相关键', () => {
  const used = new Set([...referencedKeys(), ...dynamicKeys()])
  const orphans = Object.keys(zhCn).filter(k => k.startsWith('subscription') && !used.has(k))
  assert.deepEqual(orphans, [], `这些键没有任何地方在用: ${orphans.join(', ')}`)
})

// ------------------------------------------------------------ 硬编码残留

test('订阅页源码里没有残留的硬编码中文', () => {
  const CJK = /[一-龥]/
  const leftovers = []
  for (const file of sourceFiles) {
    readSource(file).split('\n').forEach((line, index) => {
      if (!CJK.test(line)) return
      const trimmed = line.trim()
      // 注释里的中文是给维护者看的，不算文案
      if (/^(\/\/|\/\*|\*)/.test(trimmed)) return
      leftovers.push(`${file}:${index + 1}  ${trimmed.slice(0, 80)}`)
    })
  }
  assert.deepEqual(leftovers, [], `以下位置还有硬编码中文:\n${leftovers.join('\n')}`)
})
