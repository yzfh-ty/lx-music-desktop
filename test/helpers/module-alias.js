'use strict'
/**
 * require 钩子：把 @renderer / @common / @main 这些 webpack 别名解析到
 * 编译产物或测试桩上，好让渲染进程的 store 代码能在 node 里直接跑。
 */
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs')

const original = Module._resolveFilename

/**
 * @param {Record<string, string>} map 别名前缀 -> 目标目录或文件
 */
const register = (map) => {
  Module._resolveFilename = function(request, ...rest) {
    for (const [alias, target] of Object.entries(map)) {
      if (request !== alias && !request.startsWith(`${alias}/`)) continue
      const suffix = request.slice(alias.length).replace(/^\//, '')
      const candidates = suffix
        ? [path.join(target, suffix), path.join(target, `${suffix}.js`), path.join(target, suffix, 'index.js')]
        : [target, `${target}.js`, path.join(target, 'index.js')]
      const hit = candidates.find(c => fs.existsSync(c) && fs.statSync(c).isFile())
      if (hit) return original.call(this, hit, ...rest)
      throw new Error(`别名 ${request} 解析失败，尝试过:\n  ${candidates.join('\n  ')}`)
    }
    return original.call(this, request, ...rest)
  }
}

const restore = () => { Module._resolveFilename = original }

module.exports = { register, restore }
