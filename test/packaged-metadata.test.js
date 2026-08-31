'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const webpack = require('webpack')
const baseConfig = require('../build-config/main/webpack.config.base')

test('production main-process metadata parser runs without installed dependencies', async(t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-packaged-metadata-'))
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(workspace)), fs.realpathSync(os.tmpdir()))
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  const compiler = webpack({
    ...baseConfig,
    mode: 'production',
    entry: path.join(__dirname, 'fixtures/music-metadata-entry.js'),
    output: { ...baseConfig.output, path: workspace, filename: 'metadata.cjs' },
    // Keep production module resolution/externals; linting is covered separately.
    plugins: [],
    optimization: { minimize: false },
  })
  const stats = await new Promise((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close(closeError => {
        if (error || closeError) reject(error || closeError)
        else resolve(result)
      })
    })
  })
  assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }))

  // A real one-second PCM WAV exercises parseFile and its dynamically loaded parser.
  const samples = Buffer.alloc(44 + 8000 * 2)
  samples.write('RIFF', 0)
  samples.writeUInt32LE(samples.length - 8, 4)
  samples.write('WAVEfmt ', 8)
  samples.writeUInt32LE(16, 16)
  samples.writeUInt16LE(1, 20)
  samples.writeUInt16LE(1, 22)
  samples.writeUInt32LE(8000, 24)
  samples.writeUInt32LE(16000, 28)
  samples.writeUInt16LE(2, 32)
  samples.writeUInt16LE(16, 34)
  samples.write('data', 36)
  samples.writeUInt32LE(samples.length - 44, 40)
  const files = ['sample.wav', 'sample-without-extension'].map(name => path.join(workspace, name))
  for (const file of files) fs.writeFileSync(file, samples)

  // Run outside the repository, without NODE_PATH or Node's global module folders.
  // The extensionless copy also exercises file-type and its transitive dependencies.
  const output = execFileSync(process.execPath, [
    '--no-global-search-paths',
    '-e',
    `const { parseFile } = require(process.argv[1]);
    Promise.all(process.argv.slice(2).map(file => parseFile(file)))
      .then(results => console.log(JSON.stringify(results.map(result => result.format))))
      .catch(error => { console.error(error); process.exitCode = 1; });`,
    path.join(workspace, 'metadata.cjs'),
    ...files,
  ], {
    cwd: workspace,
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const formats = JSON.parse(output)
  assert.equal(formats.length, 2)
  for (const format of formats) {
    assert.equal(format.container, 'WAVE')
    assert.equal(format.sampleRate, 8000)
    assert.equal(format.bitsPerSample, 16)
    assert.equal(format.numberOfChannels, 1)
    assert.equal(format.duration, 1)
  }
})
