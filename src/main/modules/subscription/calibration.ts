import fs from 'node:fs'
import path from 'node:path'
import { parseFile } from 'music-metadata'
import { checkSubscriptionCd2Health } from './cd2'

const audioExtensions = new Set(['.mp3', '.flac', '.wav', '.ape', '.m4a', '.aac', '.ogg', '.opus'])

const comparablePath = (input: string) => {
  const resolved = path.resolve(input).replace(/[\\/]+$/, '')
  return process.platform == 'win32' ? resolved.toLowerCase() : resolved
}

const isWithin = (parent: string, child: string) => {
  const parentPath = comparablePath(parent)
  const childPath = comparablePath(child)
  return childPath == parentPath || childPath.startsWith(`${parentPath}${path.sep}`)
}

const resolveScopedPaths = (rootPath: string, values: string[]) => values
  .map(value => value.trim())
  .filter(Boolean)
  .map(value => path.resolve(rootPath, value))
  .map(value => {
    if (!isWithin(rootPath, value)) throw new Error(`校准目录超出根目录：${value}`)
    return value
  })

const inspectQuality = (format: Awaited<ReturnType<typeof parseFile>>['format']): LX.Subscription.Quality | null => {
  if (format.lossless) return (format.bitsPerSample ?? 0) >= 24 ? 'flac24bit' : 'flac'
  const bitrate = format.bitrate ?? 0
  if (!bitrate) return null
  return bitrate >= 256_000 ? '320k' : '128k'
}

const collectAudioFiles = async(rootPath: string, recursive: boolean, excludes: string[]) => {
  const files: string[] = []
  const directories = [rootPath]
  while (directories.length) {
    const directory = directories.shift()!
    if (excludes.some(excluded => isWithin(excluded, directory))) continue
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (excludes.some(excluded => isWithin(excluded, entryPath))) continue
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (recursive) directories.push(entryPath)
        continue
      }
      if (entry.isFile() && audioExtensions.has(path.extname(entry.name).toLowerCase())) files.push(entryPath)
    }
  }
  return files
}

export const collectSubscriptionCalibrationFiles = async(
  config: LX.Subscription.Config,
  input: LX.Subscription.CalibrationScanInput,
): Promise<string[]> => {
  await checkSubscriptionCd2Health(config)
  const rootPath = path.resolve(input.rootPath.trim() || config.cd2RootPath)
  if (!isWithin(config.cd2RootPath, rootPath)) throw new Error('校准根目录必须位于 CD2 音乐库根目录内')
  const rootStat = await fs.promises.stat(rootPath).catch(() => null)
  if (!rootStat?.isDirectory()) throw new Error('校准根目录不存在或不是目录')
  const excludes = resolveScopedPaths(rootPath, input.excludePaths)
  const includes = resolveScopedPaths(rootPath, input.includePaths)
  const scanRoots = includes.length ? includes : [rootPath]
  const fileSet = new Set<string>()
  for (const scanRoot of scanRoots) {
    const stat = await fs.promises.stat(scanRoot).catch(() => null)
    if (!stat?.isDirectory()) throw new Error(`包含目录不存在：${scanRoot}`)
    for (const filePath of await collectAudioFiles(scanRoot, input.recursive, excludes)) fileSet.add(filePath)
  }
  return Array.from(fileSet)
}

export const inspectSubscriptionCalibrationFile = async(filePath: string): Promise<LX.Subscription.CalibrationFile> => {
  try {
    const metadata = await parseFile(filePath, { duration: true, skipCovers: true })
    return {
      filePath,
      title: metadata.common.title?.trim() ?? '',
      artist: metadata.common.artist?.trim() ?? metadata.common.artists?.join(' / ').trim() ?? '',
      duration: metadata.format.duration ?? null,
      quality: inspectQuality(metadata.format),
      error: null,
    }
  } catch (err) {
    return {
      filePath,
      title: '',
      artist: '',
      duration: null,
      quality: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export const scanSubscriptionCalibration = async(
  config: LX.Subscription.Config,
  input: LX.Subscription.CalibrationScanInput,
): Promise<LX.Subscription.CalibrationFile[]> => {
  const results: LX.Subscription.CalibrationFile[] = []
  for (const filePath of await collectSubscriptionCalibrationFiles(config, input)) {
    results.push(await inspectSubscriptionCalibrationFile(filePath))
  }
  return results
}
