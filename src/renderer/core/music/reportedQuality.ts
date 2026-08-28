const CANONICAL_QUALITIES: ReadonlySet<string> = new Set(['128k', '320k', 'flac', 'flac24bit'])
const LOSSLESS_CODECS: ReadonlySet<string> = new Set(['flac', 'ape', 'wav'])

// “10000”及以上的裸数字按 bps 理解，避免把 320000bps 当成 320000kbps
const parseKbps = (value: unknown): number | null => {
  if (typeof value == 'number' && Number.isFinite(value)) return value > 0 ? Math.round(value >= 10_000 ? value / 1000 : value) : null
  if (typeof value != 'string') return null
  const match = /^(\d{1,5})(?:\s*(?:k|kbps|kb\/s))?$/i.exec(value.trim())
  if (!match) return null
  const num = Number(match[1])
  if (num <= 0) return null
  return num >= 10_000 ? Math.round(num / 1000) : num
}

const qualityFromKbps = (kbps: number): LX.Subscription.Quality => kbps >= 256 ? '320k' : '128k'

/**
 * 把自定义音源返回的实际音质报告映射为统一音质等级；
 * 无法映射时返回 null，订阅下载流程将直接跳过该歌曲，不发起音频下载。
 */
export const mapReportedQuality = (report: {
  quality?: unknown
  bitrate?: unknown
  codec?: unknown
  bitDepth?: unknown
}): LX.Subscription.Quality | null => {
  const rawQuality = typeof report.quality == 'number'
    ? String(report.quality)
    : typeof report.quality == 'string' ? report.quality.trim().toLowerCase() : ''
  if (CANONICAL_QUALITIES.has(rawQuality)) return rawQuality as LX.Subscription.Quality
  if (rawQuality) {
    if (rawQuality.includes('flac') && rawQuality.includes('24')) return 'flac24bit'
    if (/(flac|ape|wav)/.test(rawQuality)) return 'flac'
    const kbps = parseKbps(rawQuality)
    return kbps == null ? null : qualityFromKbps(kbps)
  }
  const codec = typeof report.codec == 'string' ? report.codec.trim().toLowerCase() : ''
  if (LOSSLESS_CODECS.has(codec)) {
    const bitDepth = typeof report.bitDepth == 'number' ? report.bitDepth : Number(report.bitDepth)
    return Number.isFinite(bitDepth) && bitDepth >= 24 ? 'flac24bit' : 'flac'
  }
  const kbps = parseKbps(report.bitrate)
  return kbps == null ? null : qualityFromKbps(kbps)
}
