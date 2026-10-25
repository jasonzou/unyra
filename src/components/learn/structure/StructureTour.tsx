/**
 * 节点宇宙的新手教学：画布内全屏遮罩 + SVG 挖洞聚焦，一步步指给用户看。
 *
 * 聚焦为什么用 SVG mask 而不是四块 div 拼边框：mask 里一块黑矩形把目标「抠」出来、
 * 四周半透明压暗——洞的圆角、描边与跟随都是一层图形的事，不用去对付 box-shadow 的
 * 多层 hack。每一步认一个选择器；目标不在了（比如画布上还没有节点）就整屏压暗，
 * 不空转也不跳步。
 *
 * **全部坐标都相对画布容器算**（fixed 在这棵树里会被带 transform/backdrop-filter 的
 * 祖先劫持包含块——卡片因此错位又被 pane 裁掉过一截，真错过一次）；遮罩挂在画布根上
 * absolute 铺满，量目标时减去容器的矩形，两边从此说的是同一套坐标。
 *
 * 提示卡**跟着洞走**：优先贴在洞下方（放不下换到上方），水平贴洞的视觉中心并夹回
 * 画布内；卡片限高 + 内部滚动兜底，永远不被 pane 裁掉。退出永远可达：「跳过教学」、
 * Esc、最后一步「完成」。入口在画布右下角工具组的问号按钮（见 StructureCanvas 的
 * controls），只手动触发，不记「看过没有」——想重看，再点一次问号。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../../i18n'

/** 教学的一步：selector 找得到就挖洞聚焦它，找不到就整屏压暗 */
interface TourStep {
  selector?: string
  title: string
  body: string
}

const STEPS: TourStep[] = [
  {
    title: '欢迎来到节点宇宙',
    body: '一张图画下这门课的全部节点：文档、大纲、笔记与试卷都在上面摆着。六步走完大约半分钟；想中途退出，随时按 Esc 或点「跳过教学」。',
  },
  {
    selector: '[data-tour="palette"]',
    title: '从左侧列表放节点',
    body: '按住一项拖出来：拖到空白处立一份独立节点；拖到卡上则创建即挂——文档拖到大纲卡上，笔记、试卷、超级文档拖到文档卡上。',
  },
  {
    selector: '[data-node-id]',
    title: '每张卡是一个节点',
    body: '点标题直接打开内容，按住卡片拖动摆位，右键有更多操作（设为入口、注释、删除）。摆乱了不怕，右下角一键自动排列。',
  },
  {
    selector: '[data-slot-dot]',
    title: '菱形是接口点',
    body: '大纲卡右侧的菱形接口：从空接口拖出去挂一份文档，认领那条目标项；已挂的接口可以拖到别处换绑。',
  },
  {
    selector: '[data-tour="minimap"]',
    title: '小地图就是导航',
    body: '左上角的缩略图：点哪里，镜头就去哪里，也可以按住拖。图大了全靠它找路。',
  },
  {
    selector: '[data-tour="controls"]',
    title: '工具组在这里',
    body: '缩放、切换连线样式、撤回、适应画布、自动排列。想重看本教学，随时点最右边的问号。',
  },
]

/** 挖洞时目标外扩的白边：别让描边贴着元素 */
const HOLE_PAD = 8
/** 提示卡与洞、与容器边缘的最小间距 */
const GAP = 12
/** 提示卡宽度 */
const CARD_W = 320
/** 提示卡的估高：落位只求不压住洞，差几十像素无妨 */
const CARD_EST_H = 190

export function StructureTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  /** 当前目标元素的**容器相对**矩形；目标缺席时是 null（整屏压暗） */
  const [hole, setHole] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  /** 提示卡的落点与限高（容器相对） */
  const [card, setCard] = useState<{ x: number; y: number; maxH: number }>({ x: 160, y: GAP, maxH: 400 })
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const measure = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const base = wrap.getBoundingClientRect()
    const clampX = (x: number) => Math.min(Math.max(GAP, x), Math.max(GAP, base.width - CARD_W - GAP))
    const sel = STEPS[step]?.selector
    const el = sel ? document.querySelector<HTMLElement>(sel) : null
    if (!el) {
      // 目标缺席：整屏压暗，提示卡落在画布中央
      setHole(null)
      setCard({
        x: clampX((base.width - CARD_W) / 2),
        y: Math.max(GAP, base.height / 2 - CARD_EST_H / 2),
        maxH: base.height - GAP * 2,
      })
      return
    }
    const r = el.getBoundingClientRect()
    const holeRect = {
      x: r.left - base.left - HOLE_PAD,
      y: r.top - base.top - HOLE_PAD,
      w: r.width + HOLE_PAD * 2,
      h: r.height + HOLE_PAD * 2,
    }
    setHole(holeRect)
    // 提示卡跟着洞走：优先洞下方，放不下换到上方；水平贴洞的视觉中心
    const below = holeRect.y + holeRect.h + GAP + CARD_EST_H <= base.height
    setCard({
      x: clampX(holeRect.x + holeRect.w / 2 - CARD_W / 2),
      y: below ? holeRect.y + holeRect.h + GAP : Math.max(GAP, holeRect.y - GAP - CARD_EST_H),
      maxH: base.height - GAP * 2,
    })
  }, [step])

  useEffect(() => {
    // 下一帧再量：挂载那一拍布局还在动（镜头过渡可能正在挪目标），
    // 且同步量测会让组件脱离 React Compiler 优化（见 oxlint 的 set-state-in-effect）
    const raf = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setStep((s) => Math.min(s + 1, STEPS.length - 1))
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const last = step === STEPS.length - 1

  return (
    <div ref={wrapRef} className="absolute inset-0 z-40">
      <svg className="absolute inset-0 h-full w-full">
        <defs>
          <mask id="moji-tour-mask">
            <rect width="100%" height="100%" fill="#fff" />
            {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="10" fill="#000" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(23,20,17,0.55)" mask="url(#moji-tour-mask)" />
        {hole && (
          <rect
            x={hole.x}
            y={hole.y}
            width={hole.w}
            height={hole.h}
            rx="10"
            fill="none"
            stroke="var(--color-seal, #a8432f)"
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
        )}
      </svg>

      <div
        className="absolute flex flex-col rounded-xl border border-line bg-card p-3.5 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
        style={{ left: card.x, top: card.y, width: CARD_W, maxHeight: card.maxH }}
      >
        <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-ink-strong">{t(STEPS[step].title)}</span>
          <span className="shrink-0 tabular-nums text-[10.5px] text-ink-faint">
            {step + 1} / {STEPS.length}
          </span>
        </div>
        <p className="moji-scroll-thin min-h-0 flex-1 overflow-y-auto text-[12px] leading-relaxed text-ink-soft">
          {t(STEPS[step].body)}
        </p>
        <div className="mt-3 flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-1.5 py-1 text-[11.5px] text-ink-faint transition hover:text-ink"
          >
            {t('跳过教学')}
          </button>
          <span className="flex-1" />
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="rounded-lg border border-line px-2.5 py-1 text-[11.5px] text-ink-soft transition hover:bg-line/50"
            >
              {t('上一步')}
            </button>
          )}
          <button
            type="button"
            onClick={() => (last ? onClose() : setStep(step + 1))}
            className="rounded-lg bg-ink px-3 py-1 text-[11.5px] font-medium text-paper transition hover:bg-ink-strong"
          >
            {last ? t('完成') : t('下一步')}
          </button>
        </div>
      </div>
    </div>
  )
}
