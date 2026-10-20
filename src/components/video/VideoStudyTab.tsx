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
import { ChevronLeft, ChevronRight, Clapperboard, Download, Loader2, MonitorPlay, Settings2 } from 'lucide-react'
import { t } from '../../i18n'
import { isWeb, native } from '../../lib/native'
import { fadeMask, useScrollEdges } from '../../lib/scrollFade'
import { openRelayStream, resolveSource, resolveTranscriptOnly } from '../../video/registry'
import { buildCollectionMarkdown, type CollectionExportEntry } from '../../video/export'
import { formatClock, segmentIndexAt } from '../../video/transcript'
import type { Transcript, VideoSource } from '../../video/types'

/** SESSDATA 存放键：实验期存 localStorage（跟浏览器 profile 走），正式形态挪进设置页 */
const SESSDATA_KEY = 'moji.video.sessdata'
/** 上次解析的输入：页签持久化后（normalizeTab 认 video），重启把它填回输入框，一键重新解析 */
const INPUT_KEY = 'moji.video.input'
/** 合集列表收起与否：跟输入一样落在 localStorage，重启后保持上次的选择 */
const COLLAPSED_KEY = 'moji.video.collapsed'

const readSessdata = (): string => {
  try {
    return localStorage.getItem(SESSDATA_KEY) ?? ''
  } catch {
    return ''
  }
}

const readLastInput = (): string => {
  try {
    return localStorage.getItem(INPUT_KEY) ?? ''
  } catch {
    return ''
  }
}

const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export default function VideoStudyTab() {
  const [input, setInput] = useState(readLastInput)
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
  /** 合集列表收起与否（用户可收起；选择落 localStorage，重启保持） */
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, v ? '0' : '1')
      } catch {
        // 会话内生效即可
      }
      return !v
    })
  }, [])
  /** 合集字幕批量导出进度；null = 没在导出 */
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const edges = useScrollEdges(listRef)

  const segments = transcript?.segments ?? []
  /** 播放推进到哪一段：段间空隙（-1）时全部行保持素净 */
  const activeIdx = segments.length ? segmentIndexAt(segments, currentMs) : -1

  /** 解析 → 登记流 → 更新整页状态。错误原话进横幅（库抛什么显示什么，不做预判文案）。
   *  收一个显式入参：工具条吃输入框的值，合集列表点切换时吃那一项的来源串。 */
  const runResolve = useCallback(
    async (text: string) => {
      if (!text || busy) return
      setBusy(true)
      setError(null)
      setTranscriptNote(null)
      try {
        localStorage.setItem(INPUT_KEY, text)
      } catch {
        // localStorage 不可用就只当会话内的输入，无碍
      }
      try {
        const src = await resolveSource(text, { sessdata: readSessdata() })
        const url = await openRelayStream(src)
        setSource(src)
        setRelayUrl(url)
        setTranscript(src.transcript ?? null)
        // 三种状态说三种话：拿到了 / 试过但失败（原话上屏）/ 真没有
        if (src.transcript) setTranscriptNote(null)
        else if (src.transcriptError) setTranscriptNote(t('字幕获取失败：{0}', src.transcriptError))
        else setTranscriptNote(t('这条来源没有字幕：AI 字幕通常需要登录——点右上角齿轮填入 SESSDATA 后重试。'))
        setCurrentMs(0)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [busy],
  )

  const resolve = useCallback(() => void runResolve(input.trim()), [runResolve, input])

  /**
   * 批量导出合集字幕：逐条只取转录（专用通道，跳过播放地址）→ 拼一个 Markdown →
   * 原生保存对话框落盘。一条失败不炸全局（那一节写「字幕缺失：原因」）；
   * 一条条来并留 150ms 间隙，别把 B 站风控招来（86 条约一分钟，进度在动就不觉得慢）。
   */
  const exportCollection = useCallback(async () => {
    const col = source?.collection
    if (!col || exportProgress) return
    setExportProgress({ done: 0, total: col.items.length })
    const entries: CollectionExportEntry[] = []
    try {
      for (let i = 0; i < col.items.length; i++) {
        const item = col.items[i]
        const entry: CollectionExportEntry = { title: item.title, durationMs: item.durationMs, source: item.source }
        try {
          entry.transcript = await resolveTranscriptOnly(item.source, { sessdata: readSessdata() })
        } catch (err) {
          entry.error = err instanceof Error ? err.message : String(err)
        }
        entries.push(entry)
        setExportProgress({ done: i + 1, total: col.items.length })
        if (i < col.items.length - 1) await new Promise((r) => window.setTimeout(r, 150))
      }
      const md = buildCollectionMarkdown(col.name, entries)
      const safeName = col.name.replace(/[\\/:*?"<>|]/g, '_')
      const res = await native().saveText({ suggestedName: `${safeName}.md`, content: md, title: t('导出合集字幕') })
      if (!res.ok && !res.canceled) setError(res.error ?? t('导出失败'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExportProgress(null)
    }
  }, [source, exportProgress])

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
    /*
     * 跟随定位：当前段钉在可视区 20% 高度处（歌词式跟随，用户定的）。
     * contentTop 必须是「行顶在滚动内容坐标系里的位置」——用 rect 差值现算，
     * 不用 offsetTop：那是相对 offsetParent（最近的定位祖先）量的，滚动容器
     * 自己没定位时量出来的是相对更外层的偏移，落点整个错掉（踩过）。
     * 平滑滚 + 夹在内容范围内；段与段间隔几秒，每次只挪一行的量，不抖。
     */
    const contentTop = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
    const max = Math.max(0, list.scrollHeight - list.clientHeight)
    const target = Math.max(0, Math.min(max, Math.round(contentTop - list.clientHeight * 0.2)))
    if (target !== list.scrollTop) list.scrollTo({ top: target, behavior: 'smooth' })
  }, [activeIdx, transcript])

  const saveSessdata = useCallback(() => {
    // 容错：从浏览器复制时容易连「SESSDATA=」前缀或引号一起带上——剥掉再存，
    // 插件那边拼的是 `SESSDATA=${值}`，前缀混进去 cookie 就废了
    const value = sessDraft
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/^SESSDATA=/i, '')
      .trim()
    try {
      localStorage.setItem(SESSDATA_KEY, value)
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
            {t('获取：浏览器登录 B 站 → F12 → 应用（Application）→ Cookies → www.bilibili.com → 复制「SESSDATA」的值粘贴到这里。')}
            <br />
            {t('AI 字幕通常要登录后才拿得到。值只存本机（浏览器存储），随请求发给 B 站。')}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={sessDraft}
              onChange={(e) => setSessDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveSessdata()
              }}
              placeholder={t('只粘贴 Value 本身（带 SESSDATA= 前缀也能存，会自动剥掉）')}
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

      {/* 正文：上播放器（吃满剩余高度）、下 200px 字幕条；没解析过时整片是引导空态。
          「200 高」指的是**字幕列表的可视区**（用户定的），不是视频 */}
      {source && relayUrl ? (
        <>
          {/* 视频与合集同一排：视频吃剩余高度，合集列表贴右侧同高——
              点一项就地切换（重走一遍 resolve） */}
          <div className="flex min-h-0 flex-1">
            <div className="min-h-0 min-w-0 flex-1 bg-black">
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
            {source.collection && (
              <>
                {/*
                  收起/展开的开关条：常驻（收起后它是唯一入口）。图标方向 = 点击后
                  面板的去向：展开时点它收起（向右滑出 → ChevronRight），收起时点它
                  展开（向左滑回 → ChevronLeft）。
                */}
                <button
                  type="button"
                  title={collapsed ? t('展开合集列表') : t('收起合集列表')}
                  aria-expanded={!collapsed}
                  onClick={toggleCollapsed}
                  className="flex w-6 shrink-0 items-center justify-center border-l border-line bg-card/40 text-ink-soft transition hover:bg-line/60 hover:text-ink"
                >
                  {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                </button>
                {/*
                  宽度过渡（w-0 ↔ w-320）+ overflow-hidden：面板滑出/滑入。
                  内容层钉死 320px——宽度动画期间文字不许跟着重排，只许被裁掉。
                */}
                <div
                  className={
                    'shrink-0 overflow-hidden transition-[width] duration-200 ease-out ' +
                    (collapsed ? 'w-0' : 'w-[320px]')
                  }
                >
                  <div className="flex h-full w-[320px] flex-col border-l border-line bg-card/40">
                    <div className="flex shrink-0 items-center gap-1 border-b border-line/60 px-2 py-1">
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink-soft">
                        {t('合集')} · {source.collection.name}
                      </span>
                      <button
                        type="button"
                        title={
                          exportProgress
                            ? t('导出中 {0}/{1}', String(exportProgress.done), String(exportProgress.total))
                            : t('导出合集字幕（全部视频的转录合并为一个 Markdown）')
                        }
                        disabled={!!exportProgress || busy}
                        onClick={() => void exportCollection()}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-line/60 hover:text-ink disabled:opacity-50"
                      >
                        {exportProgress ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      </button>
                    </div>
                    {exportProgress && (
                      <div className="shrink-0 border-b border-line/60 px-2 py-0.5 text-[10.5px] text-ink-faint">
                        {t('导出中 {0}/{1}', String(exportProgress.done), String(exportProgress.total))}
                      </div>
                    )}
                    <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
                      {source.collection.items.map((item) => (
                        <button
                          key={item.source}
                          type="button"
                          title={item.title}
                          disabled={busy}
                          onClick={() => void runResolve(item.source)}
                          className={
                            'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition disabled:opacity-50 ' +
                            (item.current ? 'bg-seal/10' : 'hover:bg-line/50')
                          }
                        >
                          {/* 标题在前（12px），时长缀在后面——用户定的顺序 */}
                          <span
                            className={
                              'min-w-0 flex-1 truncate text-[12px] ' +
                              (item.current ? 'font-medium text-ink-strong' : 'text-ink')
                            }
                          >
                            {item.title}
                          </span>
                          <span
                            className={
                              'shrink-0 font-mono text-[10.5px] ' +
                              (item.current ? 'text-seal' : 'text-ink-faint')
                            }
                          >
                            {item.durationMs ? formatClock(item.durationMs) : '--:--'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          {/* 字幕条：高度 = 30%（用户定的）；标题行 + 列表的可视区就这么多 */}
          <div className="flex h-[30%] shrink-0 flex-col border-t border-line">
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-card/40 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-strong">{source.title}</span>
            {source.durationMs ? (
              <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">{formatClock(source.durationMs)}</span>
            ) : null}
                {transcript ? (
                  <span className="shrink-0 rounded border border-line bg-paper px-1.5 py-px text-[10px] text-ink-faint">
                    {(transcript.origin === 'subtitle' ? t('字幕') : t('语音识别')) +
                      // 语言来源跟着字幕走（ai-zh = B 站 AI 生成；zh-Hans 等是 UP 传的 CC）：
                      // 「对不上视频」这类报告，先看这一格说的是哪个来源
                      (transcript.language
                        ? ' · ' +
                          (transcript.language === 'ai-zh'
                            ? t('AI 中文字幕')
                            : /^(zh-Hans|zh-CN)$/i.test(transcript.language)
                              ? t('中文字幕')
                              : transcript.language)
                        : '')}
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
