/**
 * 这个文件负责什么：**结构画布**——无限画布上的类型化节点图（页签 kind 'outline' 的新形态）。
 *
 * ## 与旧大纲页（MindmapView）的根本差别
 *
 * 旧页是一棵树：位置由布局算法算，用户只能看。这里每个节点是独立实体，位置由用户拖、
 * 存在 `structure.json` 里；连线也由用户连，规则由 `learn/structure` 的规则表说了算。
 * 所以这个组件里没有「布局」，只有「相机 + 拖动 + 连线」。
 *
 * ## 一条纪律：几何计算全在领域层
 *
 * 包围盒、缩放下限、卡片尺寸、命中矩形、连线规则，全部来自 `learn/structure` 与
 * `structureView`。组件只负责把指针事件翻译成「谁的坐标变了」「连了哪两个」，
 * 一旦在这里就地算一遍，就会出现「拖动时按 200 宽算、画的时候是 208」这类对不上的 bug。
 *
 * ## 为什么所有指针事件都挂在容器上
 *
 * 拖动与连线都要跨元素：从一张卡拖到另一张、从左侧列表拖进画布。子元素各挂一套
 * pointerdown/move/up 会在跨越边界时丢事件。这里用**容器捕获指针 + 几何命中测试**
 * （hitTest），指针在谁身上都不影响判断。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LearnStore } from '../../../learn/types'
import {
  CARD_H,
  CARD_W,
  boundsOf,
  canAddEdge,
  centerPan,
  clampZoom,
  fitZoom,
  type GraphKind,
  type StructureMap,
  type StructureNode,
  type ViewSize,
} from '../../../learn/structure'
import { structureFromStore } from '../../../learn/structureSeed'
import { GRAPH_KIND_LABEL } from '../../../learn/structure'
import { t } from '../../../i18n'
import { KIND_BADGE, KIND_TONE, edgeAt, edgeCurve, edgePathD, hitTest, resolveNodeView } from './structureView'

export interface StructureCanvasProps {
  store: LearnStore
  /** 这一页属于哪个目标 */
  goalId: string
  /** 图变了（上层写进 store 并落盘） */
  onChange: (next: StructureMap) => void
  /** 双击有内容的节点：打开它（大纲 / 教学文档） */
  onOpenNode: (nodeId: string) => void
  /** 双击空节点：交给上层去生成内容（这一版还没接，先提示） */
  onFillNode?: (node: StructureNode) => void
  onToast?: (msg: string) => void
  /** 外部指定的聚焦目标（chip 路由）：把镜头挪到 ref 对得上的那个节点 */
  focusTarget?: { nodeId: string; nonce: number } | null
  onFocusHandled?: () => void
}

const EMPTY: StructureMap = { version: 1, nodes: [], edges: [] }

/** 从左侧列表拖出来时，那几张卡（顺序即层级，见 GRAPH_EDGE_RULES） */
const PALETTE: GraphKind[] = ['outline', 'doc', 'note', 'exam', 'superdoc']

type Gesture =
  | { mode: 'pan'; startX: number; startY: number; camX: number; camY: number }
  | { mode: 'node'; id: string; grabX: number; grabY: number; origX: number; origY: number; moved: boolean }
  | { mode: 'link'; from: string }
  | { mode: 'palette'; kind: GraphKind }
  | null

export const StructureCanvas = memo(function StructureCanvas({
  store,
  goalId,
  onChange,
  onOpenNode,
  onFillNode,
  onToast,
  focusTarget,
  onFocusHandled,
}: StructureCanvasProps) {
  const map = store.structure?.[goalId] ?? EMPTY
  const nodes = map.nodes
  const edges = map.edges

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<ViewSize>({ width: 0, height: 0 })
  const [camera, setCamera] = useState({ x: 72, y: 72, zoom: 1 })
  const cameraRef = useRef(camera)
  useEffect(() => {
    cameraRef.current = camera
  }, [camera])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 选中的连线（点线选中，Delete 断开）。节点与连线同时只选一个 */
  const [selectedEdge, setSelectedEdge] = useState<{ from: string; to: string } | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  /** 拖动中的节点位置（只在本地，松手才写回 store） */
  const [draft, setDraft] = useState<{ id: string; x: number; y: number } | null>(null)
  /** 连线中的起点与指针位置（世界坐标）：画那条跟手的线 */
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [linkAt, setLinkAt] = useState<{ x: number; y: number } | null>(null)
  /** 从列表拖出来的那一下：指针的屏幕坐标 */
  const [paletteAt, setPaletteAt] = useState<{ x: number; y: number } | null>(null)
  const [paletteKind, setPaletteKind] = useState<GraphKind | null>(null)

  const gestureRef = useRef<Gesture>(null)
  const seededRef = useRef(false)
  const fittedRef = useRef(false)

  const bounds = useMemo(() => boundsOf(nodes), [nodes])

  /* ---------- 视口尺寸（缩放的下限要靠它算） ---------- */

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setView({ width: rect.width, height: rect.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ---------- 第一次进来：没有图就先铺一张 ---------- */

  useEffect(() => {
    if (seededRef.current) return
    if (nodes.length) {
      seededRef.current = true
      return
    }
    const seeded = structureFromStore(store, goalId)
    if (!seeded.nodes.length) return
    seededRef.current = true
    onChange(seeded)
  }, [nodes.length, store, goalId, onChange])

  /* ---------- 有图但还没对过镜头：先「适应画布」一次 ---------- */

  const fit = useCallback(() => {
    const box = boundsOf(nodes)
    if (!box || !view.width || !view.height) return
    const zoom = fitZoom(box, view)
    setCamera({ ...centerPan(box, view, zoom), zoom })
  }, [nodes, view])

  useEffect(() => {
    if (fittedRef.current) return
    if (!view.width || !bounds) return
    fittedRef.current = true
    fit()
  }, [view.width, bounds, fit])

  /* ---------- 外部聚焦（chip 路由）：把镜头挪过去 ---------- */

  const lastFocusNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!focusTarget || focusTarget.nonce === lastFocusNonce.current) return
    lastFocusNonce.current = focusTarget.nonce
    const target =
      nodes.find((n) => n.kind === 'outline' && n.ref === focusTarget.nodeId) ??
      nodes.find((n) => n.ref === focusTarget.nodeId)
    if (target && view.width) {
      const zoom = Math.max(cameraRef.current.zoom, 1)
      setCamera({ ...centerPan({ x: target.x, y: target.y, width: CARD_W, height: CARD_H }, view, zoom), zoom })
      setSelectedId(target.id)
    }
    onFocusHandled?.()
  }, [focusTarget, nodes, view, onFocusHandled])

  /* ---------- 滚轮：平移为主，Ctrl/⌘ + 滚轮缩放（与旧导图一致） ---------- */

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cam = cameraRef.current
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const px = e.clientX - rect.left
        const py = e.clientY - rect.top
        // 缩放收进 [动态下限, 固定上限]：下限由内容包围盒算，见 learn/structure
        const next = clampZoom(cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08), boundsOf(nodes), view)
        if (next === cam.zoom) return
        const k = next / cam.zoom
        setCamera({ x: px - (px - cam.x) * k, y: py - (py - cam.y) * k, zoom: next })
        return
      }
      setCamera({ ...cam, x: cam.x - e.deltaX, y: cam.y - e.deltaY })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [nodes, view])

  /* ---------- 坐标换算 ---------- */

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    const cam = cameraRef.current
    const rect = el?.getBoundingClientRect()
    const left = rect?.left ?? 0
    const top = rect?.top ?? 0
    return { x: (clientX - left - cam.x) / cam.zoom, y: (clientY - top - cam.y) / cam.zoom }
  }, [])

  /* ---------- 写回 ---------- */

  const commitNodes = useCallback(
    (next: StructureNode[]) => {
      onChange({ version: 1, nodes: next, edges })
    },
    [edges, onChange],
  )

  const addEdge = useCallback(
    (from: string, to: string) => {
      if (!canAddEdge(nodes, edges, from, to)) return false
      onChange({ version: 1, nodes, edges: [...edges, { from, to }] })
      return true
    },
    [nodes, edges, onChange],
  )

  const removeNode = useCallback(
    (id: string) => {
      const next = nodes.filter((n) => n.id !== id)
      onChange({ version: 1, nodes: next, edges: edges.filter((e) => e.from !== id && e.to !== id) })
      setSelectedId(null)
    },
    [nodes, edges, onChange],
  )

  /* ---------- 指针 ---------- */

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      const el = containerRef.current
      if (!el) return
      el.setPointerCapture(e.pointerId)

      const paletteEl = target.closest<HTMLElement>('[data-palette-kind]')
      if (paletteEl) {
        const kind = paletteEl.dataset.paletteKind as GraphKind
        gestureRef.current = { mode: 'palette', kind }
        setPaletteKind(kind)
        setPaletteAt({ x: e.clientX, y: e.clientY })
        return
      }

      const handleEl = target.closest<HTMLElement>('[data-link-handle]')
      if (handleEl) {
        const from = handleEl.dataset.linkHandle as string
        gestureRef.current = { mode: 'link', from }
        setLinkFrom(from)
        setLinkAt(toWorld(e.clientX, e.clientY))
        setSelectedId(from)
        return
      }

      const cardEl = target.closest<HTMLElement>('[data-node-id]')
      if (cardEl) {
        const id = cardEl.dataset.nodeId as string
        const node = nodes.find((n) => n.id === id)
        if (!node) return
        const world = toWorld(e.clientX, e.clientY)
        setSelectedId(id)
        setSelectedEdge(null)
        gestureRef.current = { mode: 'node', id, grabX: world.x, grabY: world.y, origX: node.x, origY: node.y, moved: false }
        return
      }

      // 点在连线上：选中它（Delete 可断开），不进入平移
      const world = toWorld(e.clientX, e.clientY)
      const edge = edgeAt(nodes, edges, world.x, world.y, 8 / cameraRef.current.zoom)
      if (edge) {
        setSelectedEdge(edge)
        setSelectedId(null)
        return
      }
      const cam = cameraRef.current
      gestureRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y }
      setSelectedId(null)
      setSelectedEdge(null)
    },
    [edges, nodes, toWorld],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gestureRef.current
      if (!g) return
      if (g.mode === 'pan') {
        setCamera((c) => ({ ...c, x: g.camX + (e.clientX - g.startX), y: g.camY + (e.clientY - g.startY) }))
        return
      }
      const world = toWorld(e.clientX, e.clientY)
      if (g.mode === 'node') {
        const dx = world.x - g.grabX
        const dy = world.y - g.grabY
        if (!g.moved && Math.abs(dx) + Math.abs(dy) < 2) return
        g.moved = true
        setDraft({ id: g.id, x: g.origX + dx, y: g.origY + dy })
        return
      }
      if (g.mode === 'link') {
        setLinkAt(world)
        setHoverId(hitTest(nodes, world.x, world.y)?.id ?? null)
        return
      }
      setPaletteAt({ x: e.clientX, y: e.clientY })
      setHoverId(hitTest(nodes, world.x, world.y)?.id ?? null)
    },
    [nodes, toWorld],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gestureRef.current
      gestureRef.current = null
      const el = containerRef.current
      if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (!g) return

      if (g.mode === 'node') {
        if (draft && draft.id === g.id && g.moved) {
          commitNodes(nodes.map((n) => (n.id === draft.id ? { ...n, x: draft.x, y: draft.y } : n)))
        }
        setDraft(null)
        return
      }

      if (g.mode === 'link') {
        const world = toWorld(e.clientX, e.clientY)
        const target = hitTest(nodes, world.x, world.y)
        if (target && target.id !== g.from && !addEdge(g.from, target.id)) {
          onToast?.(t('这两个节点不能这样连：下游不能回流，笔记/试卷/超级文档只能挂在文档下面'))
        }
        setLinkFrom(null)
        setLinkAt(null)
        setHoverId(null)
        return
      }

      if (g.mode === 'palette') {
        const world = toWorld(e.clientX, e.clientY)
        const target = hitTest(nodes, world.x, world.y)
        const node: StructureNode = {
          id: crypto.randomUUID(),
          kind: g.kind,
          // 落在卡片上就摆在它右边一列；落在空白处就落在指针位置
          x: target ? target.x + CARD_W + 96 : world.x - CARD_W / 2,
          y: target ? target.y : world.y - CARD_H / 2,
        }
        const nextNodes = [...nodes, node]
        const nextEdges = [...edges]
        // 落在卡片上 = 顺手接上（用户不用再拖一条线）；落在空白处就是孤儿节点
        if (target && canAddEdge(nextNodes, nextEdges, target.id, node.id)) {
          nextEdges.push({ from: target.id, to: node.id })
        }
        onChange({ version: 1, nodes: nextNodes, edges: nextEdges })
        setSelectedId(node.id)
        setPaletteAt(null)
        setPaletteKind(null)
        setHoverId(null)
        onToast?.(t('空节点：它还没有内容，挂上父节点之后由它自己决定生成什么'))
      }
    },
    [addEdge, commitNodes, draft, edges, nodes, onChange, onToast, toWorld],
  )

  /* ---------- 双击：打开内容 / 生成内容 ---------- */

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]')
      if (!target) {
        fit()
        return
      }
      const node = nodes.find((n) => n.id === target.dataset.nodeId)
      if (!node) return
      if (node.kind === 'outline' || node.kind === 'doc') {
        if (node.ref) onOpenNode(node.ref)
        else onFillNode?.(node)
        return
      }
      // 笔记 / 试卷 / 超级文档的打开入口还在接（它们各自有自己的页签）
      onToast?.(t('这个节点的内容还在接：先点空白处取消选中'))
    },
    [fit, nodes, onFillNode, onOpenNode, onToast],
  )

  /* ---------- 键盘：Delete 删掉（只从图上删，内容不动） ---------- */

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (selectedEdge) {
        e.preventDefault()
        onChange({ version: 1, nodes, edges: edges.filter((x) => !(x.from === selectedEdge.from && x.to === selectedEdge.to)) })
        setSelectedEdge(null)
        return
      }
      if (!selectedId) return
      e.preventDefault()
      removeNode(selectedId)
      onToast?.(t('已从画布上移除。内容没有删，还能从左侧重新拖回来'))
    },
    [edges, nodes, onChange, onToast, removeNode, selectedEdge, selectedId],
  )

  /* ---------- 渲染 ---------- */

  const edgeOrigin = bounds ? { x: bounds.x - 240, y: bounds.y - 240 } : { x: 0, y: 0 }
  const edgeSize = bounds
    ? { width: bounds.width + 480, height: bounds.height + 480 }
    : { width: 0, height: 0 }
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const dragId = draft?.id ?? null
  const zoomPct = Math.round(camera.zoom * 100)

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className="bg-dot-grid relative h-full w-full select-none overflow-hidden outline-none"
    >
      {/* 被平移缩放的那一层：世界坐标直接写在子元素上 */}
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})` }}
      >
        {/* 连线层：尺寸跟着包围盒走（SVG 根默认会裁掉超出的路径，所以不能用 1×1） */}
        {bounds && (
          <svg
            className="pointer-events-none absolute"
            style={{ left: edgeOrigin.x, top: edgeOrigin.y }}
            width={edgeSize.width}
            height={edgeSize.height}
          >
            {edges.map((edge) => {
              const from = byId.get(edge.from)
              const to = byId.get(edge.to)
              if (!from || !to) return null
              const curve = edgeCurve(from, to).map((p) => ({ x: p.x - edgeOrigin.x, y: p.y - edgeOrigin.y }))
              const isSelected =
                selectedEdge?.from === edge.from && selectedEdge?.to === edge.to
              const highlighted = isSelected || hoverId === edge.to || hoverId === edge.from
              return (
                <path
                  key={`${edge.from}>${edge.to}`}
                  d={edgePathD(curve)}
                  fill="none"
                  stroke={highlighted ? 'var(--color-seal, #b45309)' : 'currentColor'}
                  className={highlighted ? '' : 'text-ink-faint/60'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  strokeLinecap="round"
                />
              )
            })}
            {/* 跟手的那条线 */}
            {linkAt && linkFrom && (() => {
              const from = byId.get(linkFrom)
              if (!from) return null
              // 借 edgeCurve 的算法画「跟手的那条」：把指针位置当成一张卡片的左沿中点
              const curve = edgeCurve(from, { id: '', kind: from.kind, x: linkAt.x, y: linkAt.y - CARD_H / 2 }).map((p) => ({
                x: p.x - edgeOrigin.x,
                y: p.y - edgeOrigin.y,
              }))
              return (
                <path
                  d={edgePathD(curve)}
                  fill="none"
                  stroke="currentColor"
                  className="text-seal/70"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
              )
            })()}
          </svg>
        )}

        {nodes.map((node) => {
          const pos = dragId === node.id && draft ? draft : node
          const view = resolveNodeView(store, node)
          const selected = selectedId === node.id
          const isHovered = hoverId === node.id
          const empty = !node.ref
          return (
            <div
              key={node.id}
              data-node-id={node.id}
              className={`absolute flex flex-col justify-center gap-1 rounded-xl border px-3 shadow-sm transition-colors ${KIND_TONE[node.kind]} ${
                empty ? 'border-dashed' : ''
              } ${selected ? 'ring-2 ring-seal/60' : isHovered ? 'ring-1 ring-seal/35' : ''}`}
              style={{
                left: pos.x,
                top: pos.y,
                width: CARD_W,
                height: CARD_H,
                cursor: dragId === node.id ? 'grabbing' : 'grab',
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className={`rounded px-1.5 py-[1px] text-[10px] font-semibold ${KIND_BADGE[node.kind]}`}>
                  {t(GRAPH_KIND_LABEL[node.kind])}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{view.title}</span>
                {view.missing && <span className="text-[10px] text-rose-500">{t('内容不在了')}</span>}
              </div>
              <div className="truncate text-[11px] text-ink-soft">{view.subtitle}</div>

              {/* 连线手柄：从这里拖出去接下一个节点 */}
              <div
                data-link-handle={node.id}
                title={t('拖出去连到另一个节点')}
                className="absolute top-1/2 -right-[7px] h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-card bg-seal/70 opacity-0 transition-opacity hover:opacity-100"
                style={{ opacity: selected || isHovered ? 1 : undefined }}
              />
            </div>
          )
        })}
      </div>

      {/* 左侧节点列表：拖到画布上生成节点 */}
      <div className="absolute top-4 left-4 flex w-[112px] flex-col gap-1 rounded-xl border border-line bg-card/85 p-2 backdrop-blur">
        <div className="px-1 pb-1 text-[10px] font-semibold text-ink-faint">{t('拖到画布')}</div>
        {PALETTE.map((kind) => (
          <div
            key={kind}
            data-palette-kind={kind}
            className="cursor-grab rounded-lg border border-line/70 bg-paper/70 px-2 py-1.5 text-[12px] text-ink hover:border-seal/40 hover:bg-seal/[0.06]"
          >
            {t(GRAPH_KIND_LABEL[kind])}
          </div>
        ))}
      </div>

      {/* 右下角：缩放读数与适应画布 */}
      <div className="absolute right-4 bottom-4 flex items-center gap-1 rounded-lg border border-line bg-card/85 px-1.5 py-1 text-[11px] text-ink-soft backdrop-blur">
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-line/60"
          onClick={() => {
            const cam = cameraRef.current
            const next = clampZoom(cam.zoom - 0.15, boundsOf(nodes), view)
            if (next !== cam.zoom) setCamera({ ...cam, zoom: next })
          }}
        >
          −
        </button>
        <span className="w-10 text-center tabular-nums">{zoomPct}%</span>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-line/60"
          onClick={() => {
            const cam = cameraRef.current
            const next = clampZoom(cam.zoom + 0.15, boundsOf(nodes), view)
            if (next !== cam.zoom) setCamera({ ...cam, zoom: next })
          }}
        >
          +
        </button>
        <span className="mx-1 h-3 w-px bg-line" />
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-line/60" onClick={fit}>
          {t('适应画布')}
        </button>
      </div>

      {/* 从列表拖出来时跟着指针的那张卡 */}
      {paletteKind && paletteAt && (
        <div
          className="pointer-events-none fixed z-50 flex items-center gap-1.5 rounded-xl border border-seal/40 bg-card/95 px-3 py-2 text-[12px] text-ink shadow-lg"
          style={{ left: paletteAt.x - CARD_W / 2, top: paletteAt.y - CARD_H / 2, width: CARD_W, height: CARD_H }}
        >
          <span className={`rounded px-1.5 py-[1px] text-[10px] font-semibold ${KIND_BADGE[paletteKind]}`}>
            {t(GRAPH_KIND_LABEL[paletteKind])}
          </span>
          <span className="text-ink-soft">{t('松手放下')}</span>
        </div>
      )}

      {/* 空画布提示 */}
      {!nodes.length && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-xl border border-dashed border-line bg-card/70 px-5 py-4 text-center text-[12px] text-ink-soft">
            {t('这张画布还是空的')}
            <div className="mt-1 text-[11px] text-ink-faint">{t('从左侧拖一个节点进来；先放「大纲」，再往下接文档')}</div>
          </div>
        </div>
      )}
    </div>
  )
})
