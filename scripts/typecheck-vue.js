'use strict'
/**
 * 对 <script lang="ts" setup> 的 .vue 文件做真实类型检查。
 *
 * 关键在于**忠实复刻 vue-loader 的模块拆分**：它把 <script setup> 和模板编译成
 * 两个独立的请求，`appendTsSuffixTo: [/\.vue$/]` 让两者都以 .ts 交给 ts-loader。
 * 因此模板模块**看不到 <script setup> 里的局部类型别名**——模板里的类型标注
 * 只能引用全局类型（例如 `declare namespace LX`）。
 *
 * 早先这个脚本用 inlineTemplate:true 把两者合成一个模块，结果放过了引用局部类型的
 * v-slot 标注，真实构建才报 TS2304。所以这里必须分开编译。
 *
 *   node scripts/typecheck-vue.js src/renderer/views/Subscription/index.vue [...]
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')

const repoRoot = path.resolve(__dirname, '..')
const workDir = path.join(repoRoot, '.typecheck-vue')

const files = process.argv.slice(2)
if (!files.length) {
  console.log('用法: node scripts/typecheck-vue.js <某个.vue> [更多.vue]')
  process.exit(1)
}

fs.rmSync(workDir, { recursive: true, force: true })
fs.mkdirSync(workDir, { recursive: true })

/** 生成的模块 -> 它来自哪个 .vue 的哪一部分 */
const generated = []

for (const [i, file] of files.entries()) {
  const abs = path.resolve(repoRoot, file)
  const descriptor = parse(fs.readFileSync(abs, 'utf8'), { filename: abs }).descriptor
  if (!descriptor.scriptSetup || descriptor.scriptSetup.lang != 'ts') {
    console.log(`跳过（不是 <script lang="ts" setup>）: ${file}`)
    continue
  }
  const base = `${path.basename(file, '.vue')}-${i}`
  const id = `data-v-${i}`

  // 1) 脚本模块：与 vue-loader 一致，不内联模板
  const script = compileScript(descriptor, { id, inlineTemplate: false })
  const scriptName = `${base}.script.vue.ts`
  fs.writeFileSync(path.join(workDir, scriptName), script.content)
  generated.push({ file, name: scriptName, part: '<script setup>' })

  // 2) 模板模块：独立编译，只拿得到 bindingMetadata，拿不到局部类型
  const template = compileTemplate({
    source: descriptor.template.content,
    filename: abs,
    id,
    compilerOptions: {
      bindingMetadata: script.bindings,
      expressionPlugins: ['typescript'],
      // 脚本是 TS 时 vue-loader 会带上这个，编译器才会给 _ctx / $event 等
      // 生成的参数补 `: any` 标注；不带的话会冒出一堆 TS7006 假阳性
      isTS: true,
    },
  })
  if (template.errors.length) {
    console.log(`模板编译失败: ${file}`)
    for (const err of template.errors) console.log('  ' + (err.message ?? err))
    process.exit(1)
  }
  const templateName = `${base}.template.vue.ts`
  fs.writeFileSync(path.join(workDir, templateName), template.code)
  generated.push({ file, name: templateName, part: '模板' })
}
if (!generated.length) process.exit(0)

const tsconfig = {
  compilerOptions: {
    target: 'ESNext',
    module: 'ESNext',
    moduleResolution: 'bundler',
    noEmit: true,
    skipLibCheck: true,
    // 真实构建里模板表达式多经 _ctx 代理（等价 any），不做空值分析；
    // 但 v-slot 的解构参数是显式绑定元素，仍会被 noImplicitAny 抓到——这正是要复现的那类错误。
    strict: false,
    noImplicitAny: true,
    allowJs: true, // 与仓库根 tsconfig 一致：允许引入没有声明文件的 .js 模块
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    baseUrl: repoRoot,
    paths: {
      '@root/*': ['src/*'],
      '@main/*': ['src/main/*'],
      '@renderer/*': ['src/renderer/*'],
      '@lyric/*': ['src/renderer-lyric/*'],
      '@static/*': ['src/static/*'],
      '@common/*': ['src/common/*'],
    },
    types: ['node'],
  },
  include: [
    ...generated.map(g => g.name),
    // tsconfig 的 include glob 里反斜杠会被当作转义符，必须用正斜杠；
    // tsconfig 在 .typecheck-vue/ 下，这里用相对路径
    '../src/**/*.d.ts',
  ],
}
fs.writeFileSync(path.join(workDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2))

let output = ''
let failed = false
try {
  execFileSync(process.execPath, [
    path.join(repoRoot, 'node_modules/typescript/bin/tsc'),
    '-p', path.join(workDir, 'tsconfig.json'),
  ], { stdio: 'pipe', cwd: repoRoot })
} catch (err) {
  output = `${err.stdout || ''}${err.stderr || ''}`
  failed = true
}

const lines = output.split('\n').filter(Boolean)
const own = lines.filter(l => generated.some(g => l.includes(g.name)))

if (own.length) {
  console.log(`发现 ${own.length} 个类型错误：\n`)
  for (const line of own) {
    const hit = generated.find(g => line.includes(g.name))
    console.log(`  [${hit.file} 的${hit.part}] ${line.replace(/^.*?\.vue\.ts/, '')}`)
  }
  process.exit(1)
}
console.log(`类型检查通过：${files.join(', ')}`)
if (failed && lines.length) console.log(`（另有 ${lines.length} 条来自其他文件的既有错误，未纳入本次检查）`)
