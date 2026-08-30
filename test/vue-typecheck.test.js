'use strict'
/**
 * .vue 类型检查回归。
 *
 * 起因：订阅页改成 <script lang="ts" setup> 之后，模板里 `v-slot="{ item, index }"`
 * 的解构参数在 noImplicitAny 下报 TS7031，但当时的检查只验证了模板能否**解析**，
 * 没验证能否**通过类型检查**，于是漏到了真实构建才暴露。
 *
 * 这里调用 scripts/typecheck-vue.js，按 vue-loader 的方式生成 `<name>.vue.ts` 再跑 tsc。
 *
 *   node --test test/vue-typecheck.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')

/** 本分支新增/重做的、使用 <script lang="ts" setup> 的组件 */
const files = [
  'src/renderer/views/Setting/components/SettingSubscription.vue',
  'src/renderer/views/Subscription/index.vue',
  'src/renderer/views/Subscription/components/ListPicker.vue',
]

test('订阅页的 .vue 文件能通过类型检查', () => {
  let output = ''
  let failed = false
  try {
    output = execFileSync(process.execPath, [
      path.join(repoRoot, 'scripts/typecheck-vue.js'),
      ...files,
    ], { cwd: repoRoot, encoding: 'utf8' })
  } catch (err) {
    output = `${err.stdout || ''}${err.stderr || ''}`
    failed = true
  }
  assert.equal(failed, false, `类型检查未通过:\n${output}`)
  assert.match(output, /类型检查通过/)
})
