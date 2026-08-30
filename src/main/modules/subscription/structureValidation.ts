import fs from 'node:fs'
import path from 'node:path'
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

export const scanSubscriptionStructure = async(
  config: LX.Subscription.Config,
  input: LX.Subscription.StructureValidationInput,
): Promise<string[]> => {
  await checkSubscriptionCd2Health(config)
  const rootPath = path.resolve(input.rootPath.trim() || config.cd2RootPath)
  if (!isWithin(config.cd2RootPath, rootPath)) throw new Error('目录校验范围必须位于 CloudDrive2 音乐库根目录内')
  const rootStat = await fs.promises.stat(rootPath).catch(() => null)
  if (!rootStat?.isDirectory()) throw new Error('目录校验根目录不存在或不是目录')

  const files: string[] = []
  const directories = [rootPath]
  while (directories.length) {
    const directory = directories.shift()!
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (input.recursive) directories.push(entryPath)
        continue
      }
      if (entry.isFile() && audioExtensions.has(path.extname(entry.name).toLowerCase())) files.push(entryPath)
    }
  }
  return files
}
