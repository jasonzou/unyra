/**
 * 思考档位调节器（Codex 风格刻度滑块）：
 * 沿水平轨道以刻度点（Tick Marks）划分 5 档推理强度（无 / 低 / 中 / 高 / 最大），
 * 支持平滑拖拽吸附、点击刻度直达与方向键微调。
 */
import { useRef } from 'react'
import {
  REASONING_EFFORTS,
  REASONING_HINT,
  REASONING_LABEL,
  type ReasoningEffort,
} from '../../ai/types'
import { t } from '../../i18n'

/**
 * 思考档位视觉强调色：雅致的微宝石质感色调（中性灰 → 薄荷绿 → 暖琥珀金 → 深入紫罗兰 → 极致珊瑚红）
 */
const EFFORT_ACCENTS: Record<ReasoningEffort, { dot: string; glow: string }> = {
  none: { dot: '#94a3b8', glow: 'rgba(148, 163, 184, 0.35)' },
  low: { dot: '#10b981', glow: 'rgba(16, 185, 129, 0.35)' },
  medium: { dot: '#f59e0b', glow: 'rgba(245, 158, 11, 0.35)' },
  high: { dot: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.35)' },
  max: { dot: '#f43f5e', glow: 'rgba(244, 63, 94, 0.35)' },
}

interface Props {
  value: ReasoningEffort
  onChange: (e: ReasoningEffort) => void
  /** 紧凑态：菜单浮层里用 */
  compact?: boolean
  className?: string
}

export default function EffortSlider({ value, onChange, compact = false, className = '' }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const levels = REASONING_EFFORTS
  const n = levels.length
  const index = Math.max(0, levels.indexOf(value))
  const accent = EFFORT_ACCENTS[value]

  /** 指针拖拽或点击：直接按百分比吸附到最接近的刻度档位 */
  const pickAt = (clientX: number) => {
    const el = ref.current
    if (!el) return
    const box = el.getBoundingClientRect()
    if (!box.width) return
    const ratio = (clientX - box.left) / box.width
    const i = Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1))))
    const next = levels[i]
    if (next !== value) onChange(next)
  }

  const step = (delta: number) => {
    const next = levels[Math.min(n - 1, Math.max(0, index + delta))]
    if (next && next !== value) onChange(next)
  }

  // 当前进度百分比 0 ~ 100%
  const pct = (index / (n - 1)) * 100

  return (
    <div className={`flex flex-col ${compact ? 'gap-1.5' : 'gap-2.5'} select-none ${className}`}>
      {/* 刻度滑动轨道区域 */}
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={t('思考等级')}
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={index}
        aria-valuetext={REASONING_LABEL[value]}
        title={t('思考等级：{0}（{1}）', REASONING_LABEL[value], t(REASONING_HINT[value]))}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pickAt(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) pickAt(e.clientX)
        }}
        onPointerUp={(e) => {
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            // ignore
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            step(-1)
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            step(1)
          }
        }}
        className={`group relative flex cursor-pointer touch-none items-center outline-none focus-visible:ring-2 focus-visible:ring-seal/40 rounded-full ${
          compact ? 'h-5 py-1' : 'h-6 py-1.5'
        }`}
      >
        {/* 背景滑轨 */}
        <div className="relative h-1.5 w-full rounded-full bg-line/80 dark:bg-white/15">
          {/* 激活的高亮填充进度条 */}
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-150 ease-out"
            style={{
              width: `${pct}%`,
              backgroundColor: accent.dot,
              boxShadow: `0 0 8px ${accent.glow}`,
            }}
          />

          {/* 刻度节点 Ticks */}
          {levels.map((e, i) => {
            const isPassed = i <= index
            const isCurrent = i === index
            const tickPct = (i / (n - 1)) * 100
            return (
              <span
                key={e}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150 pointer-events-none"
                style={{
                  left: `${tickPct}%`,
                  width: isCurrent ? 8 : 5,
                  height: isCurrent ? 8 : 5,
                  backgroundColor: isCurrent ? accent.dot : isPassed ? accent.dot : undefined,
                  boxShadow: isCurrent ? `0 0 6px ${accent.glow}` : undefined,
                }}
                {...(!isCurrent && !isPassed ? { className: 'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150 pointer-events-none bg-line-strong/60 dark:bg-white/25 w-1.5 h-1.5' } : {})}
              />
            )
          })}
        </div>

        {/* 可拖拽的滑块 Thumb (Codex 风格微宝石圆钮) */}
        <div
          className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full border border-black/15 bg-card shadow-[0_2px_6px_rgba(0,0,0,0.18)] transition-all duration-150 ease-out dark:border-white/25 dark:bg-elevated group-hover:scale-110 ${
            compact ? 'h-4 w-4' : 'h-5 w-5'
          }`}
          style={{
            left: `${pct}%`,
          }}
        >
          <span
            className="rounded-full transition-colors duration-150"
            style={{
              width: compact ? 6 : 7,
              height: compact ? 6 : 7,
              backgroundColor: accent.dot,
              boxShadow: `0 0 5px ${accent.glow}`,
            }}
          />
        </div>
      </div>

      {/* 刻度下方档位名称列表 */}
      <div className="relative flex w-full justify-between items-center px-0.5">
        {levels.map((e) => {
          const isSelected = e === value
          const levelAccent = EFFORT_ACCENTS[e]
          return (
            <button
              key={e}
              type="button"
              tabIndex={-1}
              onClick={(ev) => {
                ev.stopPropagation()
                onChange(e)
              }}
              className={`text-center leading-none transition-colors duration-150 cursor-pointer ${
                compact ? 'text-[10px]' : 'text-[11px]'
              } ${
                isSelected
                  ? 'font-semibold text-ink-strong'
                  : 'font-normal text-ink-faint hover:text-ink'
              }`}
              style={isSelected ? { color: levelAccent.dot } : undefined}
            >
              {REASONING_LABEL[e]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
