import { setMeta } from '@common/utils/musicMeta'
import { buildLyrics } from './lrcTool'

export const writeMeta = ({ filePath, isEmbedLyricLx, isEmbedLyricT, isEmbedLyricR, ...meta }: {
  filePath: string
  isEmbedLyricLx: boolean
  isEmbedLyricT: boolean
  isEmbedLyricR: boolean
  title: string
  artist: string
  album: string
  APIC: string | null
}, lyric: LX.Music.LyricInfo, proxy?: { host: string, port: number }) => {
  return setMeta(filePath, { ...meta, lyrics: buildLyrics(lyric, isEmbedLyricLx, isEmbedLyricT, isEmbedLyricR) }, proxy)
}

export const inspectAudioFile = async(filePath: string): Promise<LX.Subscription.AudioInspection> => {
  const { parseFile } = await import('music-metadata')
  const metadata = await parseFile(filePath)
  const codec = metadata.format.codec?.trim() ?? ''
  const container = metadata.format.container?.trim() ?? ''
  const bitrate = metadata.format.bitrate ? Math.round(metadata.format.bitrate) : null
  const sampleRate = metadata.format.sampleRate ?? null
  const bitDepth = metadata.format.bitsPerSample ?? null
  const duration = metadata.format.duration ?? null
  const format = `${codec} ${container}`.toLowerCase()
  const lossless = metadata.format.lossless === true || /flac|ape|alac|wav|wave|pcm/.test(format)
  const extension: LX.Download.FileExt | null = format.includes('flac')
    ? 'flac'
    : /mp3|mpeg/.test(format)
      ? 'mp3'
      : format.includes('ape')
        ? 'ape'
        : /wav|wave|pcm/.test(format)
          ? 'wav'
          : null
  let quality: LX.Subscription.Quality | null = null
  if (lossless) quality = bitDepth != null && bitDepth >= 24 ? 'flac24bit' : 'flac'
  else if (extension == 'mp3') quality = bitrate != null && bitrate >= 256_000 ? '320k' : '128k'
  return { codec, container, extension, bitrate, sampleRate, bitDepth, duration, quality }
}

export const removeLocalFile = async(filePath: string) => {
  const { removeFile } = await import('@common/utils/nodejs')
  await removeFile(filePath)
}

export const renameLocalFile = async(oldPath: string, newPath: string) => {
  const fs = await import('node:fs')
  const target = await fs.promises.stat(newPath).catch(() => null)
  if (target) throw new Error('按实际音频格式修正扩展名时目标文件已存在')
  await fs.promises.rename(oldPath, newPath)
}

export { saveLrc } from './utils'
