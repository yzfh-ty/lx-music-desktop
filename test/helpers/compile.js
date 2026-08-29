'use strict'
// 把订阅链路涉及的 TypeScript 源文件编译成 CommonJS 放到 test/.build/，供测试直接 require。
// 目的是让测试跑的是**真实的生产代码**，而不是在测试里复制一份逻辑。
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '../..')
const buildDir = path.join(repoRoot, 'test/.build')
const stampPath = path.join(buildDir, '.stamp.json')

// 固定的编译集合：各测试文件需求不同，但统一编译全集才能安全复用同一份产物
const ENTRIES = [
  'src/main/modules/subscription/cd2.ts',
  'src/main/worker/dbService/tables.ts',
  'src/main/worker/dbService/modules/subscription/index.ts',
  'src/renderer/store/subscription/index.ts',
]

const OUTPUTS = [
  'main/modules/subscription/cd2.js',
  'main/worker/dbService/tables.js',
  'main/worker/dbService/modules/subscription/index.js',
  'renderer/store/subscription/index.js',
]

let compiled = false

const sourceStamp = () => Object.fromEntries(ENTRIES.map(e => {
  const stat = fs.statSync(path.join(repoRoot, e), { throwIfNoEntry: false })
  return [e, stat ? stat.mtimeMs : 0]
}))

/** 已有产物是否可直接复用（文件齐全且不比源码旧） */
const isReusable = () => {
  if (!fs.existsSync(stampPath)) return false
  if (!OUTPUTS.every(o => fs.existsSync(path.join(buildDir, o)))) return false
  try {
    const previous = JSON.parse(fs.readFileSync(stampPath, 'utf8'))
    const current = sourceStamp()
    return ENTRIES.every(e => previous[e] === current[e])
  } catch {
    return false
  }
}

const compileInto = (outDir) => {
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const tsconfigPath = path.join(outDir, 'tsconfig.json')
  fs.writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'CommonJS',
      moduleResolution: 'node',
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      skipLibCheck: true,
      strict: false,
      noEmitOnError: false,
      rootDir: path.join(repoRoot, 'src'),
      outDir,
      types: ['node'],
    },
    files: ENTRIES.map(e => path.join(repoRoot, e)),
    include: [path.join(repoRoot, 'src/common/types/**/*.d.ts'), path.join(repoRoot, 'src/main/types/**/*.d.ts')],
  }, null, 2))
  try {
    execFileSync(process.execPath, [path.join(repoRoot, 'node_modules/typescript/bin/tsc'), '-p', tsconfigPath], {
      cwd: repoRoot, stdio: 'pipe',
    })
  } catch (err) {
    // 缺少 webpack 别名和 json 模块解析会报类型错误，但 JS 照常产出；只有真的没产出才算失败
    const missing = OUTPUTS.filter(o => !fs.existsSync(path.join(outDir, o)))
    if (missing.length) {
      throw new Error(`tsc 编译失败，缺少产物 ${missing.join(', ')}\n${err.stdout || ''}${err.stderr || ''}`)
    }
  }
  placeProto(outDir)
  fs.writeFileSync(path.join(outDir, '.stamp.json'), JSON.stringify(sourceStamp(), null, 2))
}

/**
 * cd2.ts 在非 production 下按 `__dirname/../src/main/modules/clouddrive.proto` 找 proto。
 * 编译产物的目录层级和打包产物不同，这里把 proto 摆到两种分支都能解析到的位置。
 */
const placeProto = (outDir) => {
  const source = path.join(repoRoot, 'src/main/modules/clouddrive.proto')
  const compiledDir = path.join(outDir, 'main/modules/subscription')
  for (const target of [
    path.join(compiledDir, 'clouddrive.proto'),
    path.join(compiledDir, '../src/main/modules/clouddrive.proto'),
  ]) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  }
}

/**
 * 编译（或复用）产物目录。
 * node --test 默认并发跑各测试文件，所以先编译到进程私有目录再整体换上，
 * 避免多个进程同时往 test/.build 里写导致互相踩。
 */
const compileOnce = () => {
  if (compiled) return buildDir
  if (isReusable()) { compiled = true; return buildDir }
  const staging = `${buildDir}.${process.pid}`
  try {
    compileInto(staging)
    fs.rmSync(buildDir, { recursive: true, force: true })
    fs.renameSync(staging, buildDir)
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true })
    // 并发场景下别的进程可能已经装好了，能复用就复用
    if (!isReusable()) throw err
  }
  compiled = true
  return buildDir
}

/**
 * 把一段（可能被改写过的）TS 源码单独编译成 CJS，用于变异测试。
 * 返回可 require 的绝对路径。
 */
const compileStandalone = (name, source) => {
  const dir = path.join(repoRoot, 'test/.build-mutation', `${name}-${process.pid}`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const tsPath = path.join(dir, 'input.ts')
  fs.writeFileSync(tsPath, source)
  const tsconfigPath = path.join(dir, 'tsconfig.json')
  fs.writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'CommonJS', moduleResolution: 'node',
      esModuleInterop: true, skipLibCheck: true, strict: false, noEmitOnError: false,
      outDir: dir, types: ['node'],
    },
    files: [tsPath],
  }))
  try {
    execFileSync(process.execPath, [path.join(repoRoot, 'node_modules/typescript/bin/tsc'), '-p', tsconfigPath], { stdio: 'pipe' })
  } catch { /* 缺失全局类型会报错但仍产出 JS */ }
  const out = path.join(dir, 'input.js')
  if (!fs.existsSync(out)) throw new Error('变异版本编译失败')
  const proto = path.join(repoRoot, 'src/main/modules/clouddrive.proto')
  fs.mkdirSync(path.join(dir, '../src/main/modules'), { recursive: true })
  fs.copyFileSync(proto, path.join(dir, '../src/main/modules/clouddrive.proto'))
  return out
}

module.exports = { compileOnce, compileStandalone, buildDir, repoRoot, ENTRIES }
