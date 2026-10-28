/**
 * 思考档位调节器（Codex 风格能量微粒滑块）：
 * 沿圆角胶囊能量管以 5 档推理强度（无 / 低 / 中 / 高 / 最大）切换，
 * 内部带有微粒气泡浮动效果与能量渐变，随档位动态切换主题色：
 * 无档中性灰、低档薄荷绿、中档琥珀金、高档紫罗兰、最大档印章红。
 * 纯白圆钮随档位平滑吸附，支持拖拽、点击与方向键调节。
 */
import { useRef } from 'react'
import {
  REASONING_EFFORTS,
  REASONING_HINT,
  REASONING_LABEL,
  type ReasoningEffort,
} from '../../ai/types'
import { t } from '../../i18n'

interface EffortVisual {
  color: string
  glow: string
  gradient: string
  particleGlow: string
}

/**
 * 思考档位视觉参数：随档位动态切换能量液管渐变与发光
 */
const EFFORT_VISUALS: Record<ReasoningEffort, EffortVisual> = {
  none: {
    color: '#94a3b8',
    glow: 'rgba(148, 163, 184, 0.35)',
    gradient: 'linear-gradient(90deg, #475569 0%, #64748b 50%, #94a3b8 100%)',
    particleGlow: 'rgba(255, 255, 255, 0.4)',
  },
  low: {
    color: '#10b981',
    glow: 'rgba(16, 185, 129, 0.45)',
    gradient: 'linear-gradient(90deg, #059669 0%, #10b981 50%, #34d399 100%)',
    particleGlow: 'rgba(52, 211, 153, 0.7)',
  },
  medium: {
    color: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.45)',
    gradient: 'linear-gradient(90deg, #d97706 0%, #f59e0b 50%, #fbbf24 100%)',
    particleGlow: 'rgba(251, 191, 36, 0.7)',
  },
  high: {
    color: '#8b5cf6',
    glow: 'rgba(139, 92, 246, 0.5)',
    gradient: 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
    particleGlow: 'rgba(168, 85, 247, 0.7)',
  },
  max: {
    color: '#a8432f',
    glow: 'rgba(168, 67, 47, 0.55)',
    gradient: 'linear-gradient(90deg, #8c3524 0%, #a8432f 50%, #e11d48 100%)',
    particleGlow: 'rgba(244, 63, 94, 0.7)',
  },
}

interface Particle {
  id: number
  x: number // 百分比 0 ~ 100
  y: number // 百分比 15 ~ 85
  size: number // 直径 px
  opacity: number
  duration: number // 浮动周期秒数
  delay: number // 延迟秒数
}

/** 能量液管内部分布的气泡微粒（与参考设计同构的有机分布） */
const PARTICLES: Particle[] = [
  { id: 1, x: 6, y: 55, size: 2.2, opacity: 0.45, duration: 2.6, delay: 0 },
  { id: 2, x: 11, y: 28, size: 3.4, opacity: 0.7, duration: 3.1, delay: 0.4 },
  { id: 3, x: 16, y: 68, size: 2.4, opacity: 0.55, duration: 2.8, delay: 0.8 },
  { id: 4, x: 26, y: 38, size: 3.8, opacity: 0.65, duration: 3.4, delay: 0.2 },
  { id: 5, x: 33, y: 72, size: 2.2, opacity: 0.45, duration: 2.5, delay: 1.1 },
  { id: 6, x: 44, y: 30, size: 3.0, opacity: 0.7, duration: 3.0, delay: 0.6 },
  { id: 7, x: 49, y: 22, size: 2.4, opacity: 0.5, duration: 2.7, delay: 1.4 },
  { id: 8, x: 50, y: 45, size: 3.6, opacity: 0.75, duration: 3.2, delay: 0.3 },
  { id: 9, x: 52, y: 76, size: 3.2, opacity: 0.6, duration: 2.9, delay: 0.9 },
  { id: 10, x: 65, y: 48, size: 4.0, opacity: 0.7, duration: 3.3, delay: 0.5 },
  { id: 11, x: 74, y: 26, size: 3.4, opacity: 0.65, duration: 2.8, delay: 1.2 },
  { id: 12, x: 78, y: 64, size: 2.4, opacity: 0.5, duration: 3.0, delay: 0.7 },
  { id: 13, x: 84, y: 42, size: 3.6, opacity: 0.7, duration: 2.6, delay: 1.5 },
  { id: 14, x: 92, y: 34, size: 2.8, opacity: 0.65, duration: 3.5, delay: 0.1 },
]

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
  const visual = EFFORT_VISUALS[value]

  /** 指针拖拽或点击：按百分比吸附到最接近的刻度档位 */
  const pickAt = (clientX: number) => {
    const el = ref.current
    if (!el) return
    const box = el.getBoundingClientRect()
    if (!box.width) return
    const ratio = (clientX - box.left) / box.width
    const i = Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1))))
    const next = levels[i]
    if (next && next !== value) onChange(next)
  }

  const step = (delta: number) => {
    const next = levels[Math.min(n - 1, Math.max(0, index + delta))]
    if (next && next !== value) onChange(next)
  }

  // 当前进度百分比 0 ~ 100%
  const pct = (index / (n - 1)) * 100

  // 滑块圆钮直径（像素）：根据紧凑态适配
  const thumbSize = compact ? 18 : 22
  // 滑块圆钮左侧位移（确保 0% 靠齐最左端、100% 靠齐最右端，无任何溢出或挤压）
  const thumbLeft = `calc(${pct}% - ${(pct / 100) * thumbSize}px)`
  // 填充条宽度（与滑块右边界完全契合连接）
  const fillWidth = `calc(${pct}% + ${(1 - pct / 100) * thumbSize}px)`

  return (
    <div className={`flex flex-col ${compact ? 'gap-1.5' : 'gap-2'} select-none ${className}`}>
      {/* 能量胶囊滑动轨道 */}
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
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            step(-1)
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            step(1)
          }
        }}
        className={`group relative flex select-none touch-none cursor-pointer items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-seal/40 bg-[#24211e] dark:bg-[#141210] border border-black/25 dark:border-white/10 shadow-[inset_0_1.5px_3.5px_rgba(0,0,0,0.45)] transition-colors duration-200 ${
          compact ? 'h-[18px]' : 'h-[22px]'
        }`}
      >
        {/* 内部能量液与气泡粒子层：保持全轨连续性，通过 clip-path 随滑块平滑展开 */}
        <div
          className="absolute inset-0 rounded-full transition-all duration-200 ease-out overflow-hidden"
          style={{
            background: visual.gradient,
            boxShadow: `0 0 12px ${visual.glow}, inset 0 1px 1px rgba(255, 255, 255, 0.3)`,
            clipPath: `inset(0 calc(100% - ${fillWidth}) 0 0 round 9999px)`,
          }}
        >
          {PARTICLES.map((p) => (
            <span
              key={p.id}
              className="moji-energy-bubble absolute rounded-full pointer-events-none"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: `${compact ? Math.max(1.5, p.size * 0.8) : p.size}px`,
                height: `${compact ? Math.max(1.5, p.size * 0.8) : p.size}px`,
                backgroundColor: '#ffffff',
                opacity: p.opacity,
                boxShadow: `0 0 3px ${visual.particleGlow}`,
                animationDuration: `${p.duration}s`,
                animationDelay: `${p.delay}s`,
              }}
            />
          ))}
        </div>

        {/* 纯白滑块圆钮 Thumb（微宝石质感纯白圆球，带立体阴影） */}
        <div
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.42)] ring-1 ring-black/10 transition-all duration-200 ease-out z-10"
          style={{
            left: thumbLeft,
            width: `${thumbSize}px`,
            height: `${thumbSize}px`,
          }}
        />
      </div>

      {/* 刻度下方档位名称列表 */}
      <div className="relative flex w-full justify-between items-center px-0.5">
        {levels.map((e) => {
          const isSelected = e === value
          const itemVisual = EFFORT_VISUALS[e]
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
                  ? 'font-semibold'
                  : 'font-normal text-ink-faint hover:text-ink'
              }`}
              style={isSelected ? { color: itemVisual.color } : undefined}
            >
              {REASONING_LABEL[e]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
