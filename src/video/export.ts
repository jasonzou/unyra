/**
 * 合集字幕的批量导出：把一份合集的所有转录拼成单个 Markdown 文本。
 *
 * 版式（用户定的）：
 *   # 合集标题 @{元信息}
 *   ## p1: 视频标题 @{元信息}
 *   - 00:00 字幕内容
 *
 * 元信息的具体内容：合集级 = 视频数与导出日期；视频级 = 时长与来源链接——
 * 导出的文件要能自己说清「这是谁、从哪来、什么时候拿的」。
 * 单条失败不炸全局：那一节留一句「字幕缺失：原因」，其余照常。
 */

import { t } from '../i18n'
import { formatClock } from './transcript'
import type { Transcript } from './types'

export interface CollectionExportEntry {
  title: string
  durationMs?: number
  /** 来源串（原样写进元信息，日后还能顺着它回去重新解析） */
  source: string
  transcript?: Transcript
  /** 这一条没拿到字幕的原因（接口失败 / 没有字幕 / 时长对账拦截） */
  error?: string
}

export function buildCollectionMarkdown(name: string, entries: CollectionExportEntry[]): string {
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const parts: string[] = [`# ${name} @{${t('{0} 个视频', String(entries.length))} · ${t('导出于 {0}', date)}}`, '']

  entries.forEach((entry, i) => {
    const meta = [entry.durationMs ? formatClock(entry.durationMs) : null, entry.source].filter(Boolean).join(' · ')
    parts.push(`## p${i + 1}: ${entry.title} @{${meta}}`, '')
    if (entry.transcript) {
      for (const seg of entry.transcript.segments) parts.push(`- ${formatClock(seg.startMs)} ${seg.text}`)
    } else {
      parts.push(`> ${t('字幕缺失：{0}', entry.error ?? t('这条来源没有可用字幕'))}`)
    }
    parts.push('')
  })

  return parts.join('\n')
}
