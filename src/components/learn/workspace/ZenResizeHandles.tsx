import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useZenMode } from '../../../learn/zen'
import { t } from '../../../i18n'

/**
 * 纯净阅读模式下挂载在正文直接容器（.doc-measure）内部的可拖拽虚线边框。
 *
 * 位于满宽溢出滚动容器（overflow-y-auto）内部，边框跟随正文列自适应延伸；
 * 左右两边均可拖拽并镜像对称调整正文列宽度。
 * 拖拽过程直接修改 CSS 变量 `--zen-width` 并更新悬浮指示 HUD，不触发 React 重渲染，保证 60fps 丝滑跟手。
 */
export default function ZenResizeHandles() {
  const isZen = useZenMode()
  const [dragging, setDragging] = useState(false)
  const [hudWidth, setHudWidth] = useState(860)
  const hudRef = useRef<HTMLSpanElement | null>(null)
  const dragRef = useRef<{
    side: 'left' | 'right'
    startX: number
    startWidth: number
    currentWidth: number
  } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent, side: 'left' | 'right') => {
    e.preventDefault()
    e.stopPropagation()

    const rawVal = getComputedStyle(document.documentElement).getPropertyValue('--zen-width')
    let currentW = parseInt(rawVal, 10)
    if (!Number.isFinite(currentW) || currentW < 480) {
      try {
        const saved = localStorage.getItem('moji:zen-width')
        if (saved) currentW = parseInt(saved, 10)
      } catch {}
    }
    if (!Number.isFinite(currentW) || currentW < 480) currentW = 860

    dragRef.current = {
      side,
      startX: e.clientX,
      startWidth: currentW,
      currentWidth: currentW,
    }
    setHudWidth(currentW)
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return

    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const onPointerMove = (e: PointerEvent) => {
      const state = dragRef.current
      if (!state) return

      const delta = e.clientX - state.startX
      const mult = state.side === 'right' ? 2 : -2
      const maxW = Math.max(480, window.innerWidth - 32)
      const nextW = Math.min(maxW, Math.max(480, Math.round(state.startWidth + delta * mult)))

      state.currentWidth = nextW
      document.documentElement.style.setProperty('--zen-width', `${nextW}px`)
      if (hudRef.current) {
        hudRef.current.textContent = `${nextW}px`
      }
    }

    const onPointerUp = () => {
      const state = dragRef.current
      if (state) {
        try {
          localStorage.setItem('moji:zen-width', String(state.currentWidth))
        } catch {}
      }
      dragRef.current = null
      setDragging(false)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
  }, [dragging])

  if (!isZen) return null

  return (
    <>
      {/* 左侧可拖拽虚线手柄 */}
      <div
        onPointerDown={(e) => onPointerDown(e, 'left')}
        className="group/zen-l absolute -left-3 top-0 bottom-0 z-20 w-6 cursor-ew-resize select-none flex items-center justify-center"
        title={t('拖拽调整阅读宽度（镜像对称）')}
      >
        <div
          className={`h-full w-0 border-l border-dashed transition-colors ${
            dragging ? 'border-seal' : 'border-line-strong/60 group-hover/zen-l:border-seal'
          }`}
        />
      </div>

      {/* 右侧可拖拽虚线手柄 */}
      <div
        onPointerDown={(e) => onPointerDown(e, 'right')}
        className="group/zen-r absolute -right-3 top-0 bottom-0 z-20 w-6 cursor-ew-resize select-none flex items-center justify-center"
        title={t('拖拽调整阅读宽度（镜像对称）')}
      >
        <div
          className={`h-full w-0 border-r border-dashed transition-colors ${
            dragging ? 'border-seal' : 'border-line-strong/60 group-hover/zen-r:border-seal'
          }`}
        />
      </div>

      {/* 拖拽时的全屏遮罩与 HUD 指示器 */}
      {dragging &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[99] cursor-ew-resize select-none" />
            <div className="pointer-events-none fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-lg border border-line-strong bg-card/95 px-3 py-1.5 shadow-[0_8px_24px_rgba(31,27,23,0.18)] text-[12px] tabular-nums text-ink-strong backdrop-blur-xs">
              <span className="text-ink-faint">{t('纯净阅读宽度')}</span>
              <span ref={hudRef} className="font-semibold text-seal">
                {hudWidth}px
              </span>
            </div>
          </>,
          document.body,
        )}
    </>
  )
}
