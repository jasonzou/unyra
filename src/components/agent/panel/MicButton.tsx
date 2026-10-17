/**
 * 输入框里的麦克风按钮与实时语音识别输入浮窗。
 *
 * 交互与视觉规范：
 * 1. 点按话筒开始实时录音与流式识别，话筒变为红晕呼吸态；
 * 2. 录音时上方弹出毛玻璃实时识别浮窗，展示跳动声波、时长、实时转写文字流与操作按钮；
 * 3. 敲空格、回车或点「完成」立即收尾并把最终文字插入光标处；
 * 4. 敲 Esc 或点「取消」丢弃本段录音；
 * 5. 错误提示可自关闭，不遮挡输入区。
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Check, Loader2, X } from 'lucide-react'
import {
  cancelRecording,
  clearVoiceMessage,
  setVoiceSink,
  startRecording,
  stopRecording,
  subscribeVoice,
  voiceState,
} from '../../../lib/voice/session'
import { voicePluginOn } from '../../../lib/voice/plugin'
import { t } from '../../../i18n'

/** 话筒：一个圆角矩形的话筒头 + 一道托架弧 + 一根立杆。24 的网格里画，按 size 缩 */
function MicGlyph({ size, filled }: { size: number; filled: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 18v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8.5 21h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function clock(seconds: number): string {
  const s = Math.floor(seconds)
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

const subscribe = (cb: () => void) => subscribeVoice(cb)

interface Props {
  /** 识别出来的文字：调用方插进输入框（见 Composer 的 editorRef） */
  onText: (text: string) => void
}

export default function MicButton({ onText }: Props) {
  const state = useSyncExternalStore(subscribe, voiceState)
  const recording = state.phase === 'recording'
  const working = state.phase === 'working'
  const hasError = state.phase === 'error' && !!state.message

  const btnWrapRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null)

  // 结果交回输入框；组件卸载时注销，免得文字落到一个已经不在的输入框上
  useEffect(() => {
    setVoiceSink(onText)
    return () => setVoiceSink(null)
  }, [onText])

  useLayoutEffect(() => {
    if (!recording || !btnWrapRef.current) return
    const rect = btnWrapRef.current.getBoundingClientRect()
    setPos({
      right: Math.max(12, window.innerWidth - rect.right - 10),
      bottom: Math.max(12, window.innerHeight - rect.top + 10),
    })
  }, [recording])

  /**
   * 录音期间快捷键：空格或回车结束、Esc 取消。
   * 用捕获阶段并阻止默认：防止击键打进编辑器引发冲突。
   */
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault()
        e.stopPropagation()
        void stopRecording()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelRecording()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  if (!voicePluginOn()) return null

  const title = recording
    ? t('正在录音（{0}）——按空格/回车或再点一下完成，Esc 取消', clock(state.seconds))
    : working
      ? t('识别处理中…')
      : t('语音实时输入：点一下开始，实时边说边出字')

  return (
    <div ref={btnWrapRef} className="relative">
      {/* 报错小弹条 */}
      {hasError && (
        <div className="absolute bottom-full right-0 mb-2 z-50 flex w-[280px] items-start gap-2 rounded-xl border border-warn/40 bg-card/95 p-2.5 text-[11px] leading-snug text-ink shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-md">
          <span className="flex-1 text-warn">{state.message}</span>
          <button
            type="button"
            onClick={clearVoiceMessage}
            className="shrink-0 p-0.5 text-ink-faint hover:text-ink transition"
            title={t('关闭')}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* 实时录音与流式识别浮窗 */}
      {recording && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              right: pos.right,
              bottom: pos.bottom,
              zIndex: 90,
            }}
            className="w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-line-strong bg-card/95 backdrop-blur-md shadow-[0_16px_48px_rgba(0,0,0,0.22)] transition-all moji-bloom-up-in"
          >
            {/* 顶栏：指示点 + 状态 + 跳动声波 + 计时 */}
            <div className="flex items-center justify-between border-b border-line bg-paper-deep/60 px-3.5 py-2">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-seal opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-seal" />
                </span>
                <span className="text-[12px] font-medium text-ink-strong">{t('实时语音输入')}</span>
                <span className="font-mono text-[11px] tabular-nums text-ink-faint">
                  {clock(state.seconds)}
                </span>
              </div>

              {/* 随音量起伏跳动的声波柱（根据实时电平计算高度） */}
              <div className="flex items-center gap-1 h-3.5 px-1">
                {[0.6, 1.2, 0.9, 1.5, 0.7].map((factor, i) => {
                  const h = Math.max(3, Math.min(14, (state.level * 28 + 3) * factor))
                  return (
                    <span
                      key={i}
                      className="w-[2.5px] rounded-full bg-seal transition-[height] duration-75"
                      style={{ height: `${h}px` }}
                    />
                  )
                })}
              </div>
            </div>

            {/* 识别文本流式实时展示 */}
            <div className="min-h-[64px] max-h-[140px] overflow-y-auto px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-strong">
              {state.interimText ? (
                <p className="whitespace-pre-wrap break-words">
                  {state.interimText}
                  <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-seal align-middle" />
                </p>
              ) : (
                <div className="flex items-center gap-2 text-ink-faint text-[12px] py-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-seal animate-pulse" />
                  <span>{t('正在倾听并实时识别…')}</span>
                </div>
              )}
            </div>

            {/* 底栏：操作提示与按钮 */}
            <div className="flex items-center justify-between border-t border-line bg-paper-deep/30 px-3 py-2">
              <span className="text-[10.5px] text-ink-faint">
                {t('空格 / 回车完成 · Esc 取消')}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => cancelRecording()}
                  className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-ink-soft hover:bg-line/60 hover:text-ink transition"
                  title={t('丢弃当前录音（Esc）')}
                >
                  <X size={13} />
                  <span>{t('取消')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void stopRecording()}
                  className="flex h-7 items-center gap-1 rounded-lg bg-seal px-2.5 text-[11px] font-medium text-white shadow-sm hover:bg-seal-deep transition"
                  title={t('完成并填入输入框（空格）')}
                >
                  <Check size={13} />
                  <span>{t('完成')}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 话筒主按钮 */}
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-pressed={recording}
        onClick={() => {
          if (recording) {
            void stopRecording()
            return
          }
          if (working) return
          clearVoiceMessage()
          void startRecording()
        }}
        className={
          'relative flex h-8 w-8 items-center justify-center rounded-lg transition ' +
          (recording
            ? 'bg-seal/15 text-seal ring-2 ring-seal/40 shadow-sm'
            : working
              ? 'text-ink-faint'
              : 'text-ink-soft hover:bg-line/40 hover:text-seal')
        }
      >
        {working ? (
          <Loader2 size={15} className="animate-spin text-ink-faint" />
        ) : (
          <MicGlyph size={15} filled={recording} />
        )}
      </button>
    </div>
  )
}
