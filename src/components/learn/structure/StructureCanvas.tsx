/**
 * 这个文件负责什么：**结构画布**——一张固定视角的 3D 平面上的类型化节点图
 * （页签 kind 'outline' 的新形态）。
 *
 * ## 为什么是 3D 平面
 *
 * 节点有**碰撞体积**（不能叠在一起），但拖动时又必须能从别人头上飞过去。
 * 这两件事只有在一个有 z 轴的场景里才说得通：平时所有卡片都躺在 z=0 的平面上，
 * 拖起来的那张抬到 z>0，于是「实时碰撞」照旧成立、只是被提起的那个碰不到别人。
 *
 * 相机是**固定的**：平面绕 X 轴倾斜 18°、正交投影（不开 perspective）。
 * 正交的好处是屏幕坐标与世界坐标之间只差一个 cos 系数——指针换算是一个乘法，
 * 而不是透视除法；一旦开了 perspective，每一次鼠标移动都要解一遍投影方程。
 *
 * ## 一条纪律：几何计算全在领域层
 *
 * 包围盒、缩放下限、卡片尺寸与高度、命中矩形、连线规则与曲线、目标项配色、碰撞、
 * 分带排列，全部来自 `learn/structure` 与 `structureView`。组件只负责把指针事件
 * 翻译成「谁的坐标变了」「连了哪两个」。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { LearnStore } from '../../../learn/types'
import type { ExamActions, NodeDocActions } from '../explorer/types'
import {
  CARD_H,
  CARD_W,
  GRAPH_KIND_LABEL,
  boundsOf,
  canAddEdge,
  centerPan,
  clampZoom,
  fitZoom,
  seedLayout,
  type GraphKind,
  type StructureMap,
  type StructureNode,
  type ViewSize,
} from '../../../learn/structure'
import { structureFromStore } from '../../../learn/structureSeed'
import { t } from '../../../i18n'
import {
  KIND_BADGE,
  KIND_TONE,
  SLOT_ROW,
  edgeAt,
  edgeColorOf,
  edgeCurve,
  edgeDotAt,
  edgeDots,
  edgePathD,
  heightOf,
  hitTest,
  outlineSlots,
  resolveNodeView,
  slotKeyOf,
  splitLeafRef,
} from './structureView'

/** 固定视角：平面绕 X 轴倾斜多少度 */
const TILT_DEG = 18
/** 正交投影下，世界坐标的 y 到屏幕要乘这个系数（与 CSS 的 rotateX 同一个数） */
const TILT_COS = Math.cos((TILT_DEG * Math.PI) / 180)
/** 拖动时把卡片抬多高（世界坐标）。抬起来才看得见影子，也才「碰不到别人」 */
const LIFT_Z = 96

export interface StructureCanvasProps {
  store: LearnStore
  /** 这一页属于哪个目标 */
  goalId: string
  /** 图变了（上层写进 store 并落盘） */
  onChange: (next: StructureMap) => void
  /** 文档那一侧的动作：点标题打开教学文档 / 笔记 / 超级文档 */
  docs: NodeDocActions
  /** 考试那一侧的动作：点试卷标题开考试窗口 */
  exams: ExamActions
  /**
   * 新建一份笔记并返回它的名字（不打开页签）。
   *
   * 笔记节点与别的节点不同：它**不需要上下文**，拖出来就应该是一份真实的空笔记，
   * 而不是一个等生成的空盒子。所以这里要一个能同步拿到名字的动作。
   */
  onCreateNote?: (nodeId: string) => string | null
  /** 改笔记名（名字就是文件名，页签也会跟着改） */
  onRenameNote?: (nodeId: string, from: string, to: string) => void
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
  | {
      mode: 'node'
      id: string
      grabX: number
      grabY: number
      origX: number
      origY: number
      moved: boolean
      /** 按下的是标题：没拖动的话松手就打开它 */
      openTitle: boolean
    }
  | { mode: 'link'; from: string }
  | { mode: 'palette'; kind: GraphKind }
  | null

/** 右键菜单：贴指针弹出，作用在某个节点上 */
interface MenuState {
  x: number
  y: number
  nodeId: string
  /** actions = 三个动作；note = 写注释；rename = 改笔记名 */
  mode: 'actions' | 'note' | 'rename'
}

export const StructureCanvas = memo(function StructureCanvas({
  store,
  goalId,
  onChange,
  docs,
  exams,
  onCreateNote,
  onRenameNote,
  onFillNode,
  onToast,
  focusTarget,
  onFocusHandled,
}: StructureCanvasProps) {
  const map = store.structure?.[goalId] ?? EMPTY
  const nodes = map.nodes
  const edges = map.edges

  const containerRef = useRef<HTMLDivElement | null>(null)
  const trashRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<ViewSize>({ width: 0, height: 0 })
  const [camera, setCamera] = useState({ x: 72, y: 72, zoom: 1 })
  const cameraRef = useRef(camera)
  useEffect(() => {
    cameraRef.current = camera
  }, [camera])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 选中的连线（点线选中，Delete 断开）。节点与连线同时只选一个 */
  const [selectedEdge, setSelectedEdge] = useState<{ from: string; to: string } | null>(null)
  /** 指针停在哪个节点上（高亮用） */
  const [hoverId, setHoverId] = useState<string | null>(null)
  /** 指针停在哪条连线附近（小圆点只在此时出现） */
  const [hoverEdge, setHoverEdge] = useState<{ from: string; to: string } | null>(null)
  /** 指针正压在某个小圆点上（换成手型光标） */
  const [hoverDot, setHoverDot] = useState(false)
  /** 指针停在某个目标项上：对应的那条子大纲连线发光 */
  const [hoverSlot, setHoverSlot] = useState<{ parentId: string; key: string } | null>(null)
  /** 拖动中的节点位置（只在本地，松手才写回 store） */
  const [draft, setDraft] = useState<{ id: string; x: number; y: number } | null>(null)
  /** 连线中的起点与指针位置（世界坐标）：画那条跟手的线 */
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [linkAt, setLinkAt] = useState<{ x: number; y: number } | null>(null)
  /** 从列表拖出来的那一下：指针的屏幕坐标 */
  const [paletteAt, setPaletteAt] = useState<{ x: number; y: number } | null>(null)
  const [paletteKind, setPaletteKind] = useState<GraphKind | null>(null)
  /** 正拖着一个节点在垃圾桶上方 */
  const [overTrash, setOverTrash] = useState(false)
  /** 跳转后闪一下的那张卡（900ms 后清掉） */
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<number | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [menuText, setMenuText] = useState('')

  const gestureRef = useRef<Gesture>(null)
  const seededRef = useRef(false)
  const fittedRef = useRef(false)
  /** 下一次 nodes 变了之后要不要自动对镜头（自动排列之后用） */
  const fitNextRef = useRef(false)

  /** 高度访问器：大纲卡片按目标项条数长高，有注释再加一行（见 structureView） */
  const height = useMemo(() => heightOf(store), [store])
  const bounds = useMemo(() => boundsOf(nodes, height), [nodes, height])

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

  /* ---------- 镜头 ---------- */

  const fit = useCallback(() => {
    const box = boundsOf(nodes, height)
    if (!box || !view.width || !view.height) return
    const zoom = fitZoom(box, view)
    setCamera({ ...centerPan(box, view, zoom), zoom })
  }, [nodes, height, view])

  useEffect(() => {
    if (fitNextRef.current) {
      fitNextRef.current = false
      fit()
      return
    }
    if (fittedRef.current) return
    if (!view.width || !bounds) return
    fittedRef.current = true
    fit()
  }, [view.width, bounds, fit])

  /** 闪一下边框：跳转之后告诉用户「你被带到这儿了」 */
  const flash = useCallback((id: string) => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    setFlashId(id)
    flashTimer.current = window.setTimeout(() => {
      flashTimer.current = null
      setFlashId(null)
    }, 900)
  }, [])
  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    },
    [],
  )

  const centerOn = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id)
      if (!node || !view.width) return
      const zoom = Math.max(cameraRef.current.zoom, 1)
      setCamera({
        ...centerPan({ x: node.x, y: node.y, width: CARD_W, height: height(node) }, view, zoom),
        zoom,
      })
      setSelectedId(id)
      flash(id)
    },
    [nodes, view, height, flash],
  )

  const lastFocusNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!focusTarget || focusTarget.nonce === lastFocusNonce.current) return
    lastFocusNonce.current = focusTarget.nonce
    const target =
      nodes.find((n) => n.kind === 'outline' && n.ref === focusTarget.nodeId) ??
      nodes.find((n) => n.ref === focusTarget.nodeId)
    if (target && view.width) {
      const zoom = Math.max(cameraRef.current.zoom, 1)
      setCamera({ ...centerPan({ x: target.x, y: target.y, width: CARD_W, height: height(target) }, view, zoom), zoom })
      setSelectedId(target.id)
      flash(target.id)
    }
    onFocusHandled?.()
  }, [focusTarget, nodes, view, height, onFocusHandled, flash])

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
        const next = clampZoom(cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08), boundsOf(nodes, height), view)
        if (next === cam.zoom) return
        const k = next / cam.zoom
        setCamera({ x: px - (px - cam.x) * k, y: py - (py - cam.y) * k, zoom: next })
        return
      }
      setCamera({ ...cam, x: cam.x - e.deltaX, y: cam.y - e.deltaY })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [nodes, height, view])

  /* ---------- 坐标换算（正交投影：y 除以 cos 就把倾斜还原了） ---------- */

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    const cam = cameraRef.current
    const rect = el?.getBoundingClientRect()
    const left = rect?.left ?? 0
    const top = rect?.top ?? 0
    return {
      x: (clientX - left - cam.x) / cam.zoom,
      y: (clientY - top - cam.y) / (cam.zoom * TILT_COS),
    }
  }, [])

  const isOverTrash = useCallback((clientX: number, clientY: number) => {
    const rect = trashRef.current?.getBoundingClientRect()
    if (!rect) return false
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }, [])

  /* ---------- 写回 ---------- */

  /**
   * 撤回栈：每次改动前把**上一张图**压进来。
   *
   * 只活在这个组件里、不进 store：它是「这一页最近做了什么」，换目标、重开应用都该清空。
   * 上限 50 步——再多只是占内存，没人会退到那么远。
   */
  const historyRef = useRef<StructureMap[]>([])
  const [canUndo, setCanUndo] = useState(false)

  /** 所有改动都走它：先记一笔再改 */
  const commit = useCallback(
    (next: StructureMap) => {
      historyRef.current.push(map)
      if (historyRef.current.length > 50) historyRef.current.shift()
      setCanUndo(true)
      onChange(next)
    },
    [map, onChange],
  )

  const undo = useCallback(() => {
    const prev = historyRef.current.pop()
    if (!prev) return
    setCanUndo(historyRef.current.length > 0)
    // 撤回本身不再进栈，否则 Ctrl+Z 会在两版之间来回弹
    onChange(prev)
    setDraft(null)
    setSelectedId(null)
    setSelectedEdge(null)
  }, [onChange])

  /** 换目标就清空：A 课的撤回不该退到 B 课去 */
  useEffect(() => {
    historyRef.current = []
    setCanUndo(false)
  }, [goalId])

  const removeNode = useCallback(
    (id: string) => {
      const next = nodes.filter((n) => n.id !== id)
      commit({ version: 1, nodes: next, edges: edges.filter((e) => e.from !== id && e.to !== id) })
      setSelectedId(null)
    },
    [nodes, edges, commit],
  )

  const addEdge = useCallback(
    (from: string, to: string) => {
      if (!canAddEdge(nodes, edges, from, to)) return false
      const fromNode = nodes.find((n) => n.id === from)
      const toNode = nodes.find((n) => n.id === to)
      /*
       * 大纲 → 子大纲 还要多过一关：父大纲提供的接入点**数量固定**（有几个目标项就有几个），
       * 一个接入点只挂一个子大纲。文档那一侧不受这个限制。
       */
      if (fromNode?.kind === 'outline' && toNode?.kind === 'outline') {
        const slots = outlineSlots(store, fromNode, nodes)
        const key = slotKeyOf(store, toNode)
        const slot = key ? slots.find((s) => s.key === key) : undefined
        if (!slot) {
          onToast?.(t('这张大纲没有这个接入点：子大纲只能挂在它的某个目标项上'))
          return false
        }
        if (slot.childId && slot.childId !== to) {
          onToast?.(t('「{0}」这个目标项已经挂了一个子大纲', slot.title))
          return false
        }
        const patched = key === toNode.slot ? nodes : nodes.map((n) => (n.id === to ? { ...n, slot: key ?? undefined } : n))
        commit({ version: 1, nodes: patched, edges: [...edges, { from, to }] })
        return true
      }
      commit({ version: 1, nodes, edges: [...edges, { from, to }] })
      return true
    },
    [nodes, edges, commit, onToast, store],
  )

  /* ---------- 点目标项 ---------- */

  const onSlotClick = useCallback(
    (parentId: string, key: string) => {
      const parent = nodes.find((n) => n.id === parentId)
      if (!parent) return
      const slot = outlineSlots(store, parent, nodes).find((s) => s.key === key)
      if (!slot) return
      if (slot.childId) {
        centerOn(slot.childId)
        return
      }
      const child: StructureNode = {
        id: crypto.randomUUID(),
        kind: 'outline',
        slot: slot.key,
        x: parent.x + CARD_W + 112,
        y: parent.y + slot.index * (CARD_H + 24),
      }
      commit({ version: 1, nodes: [...nodes, child], edges: [...edges, { from: parent.id, to: child.id }] })
      setSelectedId(child.id)
      onToast?.(t('「{0}」的空子大纲已就位：双击它可以开始生成内容', slot.title))
    },
    [centerOn, edges, nodes, commit, onToast, store],
  )

  /* ---------- 打开内容 ---------- */

  const openNode = useCallback(
    (node: StructureNode) => {
      const ref = node.ref
      if (!ref) {
        if (onFillNode) onFillNode(node)
        else onToast?.(t('空节点还没有内容：等它自己决定生成什么这条链接上之后，双击就能生成'))
        return
      }
      if (node.kind === 'doc') {
        docs.onOpenTeach(ref)
        return
      }
      if (node.kind === 'note') {
        const leaf = splitLeafRef(ref)
        if (leaf) docs.onOpenNote(leaf.owner, leaf.name)
        return
      }
      if (node.kind === 'superdoc') {
        const leaf = splitLeafRef(ref)
        if (leaf) docs.onOpenSuperDoc(leaf.owner, leaf.name)
        return
      }
      if (node.kind === 'exam') {
        const exam = store.exams.find((e) => e.id === ref)
        if (exam) exams.onStart(exam.nodeId, exam.id)
        return
      }
      onToast?.(t('大纲节点就在这张画布上，没有另一份页签'))
    },
    [docs, exams, onFillNode, onToast, store],
  )

  /* ---------- 自动排列（按层级从左到右铺开） ---------- */

  const autoArrange = useCallback(() => {
    const laid = seedLayout({
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        ...(n.ref ? { ref: n.ref } : {}),
        ...(n.slot ? { slot: n.slot } : {}),
        ...(n.note ? { note: n.note } : {}),
      })),
      edges,
    })
    const pos = new Map(laid.nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
    fitNextRef.current = true
    commit({
      version: 1,
      nodes: nodes.map((n) => {
        const p = pos.get(n.id)
        return p ? { ...n, x: p.x, y: p.y } : n
      }),
      edges,
    })
  }, [nodes, edges, commit])

  /* ---------- 右键菜单的三个动作 ---------- */

  const cloneNode = useCallback(
    (node: StructureNode) => {
      const copy: StructureNode = {
        id: crypto.randomUUID(),
        kind: node.kind,
        ...(node.ref ? { ref: node.ref } : {}),
        ...(node.note ? { note: node.note } : {}),
        // 故意不复制 slot：一个接入点只挂一个子大纲
        x: node.x + 40,
        y: node.y + 40,
      }
      commit({ version: 1, nodes: [...nodes, copy], edges })
      setSelectedId(copy.id)
      onToast?.(t('已克隆一个节点'))
    },
    [edges, nodes, commit, onToast],
  )

  const saveNote = useCallback(
    (nodeId: string, text: string) => {
      const value = text.trim()
      commit({
        version: 1,
        nodes: nodes.map((n) => {
          if (n.id !== nodeId) return n
          const next = { ...n }
          if (value) next.note = value
          else delete next.note
          return next
        }),
        edges,
      })
      setMenu(null)
    },
    [nodes, edges, commit],
  )

  const saveRename = useCallback(
    (node: StructureNode, to: string) => {
      const name = to.trim()
      const leaf = node.ref ? splitLeafRef(node.ref) : null
      if (!leaf || !name || name === leaf.name) {
        setMenu(null)
        return
      }
      onRenameNote?.(leaf.owner, leaf.name, name)
      // 节点上的 ref 跟着改：改名之后它指向的是同一份笔记的新名字
      commit({
        version: 1,
        nodes: nodes.map((n) => (n.id === node.id ? { ...n, ref: `${leaf.owner}:${name}` } : n)),
        edges,
      })
      setMenu(null)
    },
    [nodes, edges, commit, onRenameNote],
  )

  /* ---------- 指针 ---------- */

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      const el = containerRef.current
      if (!el) return
      // 菜单、按钮、输入框：容器一旦捕获指针，它们就收不到 click 了
      if (target.closest('button, textarea, input, [data-menu]')) return
      if (menu) {
        setMenu(null)
        return
      }
      el.setPointerCapture(e.pointerId)

      const paletteEl = target.closest<HTMLElement>('[data-palette-kind]')
      if (paletteEl) {
        const kind = paletteEl.dataset.paletteKind as GraphKind
        gestureRef.current = { mode: 'palette', kind }
        setPaletteKind(kind)
        setPaletteAt({ x: e.clientX, y: e.clientY })
        return
      }

      const slotEl = target.closest<HTMLElement>('[data-slot-key]')
      if (slotEl) {
        onSlotClick(slotEl.dataset.slotParent ?? '', slotEl.dataset.slotKey ?? '')
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
        gestureRef.current = {
          mode: 'node',
          id,
          grabX: world.x,
          grabY: world.y,
          origX: node.x,
          origY: node.y,
          moved: false,
          openTitle: !!target.closest('[data-open-title]'),
        }
        return
      }

      const world = toWorld(e.clientX, e.clientY)
      const dot = edgeDotAt(nodes, edges, world.x, world.y, 12 / cameraRef.current.zoom, height)
      if (dot) {
        centerOn(dot.side === 'from' ? dot.edge.to : dot.edge.from)
        return
      }
      const edge = edgeAt(nodes, edges, world.x, world.y, 8 / cameraRef.current.zoom, height)
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
    [centerOn, edges, height, menu, nodes, onSlotClick, toWorld],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gestureRef.current
      if (!g) {
        // 没有手势：算「指针附近有没有连线」，小圆点只在此时露面
        const world = toWorld(e.clientX, e.clientY)
        const dot = edgeDotAt(nodes, edges, world.x, world.y, 12 / cameraRef.current.zoom, height)
        const edge = dot?.edge ?? edgeAt(nodes, edges, world.x, world.y, 8 / cameraRef.current.zoom, height)
        setHoverDot(!!dot)
        setHoverEdge((prev) => (prev?.from === edge?.from && prev?.to === edge?.to ? prev : edge ?? null))
        return
      }
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
        setOverTrash(isOverTrash(e.clientX, e.clientY))
        return
      }
      if (g.mode === 'link') {
        setLinkAt(world)
        setHoverId(hitTest(nodes, world.x, world.y, height)?.id ?? null)
        return
      }
      setPaletteAt({ x: e.clientX, y: e.clientY })
      setHoverId(hitTest(nodes, world.x, world.y, height)?.id ?? null)
    },
    [edges, height, isOverTrash, nodes, toWorld],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gestureRef.current
      gestureRef.current = null
      const el = containerRef.current
      if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (!g) return

      if (g.mode === 'node') {
        const inTrash = isOverTrash(e.clientX, e.clientY)
        setOverTrash(false)
        if (inTrash && g.moved) {
          removeNode(g.id)
          setDraft(null)
          onToast?.(t('已从画布上移除。内容没有删，Ctrl+Z 可以撤回'))
          return
        }
        if (draft && draft.id === g.id && g.moved) {
          commit({
            version: 1,
            nodes: nodes.map((n) => (n.id === draft.id ? { ...n, x: draft.x, y: draft.y } : n)),
            edges,
          })
        } else if (!g.moved && g.openTitle) {
          const node = nodes.find((n) => n.id === g.id)
          if (node) openNode(node)
        }
        setDraft(null)
        return
      }

      if (g.mode === 'link') {
        const world = toWorld(e.clientX, e.clientY)
        const target = hitTest(nodes, world.x, world.y, height)
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
        const target = hitTest(nodes, world.x, world.y, height)
        setPaletteAt(null)
        setPaletteKind(null)
        setHoverId(null)

        /*
         * 笔记节点是特例：它**不需要上下文**，拖出来就该是一份真实的空笔记。
         * 所以这里先建笔记（名字由 learn/notes 分配），再把节点接上去；
         * 建不出来（没有挂到文档上、或者没有这个动作）就什么都不建。
         */
        if (g.kind === 'note') {
          const ownerId = target?.kind === 'doc' ? target.ref : null
          if (!ownerId || !onCreateNote) {
            onToast?.(t('笔记要挂在文档节点下面：把它拖到某张文档卡上'))
            return
          }
          const name = onCreateNote(ownerId)
          if (!name) return
          const node: StructureNode = {
            id: crypto.randomUUID(),
            kind: 'note',
            ref: `${ownerId}:${name}`,
            x: target ? target.x + CARD_W + 96 : world.x - CARD_W / 2,
            y: target ? target.y : world.y - CARD_H / 2,
          }
          commit({
            version: 1,
            nodes: [...nodes, node],
            edges: target ? [...edges, { from: target.id, to: node.id }] : edges,
          })
          setSelectedId(node.id)
          onToast?.(t('已新建笔记「{0}」，点标题就能打开', name))
          return
        }

        const node: StructureNode = {
          id: crypto.randomUUID(),
          kind: g.kind,
          x: target ? target.x + CARD_W + 96 : world.x - CARD_W / 2,
          y: target ? target.y : world.y - CARD_H / 2,
        }
        const nextNodes = [...nodes, node]
        const nextEdges = [...edges]
        if (target) {
          const free =
            target.kind === 'outline' && node.kind === 'outline'
              ? outlineSlots(store, target, nodes).find((s) => !s.childId)
              : null
          if (free) node.slot = free.key
          const allowed =
            target.kind === 'outline' && node.kind === 'outline'
              ? !!free
              : canAddEdge(nextNodes, nextEdges, target.id, node.id)
          if (allowed) {
            nextEdges.push({ from: target.id, to: node.id })
          } else if (target.kind === 'outline' && node.kind === 'outline') {
            onToast?.(t('这张大纲的目标项都挂满了：先给它加目标项，才有新的接入点'))
          }
        }
        commit({ version: 1, nodes: nextNodes, edges: nextEdges })
        setSelectedId(node.id)
        onToast?.(t('空节点：它还没有内容，挂上父节点之后由它自己决定生成什么'))
      }
    },
    [addEdge, draft, edges, height, isOverTrash, nodes, commit, onCreateNote, onToast, openNode, removeNode, store, toWorld],
  )

  /* ---------- 双击 ---------- */

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]')
      if (!target) {
        fit()
        return
      }
      const node = nodes.find((n) => n.id === target.dataset.nodeId)
      if (node) openNode(node)
    },
    [fit, nodes, openNode],
  )

  /* ---------- 右键菜单 ---------- */

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]')
      if (!target) return
      const nodeId = target.dataset.nodeId as string
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return
      e.preventDefault()
      setSelectedId(nodeId)
      setMenuText(node.note ?? '')
      setMenu({ x: e.clientX, y: e.clientY, nodeId, mode: 'actions' })
    },
    [nodes],
  )

  /* ---------- 键盘 ---------- */

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        setMenu(null)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (selectedEdge) {
        e.preventDefault()
        commit({
          version: 1,
          nodes,
          edges: edges.filter((x) => !(x.from === selectedEdge.from && x.to === selectedEdge.to)),
        })
        setSelectedEdge(null)
        return
      }
      if (!selectedId) return
      e.preventDefault()
      removeNode(selectedId)
      onToast?.(t('已从画布上移除。内容没有删，Ctrl+Z 可以撤回'))
    },
    [edges, nodes, commit, onToast, removeNode, selectedEdge, selectedId],
  )

  /* ---------- 渲染 ---------- */

  /** 拖动中的那一张用 draft 的位置：连线跟着动，而不是松手才跳过去 */
  const displayNodes = useMemo(
    () => (draft ? nodes.map((n) => (n.id === draft.id ? { ...n, x: draft.x, y: draft.y } : n)) : nodes),
    [nodes, draft],
  )
  const byId = useMemo(() => new Map(displayNodes.map((n) => [n.id, n])), [displayNodes])
  const dragging = !!draft
  const menuNode = menu ? nodes.find((n) => n.id === menu.nodeId) ?? null : null

  const edgeOrigin = bounds ? { x: bounds.x - 240, y: bounds.y - 240 } : { x: 0, y: 0 }
  const edgeSize = bounds ? { width: bounds.width + 480, height: bounds.height + 480 } : { width: 0, height: 0 }
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
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      className="relative h-full w-full select-none overflow-hidden bg-paper outline-none dark:bg-card/30"
      style={{ cursor: hoverDot ? 'pointer' : undefined }}
    >
      {/*
        固定视角的 3D 平面：绕 X 轴倾斜、正交投影（不开 perspective）。
        拖动时这一层抬到垃圾桶之上——被提起的节点必须压在删除区上面，否则拖到垃圾桶
        附近就看不见它了。`preserve-3d` 是子元素能用 translateZ 的前提。
      */}
      <div
        className={`absolute top-0 left-0 origin-top-left ${dragging ? 'z-30' : 'z-0'}`}
        style={{
          transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom}) rotateX(${TILT_DEG}deg)`,
          transformStyle: 'preserve-3d',
        }}
      >
        {/* 地板：网格长在这块倾斜的平面上（而不是外层容器上），倾斜才看得出来 */}
        <div
          className={`absolute ${dragging ? '' : 'bg-dot-grid'}`}
          style={{ left: -4000, top: -4000, width: 8000, height: 8000 }}
        />

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
              const curve = edgeCurve(from, to, height).map((p) => ({ x: p.x - edgeOrigin.x, y: p.y - edgeOrigin.y }))
              const isSelected = selectedEdge?.from === edge.from && selectedEdge?.to === edge.to
              const color = edgeColorOf(store, displayNodes, edge)
              const dots = edgeDots(from, to, height)
              // 悬停目标项 → 对应的那条子大纲连线发光
              const slotKey = slotKeyOf(store, to)
              const glow =
                !!hoverSlot && hoverSlot.parentId === edge.from && slotKey === hoverSlot.key
              const isHoveredEdge =
                (hoverEdge?.from === edge.from && hoverEdge?.to === edge.to) || isSelected || glow
              const showDots = hoverEdge?.from === edge.from && hoverEdge?.to === edge.to
              return (
                <g key={`${edge.from}>${edge.to}`}>
                  <path
                    d={edgePathD(curve)}
                    fill="none"
                    stroke={color ?? (isHoveredEdge ? 'var(--color-seal, #b45309)' : 'currentColor')}
                    className={color || isHoveredEdge ? '' : 'text-ink-faint/55'}
                    strokeWidth={isSelected || glow ? 2.6 : isHoveredEdge ? 2 : 1.5}
                    strokeLinecap="round"
                    style={
                      glow
                        ? { filter: `drop-shadow(0 0 5px ${color ?? 'var(--color-seal, #b45309)'})` }
                        : undefined
                    }
                  />
                  {/*
                    两端的小圆点：**只在指针停在线上时出现**，而且很小。
                    平时它只会挡视线——线本身已经说清了连接关系。
                  */}
                  {showDots &&
                    (['from', 'to'] as const).map((side) => {
                      const p = side === 'from' ? dots.from : dots.to
                      return (
                        <circle
                          key={side}
                          cx={p.x - edgeOrigin.x}
                          cy={p.y - edgeOrigin.y}
                          r={3}
                          fill="currentColor"
                          className="text-card transition-all"
                          stroke={color ?? 'rgba(140,140,140,0.7)'}
                          strokeWidth={1.4}
                        />
                      )
                    })}
                </g>
              )
            })}
            {/* 跟手的那条线 */}
            {linkAt && linkFrom && (() => {
              const from = byId.get(linkFrom)
              if (!from) return null
              const curve = edgeCurve(
                from,
                { id: '', kind: from.kind, x: linkAt.x, y: linkAt.y - CARD_H / 2 },
                height,
              ).map((p) => ({ x: p.x - edgeOrigin.x, y: p.y - edgeOrigin.y }))
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

        {displayNodes.map((node) => {
          const view = resolveNodeView(store, node)
          const selected = selectedId === node.id
          const isHovered = hoverId === node.id
          const empty = !node.ref
          const h = height(node)
          const slots = node.kind === 'outline' ? outlineSlots(store, node, nodes) : []
          const openable = node.kind !== 'outline'
          const lifted = draft?.id === node.id
          return (
            <div
              key={node.id}
              data-node-id={node.id}
              className={`absolute flex flex-col rounded-xl border ${KIND_TONE[node.kind]} ${
                empty ? 'border-dashed' : ''
              } ${selected ? 'ring-2 ring-seal/60' : isHovered ? 'ring-1 ring-seal/35' : ''} ${
                lifted ? 'moji-structure-lifted' : 'shadow-sm'
              } ${flashId === node.id ? 'moji-structure-flash' : ''}`}
              style={{
                left: node.x,
                top: node.y,
                width: CARD_W,
                height: h,
                // 拖起来的那张抬到 z 轴上：正交投影下表现为往上飘一截，配合影子就是「浮着」
                transform: lifted ? `translateZ(${LIFT_Z}px)` : undefined,
                cursor: lifted ? 'grabbing' : 'grab',
              }}
            >
              <div className="flex items-center gap-1.5 px-3 pt-2" style={{ minHeight: 30 }}>
                <span className={`shrink-0 rounded px-1.5 py-[1px] text-[10px] font-semibold ${KIND_BADGE[node.kind]}`}>
                  {t(GRAPH_KIND_LABEL[node.kind])}
                </span>
                <span
                  {...(openable ? { 'data-open-title': node.id } : {})}
                  title={openable ? t('点标题直接打开') : undefined}
                  className={`min-w-0 flex-1 truncate text-[13px] font-medium text-ink ${
                    openable ? 'hover:text-seal hover:underline' : ''
                  }`}
                >
                  {view.title}
                </span>
                {view.missing && <span className="text-[10px] text-rose-500">{t('内容不在了')}</span>}
              </div>

              {node.kind === 'outline' && slots.length > 0 ? (
                <div className="mt-0.5 flex flex-col overflow-hidden px-2 pb-2">
                  {slots.map((slot) => (
                    <div
                      key={slot.key}
                      data-slot-key={slot.key}
                      data-slot-parent={node.id}
                      title={slot.childId ? t('跳到这个子大纲') : t('生成一个空子大纲')}
                      onPointerEnter={() => setHoverSlot({ parentId: node.id, key: slot.key })}
                      onPointerLeave={() => setHoverSlot(null)}
                      className="flex cursor-pointer items-center gap-1.5 rounded px-1 hover:bg-seal/[0.08]"
                      style={{ height: SLOT_ROW }}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full border"
                        style={{ borderColor: slot.color, background: slot.childId ? slot.color : 'transparent' }}
                      />
                      <span
                        className="truncate text-[11.5px]"
                        style={{ color: slot.childId ? slot.color : undefined, opacity: slot.childId ? 1 : 0.55 }}
                      >
                        {slot.title}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="truncate px-3 pb-2 text-[11px] text-ink-soft">{view.subtitle}</div>
              )}

              {/* 注释标签：贴在卡片底部（右键菜单「注释」写的那句话） */}
              {node.note && (
                <div className="mx-2 mb-1.5 truncate rounded bg-amber-500/15 px-1.5 py-[2px] text-[10px] text-amber-700 dark:text-amber-300">
                  {node.note}
                </div>
              )}

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
      <div className="absolute top-4 left-4 z-20 flex w-[112px] flex-col gap-1 rounded-xl border border-line bg-card/85 p-2 backdrop-blur">
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

      {/*
        垃圾桶：**只在拖着节点时出现**（平时它只是一块挡视线的色块），
        方形圆角、够大、好瞄准；层级在平面之下，所以被提起的节点永远压在它上面。
      */}
      {dragging && (
        <div
          ref={trashRef}
          className={`absolute bottom-6 left-1/2 z-20 flex h-28 w-44 -translate-x-1/2 flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed text-[12px] transition-all ${
            overTrash
              ? 'scale-105 border-rose-500 bg-rose-500/15 text-rose-600 dark:text-rose-300'
              : 'border-line bg-card/80 text-ink-faint'
          }`}
        >
          <Trash2 size={26} />
          {overTrash ? t('松手删除') : t('拖到这里删除')}
        </div>
      )}

      {/* 右下角：缩放读数、适应画布、自动排列 */}
      <div className="absolute right-4 bottom-4 z-20 flex items-center gap-1 rounded-lg border border-line bg-card/85 px-1.5 py-1 text-[11px] text-ink-soft backdrop-blur">
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-line/60"
          onClick={() => {
            const cam = cameraRef.current
            const next = clampZoom(cam.zoom - 0.15, boundsOf(nodes, height), view)
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
            const next = clampZoom(cam.zoom + 0.15, boundsOf(nodes, height), view)
            if (next !== cam.zoom) setCamera({ ...cam, zoom: next })
          }}
        >
          +
        </button>
        <span className="mx-1 h-3 w-px bg-line" />
        <button
          type="button"
          disabled={!canUndo}
          className="rounded px-1.5 py-0.5 hover:bg-line/60 disabled:opacity-40"
          onClick={undo}
        >
          {t('撤回')}
        </button>
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-line/60" onClick={fit}>
          {t('适应画布')}
        </button>
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-line/60" onClick={autoArrange}>
          {t('自动排列')}
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

      {/* 节点右键菜单 */}
      {menu && menuNode && (
        <div
          data-menu
          className="fixed z-50 w-[168px] rounded-lg border border-line bg-card/95 p-1 text-[12px] text-ink shadow-lg backdrop-blur"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.mode === 'actions' ? (
            <>
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                onClick={() => {
                  cloneNode(menuNode)
                  setMenu(null)
                }}
              >
                {t('克隆')}
              </button>
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                onClick={() => {
                  removeNode(menuNode.id)
                  setMenu(null)
                  onToast?.(t('已从画布上移除。内容没有删，Ctrl+Z 可以撤回'))
                }}
              >
                {t('删除')}
              </button>
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                onClick={() => {
                  setMenuText(menuNode.note ?? '')
                  setMenu({ ...menu, mode: 'note' })
                }}
              >
                {t('注释')}
              </button>
              {menuNode.kind === 'note' && (
                <button
                  type="button"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                  onClick={() => {
                    const leaf = menuNode.ref ? splitLeafRef(menuNode.ref) : null
                    setMenuText(leaf?.name ?? '')
                    setMenu({ ...menu, mode: 'rename' })
                  }}
                >
                  {t('改名')}
                </button>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-1.5 p-1">
              <div className="text-[10px] text-ink-faint">
                {menu.mode === 'note' ? t('写一句注释，贴在卡片底部') : t('改笔记名（文件名一起改）')}
              </div>
              <textarea
                autoFocus
                value={menuText}
                onChange={(e) => setMenuText(e.target.value)}
                rows={menu.mode === 'note' ? 3 : 1}
                className="w-full resize-none rounded border border-line bg-paper/80 px-1.5 py-1 text-[12px] text-ink outline-none focus:border-seal/50"
              />
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  className="rounded px-2 py-1 text-[11px] text-ink-soft hover:bg-line/60"
                  onClick={() => setMenu(null)}
                >
                  {t('取消')}
                </button>
                <button
                  type="button"
                  className="rounded bg-seal/15 px-2 py-1 text-[11px] text-seal-deep hover:bg-seal/25"
                  onClick={() => {
                    if (menu.mode === 'note') saveNote(menuNode.id, menuText)
                    else saveRename(menuNode, menuText)
                  }}
                >
                  {t('保存')}
                </button>
              </div>
            </div>
          )}
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
