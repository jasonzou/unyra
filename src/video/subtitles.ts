/**
 * 外挂字幕解析与管理工具。
 *
 * 支持格式：
 * 1. SRT (.srt): 标准三段式 (序号 / 时间戳 `00:00:00,000 --> 00:00:00,000` / 文本)
 * 2. WebVTT (.vtt): 标准 WebVTT 格式，含带 settings 的 cue 与简写时间戳 `00:00.000`
 * 3. JSON 字幕: 支持 B 站标准 CC 字幕 `{ body: [{ from, to, content }] }` 及数组格式
 *
 * 容错处理：
 * - 剥离 HTML 标签（`<b>`, `<i>`, `<font>`, `<c>` 等）与特殊转义；
 * - 自动归一化毫秒时间戳并按升序排列；
 * - 修正时间倒挂与重叠。
 */

import type { Transcript, TranscriptSegment } from './types'

/** 毫秒解析：解析 `hh:mm:ss,mmm` 或 `mm:ss.mmm` */
export function parseTimestamp(timeStr: string): number {
  const clean = timeStr.trim().replace(',', '.')
  const parts = clean.split(':')
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0
    const minutes = parseFloat(parts[1]) || 0
    const seconds = parseFloat(parts[2]) || 0
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000)
  }
  if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0
    const seconds = parseFloat(parts[1]) || 0
    return Math.round((minutes * 60 + seconds) * 1000)
  }
  const seconds = parseFloat(clean) || 0
  return Math.round(seconds * 1000)
}

/** 剥离字幕样式标签与 HTML 实体 */
export function cleanSubtitleText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '') // 剥离 HTML/WebVTT 标签如 <i>, <b>, <c.color>, <v Speaker>
    .replace(/\{[^}]+\}/g, '') // 剥离 ASS/SSA 风格特效指令如 {\an8\fs24}
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

/** 匹配字幕时间轴行：`00:01:23,456 --> 00:01:25,789` */
const TIMESTAMP_LINE_RE = /((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/

/** 解析 SRT 文本内容 */
export function parseSrt(content: string): TranscriptSegment[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  const blocks = normalized.split(/\n\s*\n/)
  const segments: TranscriptSegment[] = []

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) continue

    // 寻找包含 --> 的时间行
    let timeLineIdx = -1
    let match: RegExpMatchArray | null = null
    for (let i = 0; i < lines.length; i++) {
      match = lines[i].match(TIMESTAMP_LINE_RE)
      if (match) {
        timeLineIdx = i
        break
      }
    }

    if (timeLineIdx === -1 || !match) continue

    const startMs = parseTimestamp(match[1])
    let endMs = parseTimestamp(match[2])
    if (endMs <= startMs) {
      endMs = startMs + 1000
    }

    const textLines = lines.slice(timeLineIdx + 1)
    const text = cleanSubtitleText(textLines.join('\n'))
    if (!text) continue

    segments.push({ startMs, endMs, text })
  }

  return segments
}

/** 解析 WebVTT 文本内容 */
export function parseVtt(content: string): TranscriptSegment[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  const lines = normalized.split('\n')
  const segments: TranscriptSegment[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()

    // 跳过 WEBVTT 头、NOTE、STYLE、REGION 块
    if (!line || line.startsWith('WEBVTT') || line.startsWith('NOTE') || line.startsWith('STYLE') || line.startsWith('REGION')) {
      if (line.startsWith('NOTE') || line.startsWith('STYLE') || line.startsWith('REGION')) {
        // 跳过整个多行块直到空行
        while (i < lines.length && lines[i].trim() !== '') i++
      }
      i++
      continue
    }

    const match = line.match(TIMESTAMP_LINE_RE)
    if (match) {
      const startMs = parseTimestamp(match[1])
      let endMs = parseTimestamp(match[2])
      if (endMs <= startMs) {
        endMs = startMs + 1000
      }

      i++
      const textLines: string[] = []
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim())
        i++
      }

      const text = cleanSubtitleText(textLines.join('\n'))
      if (text) {
        segments.push({ startMs, endMs, text })
      }
      continue
    }

    i++
  }

  return segments
}

/** 解析 JSON 格式字幕 (支持 B 站标准 CC 字幕) */
export function parseJsonSubtitles(content: string): TranscriptSegment[] {
  try {
    const data = JSON.parse(content)
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.body)
        ? data.body
        : Array.isArray(data?.segments)
          ? data.segments
          : []

    const segments: TranscriptSegment[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      let startMs = 0
      let endMs = 0
      let text = ''

      if (typeof item.from === 'number') {
        startMs = Math.round(item.from * 1000)
        endMs = typeof item.to === 'number' ? Math.round(item.to * 1000) : startMs + 1500
        text = String(item.content ?? '')
      } else if (typeof item.startMs === 'number') {
        startMs = Math.round(item.startMs)
        endMs = typeof item.endMs === 'number' ? Math.round(item.endMs) : startMs + 1500
        text = String(item.text ?? '')
      } else if (typeof item.start === 'number') {
        startMs = Math.round(item.start * 1000)
        endMs = typeof item.end === 'number' ? Math.round(item.end * 1000) : startMs + 1500
        text = String(item.text ?? item.content ?? '')
      }

      text = cleanSubtitleText(text)
      if (!text) continue
      if (endMs <= startMs) endMs = startMs + 1000

      segments.push({ startMs, endMs, text })
    }

    return segments
  } catch {
    return []
  }
}

/** 整理并归一化外挂字幕：排序、修正重叠、过滤无效项 */
export function sanitizeSubtitleSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (!segments.length) return []

  // 按时间升序排序
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs)
  const result: TranscriptSegment[] = []

  for (let i = 0; i < sorted.length; i++) {
    const cur = { ...sorted[i] }
    if (!cur.text || cur.endMs <= cur.startMs) continue

    // 处理轻微时间重叠：如果前一个条目的结束时间大于当前条目的开始时间，截断前一个的结束时间
    if (result.length > 0) {
      const prev = result[result.length - 1]
      if (prev.endMs > cur.startMs) {
        prev.endMs = Math.max(prev.startMs + 50, cur.startMs)
      }
    }

    result.push(cur)
  }

  return result
}

/**
 * 统一字幕解析入口：根据后缀名或内容自动选择解析器
 */
export function parseSubtitleFile(content: string, filename?: string): TranscriptSegment[] {
  const trimmed = content.trim()
  if (!trimmed) return []

  const lowerName = (filename ?? '').toLowerCase()

  // 1. JSON
  if (lowerName.endsWith('.json') || (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    const parsed = parseJsonSubtitles(trimmed)
    if (parsed.length) return sanitizeSubtitleSegments(parsed)
  }

  // 2. WebVTT
  if (lowerName.endsWith('.vtt') || trimmed.startsWith('WEBVTT')) {
    const parsed = parseVtt(trimmed)
    if (parsed.length) return sanitizeSubtitleSegments(parsed)
  }

  // 3. SRT
  const srtParsed = parseSrt(trimmed)
  if (srtParsed.length) return sanitizeSubtitleSegments(srtParsed)

  // 4. 容错尝试 VTT
  const vttFallback = parseVtt(trimmed)
  return sanitizeSubtitleSegments(vttFallback)
}

/**
 * 将解析出的字幕段构造成标准的 Transcript 对象
 */
export function toTranscript(segments: TranscriptSegment[], filename?: string): Transcript {
  return {
    version: 1,
    origin: 'subtitle',
    language: filename ? filename.replace(/\.[^.]+$/, '') : undefined,
    segments: sanitizeSubtitleSegments(segments),
  }
}

/**
 * 查找指定时间（毫秒）对应的字幕文本。支持偏移量 offsetMs（正数为字幕延后显示，负数为提前）。
 */
export function findActiveSubtitle(
  segments: TranscriptSegment[],
  currentMs: number,
  offsetMs: number = 0,
): TranscriptSegment | null {
  if (!segments.length) return null
  const effectiveMs = currentMs - offsetMs
  if (effectiveMs < 0) return null

  // 二分查找
  let lo = 0
  let hi = segments.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const seg = segments[mid]
    if (effectiveMs < seg.startMs) {
      hi = mid - 1
    } else if (effectiveMs >= seg.endMs) {
      lo = mid + 1
    } else {
      return seg
    }
  }

  return null
}
