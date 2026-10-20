/**
 * B 站来源插件（实验）：字幕直取 + html5 mp4 流。
 *
 * 两条产出路径，正好是插件契约的两半：
 * - **转录段（字幕直取）**：player 接口的 subtitle 列表 → CC 字幕 json（from/to 秒浮点，
 *   content 纯文本）→ 统一转录段。AI 字幕通常要登录才给（SESSDATA），没有登录态时
 *   多数视频拿不到字幕——这一步失败**不挡播放**（转录是可选产出，视频照常放）。
 * - **流**：playurl 的 html5 通道（platform=html5&high_quality=1）给的是**音视频合一**的
 *   mp4——绕开 DASH 双流同步这个深坑，代价是清晰度封顶 480p。实验期这是笔划算的买卖。
 *
 * 所有请求都要带浏览器指纹（UA + Referer: www.bilibili.com），否则接口按风控回 -352、
 * CDN 按防盗链回 403。接口原样回什么 code/message 就往上抛什么——这里不写预判文案。
 */

import { t } from '../../i18n'
import { normalizeTranscript } from '../transcript'
import type { Transcript, VideoPluginCtx, VideoResolveOptions, VideoSource, VideoSourcePlugin } from '../types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 每个请求都带的防盗链头；有登录态时补 SESSDATA cookie */
function apiHeaders(opts: VideoResolveOptions): Record<string, string> {
  return {
    'user-agent': UA,
    referer: 'https://www.bilibili.com/',
    ...(opts.sessdata?.trim() ? { cookie: `SESSDATA=${opts.sessdata.trim()}` } : {}),
  }
}

interface BiliMatch {
  bvid: string
  /** 分 P（1 起）；裸 BV 号或 URL 没写 p 时是 1 */
  page: number
}

/** 从裸 BV 号或 bilibili.com/video/BV… 链接里抽出 bvid 与分 P（不认识的输入返回 null） */
export function matchBili(raw: string): BiliMatch | null {
  const input = raw.trim()
  const bv = /BV[0-9A-Za-z]{10}/.exec(input)?.[0]
  if (!bv) return null
  // 只认明确的 B 站形态：裸 BV 号，或者域名确实是 bilibili（b23.tv 短链先不接——它要跟一次重定向才知道 BV）
  const isBili = /^BV[0-9A-Za-z]{10}$/.test(input) || /(^|\.)bilibili\.com\//i.test(input)
  if (!isBili) return null
  const page = Number(/[?&]p=(\d+)/.exec(input)?.[1] ?? 1)
  return { bvid: bv, page: Number.isInteger(page) && page >= 1 ? page : 1 }
}

interface BiliViewData {
  code: number
  message?: string
  data?: {
    title?: string
    duration?: number
    pages?: Array<{ page?: number; cid?: number; duration?: number; part?: string }>
  }
}

interface BiliPlayData {
  code: number
  message?: string
  data?: { durl?: Array<{ url?: string; size?: number }> }
}

interface BiliPlayerData {
  code: number
  message?: string
  data?: {
    subtitle?: {
      subtitles?: Array<{ lan?: string; lan_doc?: string; subtitle_url?: string }>
    }
  }
}

/** GET 一个 B 站接口并解析 JSON；code !== 0 时把接口原话抛上去 */
async function getJson<T>(ctx: VideoPluginCtx, url: string, opts: VideoResolveOptions): Promise<T> {
  const res = await ctx.fetch(url, apiHeaders(opts))
  if (!res.ok) throw new Error(res.error)
  let json: T & { code?: number; message?: string }
  try {
    json = JSON.parse(res.body) as T & { code?: number; message?: string }
  } catch {
    throw new Error(t('{0} 回的不是 JSON（status {1}）', new URL(url).host, String(res.status)))
  }
  // 无 code 字段的不拦（字幕 json 就没有）；有 code 且非 0 的按风控口径抛原话
  if (typeof json.code === 'number' && json.code !== 0) {
    throw new Error(t('{0}：{1}', String(json.code), json.message || t('接口未说明原因')))
  }
  return json
}

async function fetchTranscript(
  ctx: VideoPluginCtx,
  bvid: string,
  cid: number,
  opts: VideoResolveOptions,
): Promise<Transcript | undefined> {
  const player = await getJson<BiliPlayerData>(
    ctx,
    `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`,
    opts,
  )
  const subs = player.data?.subtitle?.subtitles ?? []
  // 语言偏好：UP 传的中文 CC（zh-Hans / zh-CN）→ AI 字幕（lan 是 ai-zh，startsWith('zh')
  // 摸不到它）→ 兜底取列表第一条。多语言视频里别让英文 CC 抢了 AI 中文字幕的位子
  const sub =
    subs.find((s) => /^(zh-Hans|zh-CN)$/i.test(s.lan ?? '')) ??
    subs.find((s) => (s.lan ?? '').startsWith('ai-zh')) ??
    subs[0]
  if (!sub?.subtitle_url) return undefined
  const subUrl = sub.subtitle_url.startsWith('//') ? `https:${sub.subtitle_url}` : sub.subtitle_url
  const json = await getJson<{ body?: Array<{ from?: number; to?: number; content?: string }> }>(ctx, subUrl, opts)
  const segments = (json.body ?? []).map((cue) => ({
    startMs: Math.round((cue.from ?? 0) * 1000),
    endMs: Math.round((cue.to ?? 0) * 1000),
    text: String(cue.content ?? '').replace(/\s+/g, ' ').trim(),
  }))
  return normalizeTranscript({ version: 1, origin: 'subtitle', language: sub.lan, segments })
}

export const bilibiliPlugin: VideoSourcePlugin = {
  id: 'bilibili',
  name: 'Bilibili',
  provides: ['stream', 'transcript'],

  match(input) {
    return matchBili(input) ? { input } : null
  },

  async resolve(matched, ctx, opts): Promise<VideoSource> {
    const m = matchBili(matched.input)
    if (!m) throw new Error(t('B 站插件认不出这个输入'))

    // 1. 视频信息：标题、时长、分 P 的 cid（后面 playurl 与字幕都要它）
    const view = await getJson<BiliViewData>(
      ctx,
      `https://api.bilibili.com/x/web-interface/view?bvid=${m.bvid}`,
      opts,
    )
    const data = view.data
    const pages = (data?.pages ?? []).filter((p) => typeof p.cid === 'number')
    const page = pages.find((p) => p.page === m.page) ?? pages[0]
    if (!page?.cid) throw new Error(t('视频信息里没有分 P（cid）'))

    // 2. 播放地址：html5 通道的合流 mp4（qn 64 = 480p；high_quality 是这一档的开关）
    const play = await getJson<BiliPlayData>(
      ctx,
      `https://api.bilibili.com/x/player/playurl?bvid=${m.bvid}&cid=${page.cid}&qn=64&platform=html5&high_quality=1`,
      opts,
    )
    const durls = play.data?.durl ?? []
    const raw = durls[0]?.url
    if (!raw) throw new Error(t('播放接口没有给出可用流'))
    if (durls.length > 1) throw new Error(t('这个视频返回了 {0} 段流，实验通道暂不支持', String(durls.length)))
    const streamUrl = raw.replace(/^http:\/\//, 'https://')

    // 3. 转录（可选产出）：失败不挡播放，但**原话要带回去**——面板据此区分
    //    「真没有字幕」与「试过但失败了」，配了登录态的用户不再被一句
    //    「需要登录」误导
    let transcript: Transcript | undefined
    let transcriptError: string | undefined
    try {
      transcript = await fetchTranscript(ctx, m.bvid, page.cid, opts)
    } catch (err) {
      transcript = undefined
      transcriptError = err instanceof Error ? err.message : String(err)
    }

    return {
      mediaId: `bili:${m.bvid}:p${page.page ?? 1}`,
      // 多 P 视频标题必须带 P 号与分 P 名：字幕与 mp4 都按 cid 取，不会串 P，
      // 但「用户想看 P3、链接里却没带 p=」时会默默落到 P1——标题不写明，
      // 「字幕和视频对不上」这种报告就没法一眼定位是哪一边错了
      title:
        (data?.title || page.part || m.bvid) +
        ((page.page ?? 1) > 1 ? ` · P${page.page} ${page.part ?? ''}`.trimEnd() : ''),
      durationMs: Math.round((page.duration ?? data?.duration ?? 0) * 1000) || undefined,
      stream: {
        kind: 'url',
        url: streamUrl,
        // CDN 与接口同一套防盗链头，由主进程的 media-relay 带在转发请求上
        headers: apiHeaders(opts),
      },
      transcript,
      ...(transcriptError ? { transcriptError } : {}),
    }
  },
}
