/**
 * 视频学习页签（实验）：通用播放器 + 转录段面板 + 时间戳跳转。
 *
 * 这是「视频内容分析」链路的第一段落地：来源插件解析出**合流 mp4 流**与**统一转录段**
 * （契约见 src/video/types），本页只做三件通用的事——播放、按时间戳显示转录、
 * 双向跳转（点转录段 seek 播放器；播放推进时高亮当前段）。分组与 agent 工具面
 * 是后续的事，这个页签刻意什么都不懂。
 *
 * 两个实验期的妥协，都写在各自的注释里：
 * - SESSDATA 走 localStorage + 页签内的小弹层：正式形态应该进设置页，先就地能用；
 * - 流地址每次解析都重新登记（media-relay 不落盘），所以页签状态是纯会话态，
 *   重启后回到空页（normalizeTab 不认 video 页签，同 guard 的待遇）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, Loader2, MonitorPlay, Settings2 } from 'lucide-react'
import { t } from '../../i18n'
import { isWeb } from '../../lib/native'
import { fadeMask, useScrollEdges } from '../../lib/scrollFade'
import { openRelayStream, resolveSource } from '../../video/registry'
import { formatClock, segmentIndexAt } from '../../video/transcript'
import type { Transcript, VideoSource } from '../../video/types'

/** SESSDATA 存放键：实验期存 localStorage（跟浏览器 profile 走），正式形态挪进设置页 */
const SESSDATA_KEY = 'moji.video.sessdata'

const readSessdata = (): string => {
  try {
    return localStorage.getItem(SESSDATA_KEY) ?? ''
  } catch {
    return ''
  }
}

export default function VideoStudyTab() {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 解析结果：流地址（media-relay）+ 转录稿 + 元信息；null = 还没解析过（空态） */
  const [relayUrl, setRelayUrl] = useState<string | null>(null)
  const [source, setSource] = useState<VideoSource | null>(null)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [transcriptNote, setTranscriptNote] = useState<string | null>(null)
  /** 播放器此刻的位置（ms）：timeupdate 约 4Hz，直接跟着走足够高亮与自动滚动用 */
  const [currentMs, setCurrentMs] = useState(0)
  /** 登录设置小弹层 */
  const [sessOpen, setSessOpen] = useState(false)
  const [sessDraft, setSessDraft] = useState(readSessdata)
  const [sessSaved, setSessSaved] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const edges = useScrollEdges(listRef)

  const segments = transcript?.segments ?? []
  /** 播放推进到哪一段：段间空隙（-1）时全部行保持素净 */
  const activeIdx = segments.length ? segmentIndexAt(segments, currentMs) : -1

  /** 解析 → 登记流 → 更新整页状态。错误原话进横幅（库抛什么显示什么，不做预判文案） */
  const resolve = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    setTranscriptNote(null)
    try {
      const src = await resolveSource(text, { sessdata: readSessdata() })
      const url = await openRelayStream(src)
      setSource(src)
      setRelayUrl(url)
      setTranscript(src.transcript ?? null)
      // 字幕没拿到不算失败——把原因说清楚，视频照常播
      if (!src.transcript) {
        setTranscriptNote(t('这条来源没有字幕：AI 字幕通常需要登录——点右上角齿轮填入 SESSDATA 后重试。'))
      }
      setCurrentMs(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [busy, input])

  /** 点转录段 → 播放器 seek 到段首并起播 */
  const seekMs = useCallback((ms: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = ms / 1000
    void video.play().catch(() => {
      // 自动播放被策略拦下时静默：位置已经到了，用户按一下播放就好
    })
  }, [])

  /** 当前段变了就把那行滚进视野（在视野里就别动——读着读着被拽走很烦） */
  useEffect(() => {
    const list = listRef.current
    const row = activeIdx >= 0 ? rowRefs.current[activeIdx] : null
    if (!list || !row) return
    const top = row.offsetTop
    const bottom = top + row.offsetHeight
    if (top < list.scrollTop + 8 || bottom > list.scrollTop + list.clientHeight - 8) {
      list.scrollTo({ top: Math.max(0, top - list.clientHeight / 3), behavior: 'smooth' })
    }
  }, [activeIdx])

  const saveSessdata = useCallback(() => {
    try {
      localStorage.setItem(SESSDATA_KEY, sessDraft.trim())
    } catch {
      // localStorage 不可用（隐私模式之类）就只在会话里生效：draft 还在内存里
    }
    setSessOpen(false)
    setSessSaved(true)
    window.setTimeout(() => setSessSaved(false), 1600)
  }, [sessDraft])

  /* ---------- 浏览器（WebUI）模式：本地媒体通道不存在，整页给一句引导 ---------- */
  if (isWeb()) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-card p-6 text-center select-none">
        <MonitorPlay size={32} className="text-seal/70" />
        <div className="text-[14px] font-semibold text-ink-strong">{t('视频学习仅桌面端可用')}</div>
        <p className="max-w-md text-[12px] leading-relaxed text-ink-faint">
          {t('视频流由主进程的本地媒体通道转发（防盗链头 `<video>` 发不出来），浏览器模式里没有这条通道。')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-paper select-none">
      {/* 工具条：输入 + 解析 + 登录设置。实验徽章常驻，提醒这是未完成的功能 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-card/60 px-3 py-2">
        <MonitorPlay size={15} className="shrink-0 text-seal" />
        <span className="shrink-0 rounded border border-seal/40 bg-seal/10 px-1.5 py-px text-[10px] font-medium text-seal">
          {t('实验')}
        </span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void resolve()
          }}
          placeholder={t('粘贴 B 站视频链接或 BV 号，回车解析')}
          disabled={busy}
          className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-[12.5px] text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/50 focus:ring-2 focus:ring-seal/10 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void resolve()}
          disabled={busy || !input.trim()}
          title={busy ? t('正在解析…') : t('解析视频与字幕')}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-2.5 text-[12px] font-medium text-paper transition hover:bg-ink-strong disabled:pointer-events-none disabled:opacity-35"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          {t('解析')}
        </button>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setSessOpen((v) => !v)}
            title={t('登录设置（SESSDATA，可选）')}
            aria-haspopup="dialog"
            aria-expanded={sessOpen}
            className={
              'flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-line/60 hover:text-ink ' +
              (sessOpen ? 'bg-line/60 text-ink' : '')
            }
          >
            <Settings2 size={15} />
          </button>
          {sessSaved && !sessOpen && (
            <span className="absolute right-0 top-full mt-1 whitespace-nowrap rounded-md border border-line bg-card px-2 py-1 text-[10.5px] text-ink-soft shadow-sm">
              {t('已保存')}
            </span>
          )}
        </div>
      </div>

      {/*
        登录设置做成**工具条下方的内联展开行**，而不是浮层：文档区页签容器带
        transform / overflow 裁剪，浮层的 fixed 定位会被劫持成「相对那个容器」，
        弹出来就是一条被裁剩的缝盖在按钮上（实测）。内联行躺在正常文档流里，
        谁也挡不住它。
      */}
      {sessOpen && (
        <div className="shrink-0 border-b border-line bg-card/40 px-3 py-2">
          <div className="text-[12px] font-medium text-ink-strong">{t('B 站登录态（SESSDATA，可选）')}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
            {t('AI 字幕通常要登录后才拿得到。值只存本机（浏览器存储），随请求发给 B 站。')}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={sessDraft}
              onChange={(e) => setSessDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveSessdata()
              }}
              placeholder="SESSDATA=…"
              className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-2.5 py-1.5 font-mono text-[11.5px] text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/50 focus:ring-2 focus:ring-seal/10"
            />
            <button
              type="button"
              onClick={() => setSessOpen(false)}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11.5px] text-ink-soft transition hover:bg-line/60"
            >
              {t('取消')}
            </button>
            <button
              type="button"
              onClick={saveSessdata}
              className="shrink-0 rounded-lg bg-seal px-2.5 py-1.5 text-[11.5px] font-medium text-white transition hover:bg-seal-deep"
            >
              {t('保存')}
            </button>
          </div>
        </div>
      )}

      {/* 错误横幅：解析或登记流的失败原话 */}
      {error && (
        <div className="shrink-0 border-b border-red-400/30 bg-red-400/10 px-3 py-1.5 text-[12px] leading-relaxed text-red-500 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 正文：上播放器、下转录面板；没解析过时整片是引导空态 */}
      {source && relayUrl ? (
        <>
          <div className="flex h-[46%] shrink-0 items-center justify-center bg-black">
            {/* key 绑流地址：重新解析换一条流时整只元素重建，播放状态清零是最诚实的表现 */}
            <video
              key={relayUrl}
              ref={videoRef}
              src={relayUrl}
              controls
              autoPlay
              onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
              onSeeked={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
              className="h-full w-full object-contain"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-card/40 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-strong">{source.title}</span>
            {source.durationMs ? (
              <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">{formatClock(source.durationMs)}</span>
            ) : null}
            {transcript ? (
              <span className="shrink-0 rounded border border-line bg-paper px-1.5 py-px text-[10px] text-ink-faint">
                {transcript.origin === 'subtitle' ? t('字幕') : t('语音识别')}
              </span>
            ) : null}
          </div>
          {/* 转录面板：mask 挂外层、滚动留内层（见 scrollFade 的说明），点击行 seek 播放器 */}
          <div
            className="flex min-h-0 flex-1 flex-col"
            style={{ maskImage: fadeMask(edges), WebkitMaskImage: fadeMask(edges) }}
          >
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {segments.length ? (
                segments.map((seg, i) => (
                  <div key={seg.startMs} ref={(el) => { rowRefs.current[i] = el }}>
                    <button
                      type="button"
                      onClick={() => seekMs(seg.startMs)}
                      className={
                        'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition ' +
                        (i === activeIdx ? 'bg-seal/10' : 'hover:bg-line/50')
                      }
                    >
                      <span
                        className={
                          'mt-px w-11 shrink-0 pt-px text-right font-mono text-[10.5px] ' +
                          (i === activeIdx ? 'text-seal' : 'text-ink-faint')
                        }
                      >
                        {formatClock(seg.startMs)}
                      </span>
                      <span
                        className={
                          'min-w-0 flex-1 text-[12.5px] leading-relaxed ' +
                          (i === activeIdx ? 'font-medium text-ink-strong' : 'text-ink')
                        }
                      >
                        {seg.text}
                      </span>
                    </button>
                  </div>
                ))
              ) : (
                <div className="px-3 py-8 text-center text-[12px] leading-relaxed text-ink-faint">
                  {transcriptNote ?? t('这条来源没有可用的转录。')}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center select-none">
          <Clapperboard size={36} className="text-seal/60" />
          <div className="text-[13.5px] font-medium text-ink-strong">{t('视频学习（实验）')}</div>
          <p className="max-w-[420px] text-[12px] leading-relaxed text-ink-faint">
            {t('在上面粘贴一个 B 站视频链接或 BV 号，解析后即可播放并按字幕时间戳跳转。')}
          </p>
          <p className="max-w-[420px] text-[11px] leading-relaxed text-ink-faint/80">
            {t('实验功能：视频接入由来源插件提供，应用本身不做任何平台解析。')}
          </p>
        </div>
      )}
    </div>
  )
}
