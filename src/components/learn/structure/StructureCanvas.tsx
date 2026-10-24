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

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  EDGE_STYLES,
  canConnect,
  docGid,
  entryGid,
  freeSpotNear,

  rectOf,
  removeNodeFromMap,
  renameLeafInMap,
  seedLayout,
  slotOrderOf,
  type EdgeStyle,
  type GraphKind,
  type StructureMap,
  type StructureNode,
  type ViewSize,
} from '../../../learn/structure'
import { structureViewOf } from '../../../learn/structureSeed'
import { examGid, superdocGid } from '../../../learn/structure'
import { t } from '../../../i18n'
import {
  CARD_PAD_B,
  DOC_LINES,
  DOC_LINE_H,
  EDGE_ANCHOR_Y,
  KIND_BADGE,
  KIND_TONE,
  OUTLINE_HEAD,
  SLOT_ROW,
  edgeAt,
  edgeColorOf,
  edgeCurve,
  edgeDotAt,
  edgeDots,
  edgeElbow,
  edgePathD,
  edgeRoute,
  heightOf,
  hitTest,
  isTextEntryTarget,
  outlineSlots,
  resolveNodeView,
  slotAnchorY,
  SLOT_ACCENT,
  slotKeyOf,
  splitLeafRef,
  type Point,
} from './structureView'

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
   * 挂件实体先行（三种挂件同一口径）：拖到文档卡上就建真实空实体，同步拿到身份——
   * 笔记回名字、试卷回实体 id。内容随后由「生成」填进这个实体（试卷同 id 吸收、
   * 超级文档按名字覆写），卡的位置与连线从落位那刻起就是稳定的。
   */
  onCreateNote?: (nodeId: string) => string | null
  onCreateExam?: (nodeId: string) => string | null
  onCreateSuperDoc?: (nodeId: string) => string | null
  /** 改笔记名（名字就是文件名，页签也会跟着改） */
  onRenameNote?: (nodeId: string, from: string, to: string) => void
  /** 给某个节点的大纲手动加一条目标项（大纲卡底部的「+」） */
  onAddOutlineEntry?: (nodeId: string, title: string) => void
  /**
   * 在某个大纲的目标项上「挂一份文档」：建出带标题的空文档（壳），返回新节点 id。
   * 只建壳不写内容——内容要 AI 生成、还得用户确认。
   */
  onCreateChildDoc?: (ownerNodeId: string, title: string) => string | null
  /**
   * 给一个空文档卡点「生成文档」：交给 AI 写正文。
   * hint 是画布上才知道的意图（这份文档落地哪份大纲的哪条目标项），跟着进工作流。
   */
  onGenerateDoc?: (nodeId: string, hint?: string) => void
  /**
   * 文档卡右键菜单的「生成前置知识大纲」：按这个节点现有的内容铺「学它之前要先会什么」。
   * ownerNodeId 是文档卡的知识节点 id——大纲内容就长在那个节点身上。
   * （旧入口「拖一张空大纲卡接上游」已随占位卡一起退役。）
   */
  onGenerateOutline?: (ownerNodeId: string) => void
  /** 双击空节点：交给上层去生成内容（这一版还没接，先提示） */
  onFillNode?: (node: StructureNode) => void
  onToast?: (msg: string) => void
  /** 外部指定的聚焦目标（chip 路由）：把镜头挪到 ref 对得上的那个节点 */
  focusTarget?: { nodeId: string; nonce: number } | null
  onFocusHandled?: () => void
}

/**
 * 左侧列表只放**挂件**（顺序即层级，见 GRAPH_EDGE_RULES）。实体先行：拖到文档卡上
 * 就建真实空实体（空试卷出题时被同 id 吸收、空超级文档按名字覆写），卡从落位那刻
 * 起就有依托。入口不在列表里（派生长出来）；文档与大纲也不在——子文档点大纲目标项、
 * 前置知识大纲走文档卡右键菜单。画布不再产生任何无实体依托的占位卡。
 */
const PALETTE: GraphKind[] = ['note', 'exam', 'superdoc']

/** 全景缩略图的窗口大小（屏幕像素） */
const MINI_W = 248
const MINI_H = 160
/** 单卡在缩略图上的最大缩放：图很小的时候别把一张卡放大成半块窗口 */
const MINI_MAX_SCALE = 0.5

/** 缩略图上各类型的填充色（与卡片色板同族；SVG 要具体色值，大纲跟主题印章色走） */
const MINI_FILL: Record<GraphKind, string> = {
  entry: '#f43f5e',
  outline: 'var(--color-seal, #a8432f)',
  doc: '#0ea5e9',
  note: '#10b981',
  exam: '#f59e0b',
  superdoc: '#8b5cf6',
}

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
  | { mode: 'link'; from: string; slotKey?: string; moved?: boolean }
  | {
      mode: 'palette'
      kind: GraphKind
      /** 指针是否离开过列表：没离开过就松手 = 把它放回去了，不建节点 */
      leftList?: boolean
    }
  | { mode: 'marquee'; startX: number; startY: number }
  | null

/** 右键菜单：贴指针弹出，作用在某个节点上 */
interface MenuState {
  x: number
  y: number
  nodeId: string
  /** actions = 三个动作；note = 写注释；rename = 改笔记名；slot = 新加一条目标项 */
  mode: 'actions' | 'note' | 'rename' | 'slot'
}

export const StructureCanvas = memo(function StructureCanvas({
  store,
  goalId,
  onChange,
  docs,
  exams,
  onCreateNote,
  onCreateExam,
  onCreateSuperDoc,
  onRenameNote,
  onAddOutlineEntry,
  onCreateChildDoc,
  onGenerateDoc,
  onGenerateOutline,
  onFillNode,
  onToast,
  focusTarget,
  onFocusHandled,
}: StructureCanvasProps) {
  /**
   * 图是**算出来的**，不是存出来的一份快照（见 structureSeed 的 structureViewOf）：
   * 派生出来的卡片一定在、存过的坐标一定被尊重、用户删掉的卡片一定不在。
   * 因此这里不再需要「首帧铺一张」与「store 变了就对账」两个 effect。
   */
  const saved = store.structure?.[goalId]
  const map = useMemo(() => structureViewOf(store, goalId, saved), [store, goalId, saved])
  const nodes = map.nodes
  const edges = map.edges

  /** 入口节点的确定性 id：每张图默认存在一个，不能删除（见 seedFromSource 的 isRoot） */
  const entryId = useMemo(() => {
    const root = store.goals.find((g) => g.id === goalId)?.rootNodeId
    return root ? entryGid(root) : null
  }, [store, goalId])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const trashRef = useRef<HTMLDivElement | null>(null)
  /** 左侧节点列表：拖出去必须离开过它，松手才允许落地（见 Gesture.palette.leftList） */
  const paletteRef = useRef<HTMLDivElement | null>(null)
  /** 上一次中键按下时刻：双击中键 = 适应画布（Chromium 不给中键派发 dblclick，只能自己计时） */
  const lastMiddleDownRef = useRef(0)
  const [view, setView] = useState<ViewSize>({ width: 0, height: 0 })
  const [camera, setCamera] = useState({ x: 72, y: 72, zoom: 1 })
  const cameraRef = useRef(camera)
  useEffect(() => {
    cameraRef.current = camera
  }, [camera])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 选中的连线（点线选中，Delete 断开）。节点与连线同时只选一个 */
  const [selectedEdge, setSelectedEdge] = useState<{ from: string; to: string } | null>(null)
  /**
   * 选框多选：拉框圈中的那批卡。与 selectedId 互斥——点任何一张卡就回到单选。
   * 多选目前只服务一件事：Delete 一把删（单次写回、一条撤回）。
   */
  const [multiIds, setMultiIds] = useState<Set<string> | null>(null)
  /** 拉框进行中的那个矩形（世界坐标，已归一成 x/y/width/height） */
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
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
  /** 这次连线是从哪条目标项拉出来的（跟手的线要从那一行出发） */
  const [linkSlot, setLinkSlot] = useState<string | null>(null)

  /** 目标项圆点的**实测**高度（离卡片顶部），key = `节点 id|目标项 key` */
  const [dotY, setDotY] = useState<Record<string, number>>({})
  const planeRef = useRef<HTMLDivElement | null>(null)
  /** 从列表拖出来的那一下：指针的屏幕坐标 */
  const [paletteAt, setPaletteAt] = useState<{ x: number; y: number } | null>(null)
  const [paletteKind, setPaletteKind] = useState<GraphKind | null>(null)
  /** 正拖着一个节点在垃圾桶上方 */
  const [overTrash, setOverTrash] = useState(false)
  /** 镜头正在做过渡（这段时间平面带 transition，跳转才是「滑过去」而不是瞬移） */
  const [animating, setAnimating] = useState(false)
  const animTimer = useRef<number | null>(null)
  /** 跳转后闪一下的那张卡（900ms 后清掉） */
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<number | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [menuText, setMenuText] = useState('')

  /** 空格按住时左键也能拖画布（见 onPointerDown） */
  const spaceRef = useRef(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const gestureRef = useRef<Gesture>(null)
  const fittedRef = useRef(false)
  /** 下一次 nodes 变了之后要不要自动对镜头（自动排列之后用） */
  const fitNextRef = useRef(false)

  /** 高度访问器：大纲卡片按目标项条数长高，有注释再加一行（见 structureView） */
  const height = useMemo(() => heightOf(store), [store])
  const bounds = useMemo(() => boundsOf(nodes, height), [nodes, height])

  /**
   * 连线的「大纲那一端」对准它占的那条目标项，而不是卡片顶部那个固定锚点。
   *
   * 只对 `大纲 → 子文档` 这条算：其余边（文档→自己的大纲、文档→叶子）没有目标项可言，
   * 用默认锚点即可。
   */
  const anchorOf = useCallback(
    (edge: { from: string; to: string }) => {
      const from = nodes.find((n) => n.id === edge.from)
      const to = nodes.find((n) => n.id === edge.to)
      if (!from || !to || from.kind !== 'outline' || to.kind !== 'doc') return undefined
      const key = slotKeyOf(to)
      if (!key) return undefined
      const measured = dotY[`${from.id}|${key}`]
      if (measured != null) return { from: measured }
      const index = outlineSlots(store, from, nodes, edges).findIndex((s) => s.key === key)
      return index < 0 ? undefined : { from: slotAnchorY(index) }
    },
    [nodes, edges, store, dotY],
  )
  /** 连线画法：默认直线（见 learn/structure 的 EDGE_STYLES） */
  const edgeStyle: EdgeStyle = map.edgeStyle ?? 'straight'

  /** 拖动中的那一张用 draft 的位置：连线跟着动，而不是松手才跳过去 */
  const displayNodes = useMemo(
    () => (draft ? nodes.map((n) => (n.id === draft.id ? { ...n, x: draft.x, y: draft.y } : n)) : nodes),
    [nodes, draft],
  )
  const byId = useMemo(() => new Map(displayNodes.map((n) => [n.id, n])), [displayNodes])

  /**
   * 从列表拖出一张卡时，**能当它上级**的那些卡（连线规则里允许「它 → 拖拽卡」的）。
   * 这些卡描一圈呼吸的光：不用试就知道手松在谁身上能接住。
   */
  const candidateIds = useMemo(() => {
    if (!paletteKind) return null
    return new Set(nodes.filter((n) => canConnect(n.kind, paletteKind)).map((n) => n.id))
  }, [paletteKind, nodes])

  /**
   * 每条边画在哪：折线走 `edgeRoute`（会绕开卡片），曲线取贝塞尔控制点。
   *
   * 算一次给三处用——画线、点选、两颗小圆点认同一份点列，
   * 否则就会出现「看着绕开了、点它却没反应」。拖动时跟着 draft 重算。
   */
  const routes = useMemo(() => {
    const out = new Map<string, Point[]>()
    for (const edge of edges) {
      const from = byId.get(edge.from)
      const to = byId.get(edge.to)
      if (!from || !to) continue
      const anchor = anchorOf(edge)
      out.set(
        `${edge.from}>${edge.to}`,
        edgeStyle === 'curved' ? edgeCurve(from, to, height, anchor) : edgeRoute(from, to, displayNodes, height, anchor),
      )
    }
    return out
  }, [edges, byId, displayNodes, height, anchorOf, edgeStyle])
  const routeOf = useCallback(
    (edge: { from: string; to: string }) => routes.get(`${edge.from}>${edge.to}`),
    [routes],
  )

  /* ---------- 空格：按住时左键临时变成「抓手」 ---------- */

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTextEntryTarget(e.target)) return
      e.preventDefault() // 否则页面会往下滚
      spaceRef.current = true
      setSpaceDown(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      spaceRef.current = false
      setSpaceDown(false)
    }
    // 切走窗口时按键的 keyup 收不到，回来还停在「按住空格」的状态，这里兜一下
    const blur = () => {
      spaceRef.current = false
      setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

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

  /*
   * （曾经的「一次性升级：已挂目标项但还是空节点的文档卡，补成带标题的壳」已删——
   * 文档节点不再有「带名空文档」的中间态：空文档就该是空节点，标题从上游目标项借来
   * 显示，点「生成文档」那一刻才建实体。这个 effect 恰好会把被禁止的中间态造回来。）
   */

  /* ---------- 镜头 ---------- */

  /**
   * 镜头跳转：**滑过去**而不是瞬移。
   *
   * 做法是给平面挂 300ms 的 transition-transform，跳完再摘掉——一直挂着的话，
   * 手动拖动与滚轮也会变成「带惯性的慢半拍」，那是另一种难受。
   */
  const animateCamera = useCallback((next: { x: number; y: number; zoom: number }) => {
    setAnimating(true)
    setCamera(next)
    if (animTimer.current !== null) window.clearTimeout(animTimer.current)
    animTimer.current = window.setTimeout(() => {
      animTimer.current = null
      setAnimating(false)
    }, 320)
  }, [])

  const fit = useCallback(() => {
    const box = boundsOf(nodes, height)
    if (!box || !view.width || !view.height) return
    const zoom = fitZoom(box, view)
    animateCamera({ ...centerPan(box, view, zoom), zoom })
  }, [nodes, height, view, animateCamera])

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
  useEffect(
    () => () => {
      if (animTimer.current !== null) window.clearTimeout(animTimer.current)
    },
    [],
  )

  const centerOn = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id)
      if (!node || !view.width) return
      const zoom = Math.max(cameraRef.current.zoom, 1)
      animateCamera({
        ...centerPan({ x: node.x, y: node.y, width: CARD_W, height: height(node) }, view, zoom),
        zoom,
      })
      setSelectedId(id)
      flash(id)
    },
    [nodes, view, height, flash, animateCamera],
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
      animateCamera({ ...centerPan({ x: target.x, y: target.y, width: CARD_W, height: height(target) }, view, zoom), zoom })
      setSelectedId(target.id)
      flash(target.id)
    }
    onFocusHandled?.()
  }, [focusTarget, nodes, view, height, onFocusHandled, flash, animateCamera])

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
      // Shift + 滚轮：横向滚动（触控板横滑本来就给 deltaX，两种都给上）
      const dx = e.shiftKey ? e.deltaY : e.deltaX
      const dy = e.shiftKey ? 0 : e.deltaY
      setCamera({ ...cam, x: cam.x - dx, y: cam.y - dy })
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
      y: (clientY - top - cam.y) / cam.zoom,
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
      /*
       * 合并在这一处做：调用点只关心「节点/连线变了什么」，不用记得把其他字段带上。
       * 墓碑与画法**显式接手**（谁给了用谁的，没给保留当前值）——「用户删掉的卡不许
       * 被任何一次改动冲回来」在写路径上的最后一道闸，不依赖每条上游链路都记得透传。
       */
      onChange({
        ...map,
        ...next,
        version: 1,
        hidden: next.hidden ?? map.hidden,
        edgeStyle: next.edgeStyle ?? map.edgeStyle,
      })
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
    setMultiIds(null)
  }, [onChange])

  /** 换目标就清空：A 课的撤回不该退到 B 课去 */
  useEffect(() => {
    historyRef.current = []
    setCanUndo(false)
  }, [goalId])

  const removeNode = useCallback(
    (id: string) => {
      // 入口是每张图默认存在的起点（派生长出来的），不在「可以删」的范畴里
      if (entryId && id === entryId) {
        onToast?.(t('入口节点是每张图的默认起点，不能删除'))
        return
      }
      // 删什么、墓碑怎么记、边怎么清——规则在领域层（removeNodeFromMap），三条删除路径共用
      const next = removeNodeFromMap(map, id)
      // 没这个节点：原样返回，不写回、不弹提示，不留下一条空撤回
      if (next === map) return
      commit(next)
      onToast?.(t('已从画布上移除。内容没有删，Ctrl+Z 可以撤回'))
      setSelectedId(null)
      // 三条删除路径（垃圾桶 / Delete 键 / 右键菜单）都从这走：节点没了，菜单别悬着
      setMenu(null)
    },
    [entryId, map, commit, onToast],
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
      if (fromNode?.kind === 'outline' && toNode?.kind === 'doc') {
        const slots = outlineSlots(store, fromNode, nodes, edges)
        const key = slotKeyOf(toNode)
        const slot = key ? slots.find((s) => s.key === key) : undefined
        if (!slot) {
          onToast?.(t('这张大纲没有这个接入点：子文档只能挂在它的某个目标项上'))
          return false
        }
        if (slot.childId && slot.childId !== to) {
          onToast?.(t('「{0}」这个目标项已经挂了一个文档', slot.title))
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

  /** 把某份文档挂到某条目标项上（连线时用；一个接入点只挂一份） */
  const assignSlot = useCallback(
    (outlineId: string, docId: string, key: string) => {
      const outline = nodes.find((n) => n.id === outlineId)
      const doc = nodes.find((n) => n.id === docId)
      if (!outline || !doc || doc.kind !== 'doc') return false
      const slot = outlineSlots(store, outline, nodes, edges).find((s) => s.key === key)
      if (!slot) {
        onToast?.(t('这张大纲没有这个接入点'))
        return false
      }
      if (slot.childId && slot.childId !== docId) {
        onToast?.(t('「{0}」这个目标项已经挂了一个文档', slot.title))
        return false
      }
      if (slot.childId === docId) return true
      const nextNodes = nodes.map((n) => (n.id === docId ? { ...n, slot: key } : n))
      const linked = edges.some((e) => e.from === outlineId && e.to === docId)
      commit({ version: 1, nodes: nextNodes, edges: linked ? edges : [...edges, { from: outlineId, to: docId }] })
      return true
    },
    [nodes, edges, store, commit, onToast],
  )

  /* ---------- 点目标项 ---------- */

  const onSlotClick = useCallback(
    (parentId: string, key: string) => {
      const parent = nodes.find((n) => n.id === parentId)
      if (!parent) return
      const slot = outlineSlots(store, parent, nodes, edges).find((s) => s.key === key)
      if (!slot) return
      if (slot.childId) {
        centerOn(slot.childId)
        return
      }
      /*
       * 点目标项 = 挂一份**空文档节点**（不是实体）。文档节点不再有「带名空文档」的
       * 中间态：空文档的标题从这条目标项借来显示（纯 UI，见卡片渲染），点「生成文档」
       * 那一刻才建实体。与「从列表拖到目标项上」是同一种落地。
       */
      const child: StructureNode = {
        id: crypto.randomUUID(),
        kind: 'doc',
        slot: slot.key,
        // 经上游落地：目标项正下方常被兄弟占着，往下找第一块空位
        ...freeSpotNear(
          nodes,
          { x: parent.x + CARD_W + 112, y: parent.y + slot.index * (CARD_H + 24) },
          { width: CARD_W, height: CARD_H },
          height,
        ),
      }
      commit({ version: 1, nodes: [...nodes, child], edges: [...edges, { from: parent.id, to: child.id }] })
      setSelectedId(child.id)
      onToast?.(t('「{0}」的空文档已挂上：点卡片上的「生成文档」让 AI 来写', slot.title))
    },
    [centerOn, edges, nodes, commit, height, onToast, store],
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
    }, height, slotOrderOf(store, goalId))
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
  }, [nodes, edges, height, store, goalId, commit])

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
      // id/ref 怎么换、边怎么改指向、什么情况算无事可做——规则在领域层（renameLeafInMap）
      const renamed = renameLeafInMap(map, node, to)
      if (!renamed) {
        setMenu(null)
        return
      }
      // 实体那一侧先改名：图里只有引用，内容永远只存一份——实体先到位，派生才对得上新 id
      onRenameNote?.(renamed.leaf.owner, renamed.leaf.name, to.trim())
      commit(renamed.map)
      setMenu(null)
    },
    [map, commit, onRenameNote],
  )

  /* ---------- 指针 ---------- */

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      const el = containerRef.current
      if (!el) return
      /*
       * 平移画布只有两条路：**中键**，或者**按住空格 + 左键**。
       * 左键留给节点（拖、连、选），空地上按左键不再拖动画布——
       * 那样一不小心就会把整张图推走，还分不清是拖动还是点空了。
       */
      if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
        e.preventDefault() // 中键在 Chromium 里会触发自动滚动
        setAnimating(false)
        if (e.button === 1) {
          /*
           * 双击中键 = 适应画布。判定必须放在 pointerdown：这里的 preventDefault
           * 会抑制兼容 mousedown（双击因此收不到 dblclick，也不能靠 onMouseDown 计时）。
           */
          const now = performance.now()
          if (now - lastMiddleDownRef.current < 400) {
            lastMiddleDownRef.current = 0
            fit()
            return
          }
          lastMiddleDownRef.current = now
        }
        el.setPointerCapture(e.pointerId)
        const cam = cameraRef.current
        gestureRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y }
        return
      }
      if (e.button !== 0) return
      // 菜单、按钮、输入框：容器一旦捕获指针，它们就收不到 click 了
      if (target.closest('button, textarea, input, [data-menu]')) return
      if (menu) {
        setMenu(null)
        return
      }
      setAnimating(false)
      el.setPointerCapture(e.pointerId)

      const paletteEl = target.closest<HTMLElement>('[data-palette-kind]')
      if (paletteEl) {
        const kind = paletteEl.dataset.paletteKind as GraphKind
        gestureRef.current = { mode: 'palette', kind }
        setPaletteKind(kind)
        setPaletteAt({ x: e.clientX, y: e.clientY })
        return
      }

      const dotEl = target.closest<HTMLElement>('[data-slot-dot]')
      if (dotEl) {
        const from = dotEl.dataset.slotDotParent as string
        gestureRef.current = { mode: 'link', from, slotKey: dotEl.dataset.slotDot as string, moved: false }
        setLinkFrom(from)
        setLinkSlot(dotEl.dataset.slotDot as string)
        setLinkAt(toWorld(e.clientX, e.clientY))
        setSelectedId(from)
        return
      }

      const addEl = target.closest<HTMLElement>('[data-add-slot]')
      if (addEl) {
        const nodeId = addEl.dataset.addSlot as string
        setMenuText('')
        setMenu({ x: e.clientX, y: e.clientY, nodeId, mode: 'slot' })
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
        setLinkSlot(null)
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
        setMultiIds(null)
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
      const dot = edgeDotAt(nodes, edges, world.x, world.y, 12 / cameraRef.current.zoom, height, edgeStyle, anchorOf, routeOf)
      if (dot) {
        centerOn(dot.side === 'from' ? dot.edge.to : dot.edge.from)
        return
      }
      const edge = edgeAt(nodes, edges, world.x, world.y, 8 / cameraRef.current.zoom, height, edgeStyle, anchorOf, routeOf)
      if (edge) {
        setSelectedEdge(edge)
        setSelectedId(null)
        setMultiIds(null)
        return
      }
      // 空地按下左键：清掉选择，开始拉选框（松手时圈住谁就选谁）
      setSelectedId(null)
      setSelectedEdge(null)
      setMultiIds(null)
      gestureRef.current = { mode: 'marquee', startX: world.x, startY: world.y }
      setMarquee({ x: world.x, y: world.y, width: 0, height: 0 })
    },
    [centerOn, edges, height, menu, nodes, onSlotClick, toWorld, anchorOf, edgeStyle, routeOf],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gestureRef.current
      if (!g) {
        // 没有手势：算「指针附近有没有连线」，小圆点只在此时露面
        const world = toWorld(e.clientX, e.clientY)
        const dot = edgeDotAt(nodes, edges, world.x, world.y, 12 / cameraRef.current.zoom, height, edgeStyle, anchorOf, routeOf)
        const edge =
          dot?.edge ??
          edgeAt(nodes, edges, world.x, world.y, 8 / cameraRef.current.zoom, height, edgeStyle, anchorOf, routeOf)
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
        g.moved = true
        setLinkAt(world)
        setHoverId(hitTest(nodes, world.x, world.y, height)?.id ?? null)
        return
      }
      if (g.mode === 'marquee') {
        setMarquee({
          x: Math.min(g.startX, world.x),
          y: Math.min(g.startY, world.y),
          width: Math.abs(world.x - g.startX),
          height: Math.abs(world.y - g.startY),
        })
        return
      }
      setPaletteAt({ x: e.clientX, y: e.clientY })
      setHoverId(hitTest(nodes, world.x, world.y, height)?.id ?? null)
      // 记录「离开过列表」：一直在列表上晃然后松手，是放回去，不是放置
      const listRect = paletteRef.current?.getBoundingClientRect()
      if (
        listRect &&
        !(e.clientX >= listRect.left && e.clientX <= listRect.right && e.clientY >= listRect.top && e.clientY <= listRect.bottom)
      ) {
        g.leftList = true
      }
    },
    [anchorOf, edgeStyle, edges, height, isOverTrash, nodes, toWorld, routeOf],
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
        // 从圆点上按下但没拖动 = 点了一下这条目标项
        if (!g.moved && g.slotKey) {
          onSlotClick(g.from, g.slotKey)
          setLinkFrom(null)
          setLinkSlot(null)
          setLinkAt(null)
          setHoverId(null)
          return
        }
        // 一、把线拖到某颗目标项圆点上：由那条目标项接住
        // 用 elementFromPoint 认元素，不再按坐标算——圆点就在行里，DOM 说了算
        const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-slot-dot]')
        if (under) {
          const parentId = under.dataset.slotDotParent ?? ''
          const key = under.dataset.slotDot ?? ''
          if (parentId && key && g.from !== parentId) assignSlot(parentId, g.from, key)
          setLinkFrom(null)
          setLinkSlot(null)
          setLinkAt(null)
          setHoverId(null)
          return
        }
        // 二、落在某张文档卡上：如果这次是从目标项圆点拉出来的，就挂到那条目标项上
        const target = hitTest(nodes, world.x, world.y, height)
        if (target && target.id !== g.from && g.slotKey && target.kind === 'doc') {
          assignSlot(g.from, target.id, g.slotKey)
          setLinkFrom(null)
          setLinkSlot(null)
          setLinkAt(null)
          setHoverId(null)
          return
        }
        if (target && target.id !== g.from && !addEdge(g.from, target.id)) {
          onToast?.(t('这两个节点不能这样连：下游不能回流，笔记/试卷/超级文档只能挂在文档下面'))
        }
        setLinkFrom(null)
        setLinkSlot(null)
        setLinkAt(null)
        setHoverId(null)
        return
      }

      if (g.mode === 'marquee') {
        const rect = marquee
        setMarquee(null)
        // 几乎没拉：当成一次普通点击（选择已清），不进入多选
        if (!rect || (rect.width < 4 && rect.height < 4)) return
        const found = nodes.filter((n) => {
          const r = rectOf(n, height)
          return r.x < rect.x + rect.width && rect.x < r.x + r.width && r.y < rect.y + rect.height && rect.y < r.y + r.height
        })
        if (!found.length) return
        if (found.length === 1) {
          setSelectedId(found[0].id)
          setMultiIds(null)
        } else {
          setMultiIds(new Set(found.map((n) => n.id)))
          setSelectedId(null)
        }
        return
      }

      if (g.mode === 'palette') {
        setPaletteAt(null)
        setPaletteKind(null)
        setHoverId(null)
        if (!g.leftList) {
          /*
           * 没离开过列表就松手 = 把它放回去了，不建。快速拖一下可能连一次
           * pointermove 都没发出来，所以这里按**松手位置**补判一次。
           */
          const listRect = paletteRef.current?.getBoundingClientRect()
          const inList =
            !!listRect &&
            e.clientX >= listRect.left &&
            e.clientX <= listRect.right &&
            e.clientY >= listRect.top &&
            e.clientY <= listRect.bottom
          if (inList) return
        }

        const world = toWorld(e.clientX, e.clientY)
        const target = hitTest(nodes, world.x, world.y, height)

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
          // 经上游落地：找一块不与现有卡重叠的位置，别叠在兄弟身上
          const spot = target
            ? freeSpotNear(nodes, { x: target.x + CARD_W + 96, y: target.y }, { width: CARD_W, height: CARD_H }, height)
            : { x: world.x - CARD_W / 2, y: world.y - CARD_H / 2 }
          const node: StructureNode = {
            id: crypto.randomUUID(),
            kind: 'note',
            ref: `${ownerId}:${name}`,
            x: spot.x,
            y: spot.y,
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

        /*
         * 试卷与超级文档：实体先行。拖到文档卡上就建真实空实体（壳），
         * 卡的 id 从实体确定性派生——落位、连线、后续「生成」填充全都不需要对账。
         */
        if (g.kind === 'exam' || g.kind === 'superdoc') {
          const ownerId = target?.kind === 'doc' ? target.ref : null
          if (!ownerId || (g.kind === 'exam' ? !onCreateExam : !onCreateSuperDoc)) {
            onToast?.(t('挂件要挂在文档节点下面：把它拖到某张文档卡上'))
            return
          }
          const spot = freeSpotNear(
            nodes,
            { x: target!.x + CARD_W + 96, y: target!.y },
            { width: CARD_W, height: CARD_H },
            height,
          )
          if (g.kind === 'exam') {
            const id = onCreateExam!(ownerId)
            if (!id) return
            const node: StructureNode = { id: examGid(id), kind: 'exam', ref: id, x: spot.x, y: spot.y }
            commit({ version: 1, nodes: [...nodes, node], edges: [...edges, { from: target!.id, to: node.id }] })
            setSelectedId(node.id)
            onToast?.(t('已放一份空试卷：点卡片上的「生成试卷」让 AI 出题'))
          } else {
            const name = onCreateSuperDoc!(ownerId)
            if (!name) return
            const node: StructureNode = { id: superdocGid(ownerId, name), kind: 'superdoc', ref: `${ownerId}:${name}`, x: spot.x, y: spot.y }
            commit({ version: 1, nodes: [...nodes, node], edges: [...edges, { from: target!.id, to: node.id }] })
            setSelectedId(node.id)
            onToast?.(t('已放一份空超级文档「{0}」：点「生成超级文档」让 AI 来写', name))
          }
          return
        }
      }
    },
    [addEdge, draft, edges, height, isOverTrash, marquee, nodes, commit, onCreateExam, onCreateNote, onCreateSuperDoc, onToast, openNode, removeNode, toWorld],
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
      // 右键回到单选：菜单只作用在一张卡上，多选态就此散掉
      setMultiIds(null)
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
        setMultiIds(null)
        return
      }
      /*
       * 输入位里的键盘归输入框：注释 / 改名 / 新目标项的 textarea 就长在画布容器里，
       * 按键会冒上来。不拦的话，写注释时按个退格就会把**当前选中的节点**删掉
       * （右键打开菜单时它正是 selectedId），Ctrl+Z 也会被画布抢走、文本没法撤回。
       */
      if (isTextEntryTarget(e.target)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (selectedEdge) {
        e.preventDefault()
        /*
         * 断开「大纲 → 文档」的连线时，把文档身上那条目标项的索引（slot）一并撤掉——
         * 只删边的话，双方在数据层面还互相指着：大纲的圆点照样亮、文档照样占着接入点。
         * （outlineSlots 的占用判定现在也要求有连线兜底，这里是把数据本身洗干净。）
         */
        const removed = edges.filter((x) => x.from === selectedEdge.from && x.to === selectedEdge.to)
        commit({
          version: 1,
          nodes: nodes.map((n) =>
            n.kind === 'doc' && n.slot && removed.some((e) => e.to === n.id) ? { ...n, slot: undefined } : n,
          ),
          edges: edges.filter((x) => !(x.from === selectedEdge.from && x.to === selectedEdge.to)),
        })
        setSelectedEdge(null)
        return
      }
      const ids = (selectedId ? [selectedId] : multiIds ? [...multiIds] : []).filter((id) => id !== entryId)
      if (!ids.length) return
      e.preventDefault()
      if (ids.length === 1) {
        removeNode(ids[0])
        return
      }
      // 多选一把删：一次写回、一条撤回
      let next = map
      for (const id of ids) next = removeNodeFromMap(next, id)
      commit(next)
      onToast?.(t('已移除 {0} 张卡。内容没有删，Ctrl+Z 可以撤回', String(ids.length)))
      setSelectedId(null)
      setMultiIds(null)
      setMenu(null)
    },
    [edges, nodes, map, commit, onToast, removeNode, multiIds, selectedEdge, selectedId, entryId],
  )

  /* ---------- 渲染 ---------- */

  /*
   * 量一遍目标项圆点的真实位置。
   *
   * 连线端点原来按 `slotAnchorY(i)` 算，卡片里只要多一个 padding、边框或行高变化就会偏，
   * 已经偏过两次。这里直接读 DOM 的 offsetTop —— 圆点在哪，线的起点就在哪。
   */
  useLayoutEffect(() => {
    const root = planeRef.current
    if (!root) return
    const zoom = cameraRef.current.zoom || 1
    const next: Record<string, number> = {}
    for (const el of root.querySelectorAll<HTMLElement>('[data-slot-dot]')) {
      const card = el.closest<HTMLElement>('[data-node-id]')
      if (!card) continue
      /*
       * 必须用 getBoundingClientRect，不能用 offsetTop：
       * offsetTop 只反映「计算出来的 top」，**不含 transform**，而圆点是靠
       * `translateY(-50%)` 居中的——按 offsetTop 量会整整低半个圆点（5px）。
       * 两个 rect 都在同一层变换里，相减再除以 zoom 就是世界坐标。
       */
      const cardRect = card.getBoundingClientRect()
      const rect = el.getBoundingClientRect()
      next[`${el.dataset.slotDotParent ?? ''}|${el.dataset.slotDot ?? ''}`] =
        (rect.top + rect.height / 2 - cardRect.top) / zoom
    }
    setDotY((prev) => {
      const keys = Object.keys(next)
      const same =
        keys.length === Object.keys(prev).length && keys.every((k) => Math.abs((prev[k] ?? -1) - next[k]) < 0.5)
      return same ? prev : next
    })
  }, [displayNodes, height, dotY, camera.zoom])


  const dragging = !!draft
  const menuNode = menu ? nodes.find((n) => n.id === menu.nodeId) ?? null : null

  const edgeOrigin = bounds ? { x: bounds.x - 240, y: bounds.y - 240 } : { x: 0, y: 0 }
  const edgeSize = bounds ? { width: bounds.width + 480, height: bounds.height + 480 } : { width: 0, height: 0 }
  const zoomPct = Math.round(camera.zoom * 100)

  /* ---------- 全景缩略图 ---------- */

  /** 缩略图的世界包络与缩放系数：节点总包围盒外扩一圈留白，装进固定大小的窗口 */
  const mini = useMemo(() => {
    if (!bounds) return null
    const pad = 40
    const b = { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 }
    const scale = Math.min(MINI_W / b.width, MINI_H / b.height, MINI_MAX_SCALE)
    return { bounds: b, scale, width: b.width * scale, height: b.height * scale }
  }, [bounds])
  const miniRef = useRef<SVGSVGElement | null>(null)
  const minimapDragRef = useRef(false)

  /** 把缩略图上的一点变成镜头中心（屏幕坐标 → 世界坐标 → 相机平移） */
  const jumpByMinimap = useCallback(
    (clientX: number, clientY: number) => {
      const el = miniRef.current
      const m = mini
      if (!el || !m) return
      const rect = el.getBoundingClientRect()
      const wx = m.bounds.x + (clientX - rect.left) / m.scale
      const wy = m.bounds.y + (clientY - rect.top) / m.scale
      const cam = cameraRef.current
      setAnimating(false)
      setCamera({ x: view.width / 2 - wx * cam.zoom, y: view.height / 2 - wy * cam.zoom, zoom: cam.zoom })
    },
    [mini, view],
  )
  const onMinimapPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.stopPropagation() // 别让画布把它当成「空地点击」清选择
    e.currentTarget.setPointerCapture(e.pointerId)
    minimapDragRef.current = true
    jumpByMinimap(e.clientX, e.clientY)
  }
  const onMinimapPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!minimapDragRef.current) return
    e.stopPropagation()
    jumpByMinimap(e.clientX, e.clientY)
  }
  const onMinimapPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    minimapDragRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onPointerDown={onPointerDown}
      // 中键在 Chromium 里会触发「自动滚动」，pointerdown 上的 preventDefault 拦不住
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      className="relative h-full w-full select-none overflow-hidden bg-paper outline-none dark:bg-card/30"
      style={{ cursor: hoverDot ? 'pointer' : spaceDown ? 'grab' : undefined }}
    >
      {/*
        画布平面：纯 2D（只有平移与缩放，没有倾斜、没有 z 轴）。
        拖动时整层抬到垃圾桶之上，这样拖到删除区附近也看得见手里的节点。
      */}
      <div
        ref={planeRef}
        className={`absolute top-0 left-0 origin-top-left ${dragging ? 'z-30' : 'z-0'} ${
          animating ? 'transition-transform duration-300 ease-out' : ''
        }`}
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
              const path = routeOf(edge)
              if (!path) return null
              // 世界坐标 → SVG 坐标（这一层是从包围盒左上角铺开的）
              const points = path.map((p) => ({ x: p.x - edgeOrigin.x, y: p.y - edgeOrigin.y }))
              const isSelected = selectedEdge?.from === edge.from && selectedEdge?.to === edge.to
              const color = edgeColorOf(store, displayNodes, edge)
              const dots = edgeDots(points, edgeStyle)
              // 悬停目标项 → 对应的那条子大纲连线发光
              const slotKey = slotKeyOf(to)
              const glow =
                !!hoverSlot && hoverSlot.parentId === edge.from && slotKey === hoverSlot.key
              const isHoveredEdge =
                (hoverEdge?.from === edge.from && hoverEdge?.to === edge.to) || isSelected || glow
              const showDots = hoverEdge?.from === edge.from && hoverEdge?.to === edge.to
              return (
                <g key={`${edge.from}>${edge.to}`}>
                  <path
                    d={edgePathD(points, edgeStyle)}
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
                          cx={p.x}
                          cy={p.y}
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
              // 从目标项圆点上拉出来的线，起点要落在**那颗圆点**上（用实测值，不用算）
              const measured = linkSlot ? dotY[`${from.id}|${linkSlot}`] : undefined
              // 虚线用目标项统一色：圆点是什么色，线就是什么色
              const linkColor = linkSlot && from.kind === 'outline' ? SLOT_ACCENT : undefined
              const slotIndex =
                measured == null && linkSlot && from.kind === 'outline'
                  ? outlineSlots(store, from, nodes, edges).findIndex((s) => s.key === linkSlot)
                  : -1
              const anchorFrom = measured ?? (slotIndex >= 0 ? slotAnchorY(slotIndex) : undefined)
              const curve = edgeCurve(
                from,
                { id: '', kind: from.kind, x: linkAt.x, y: linkAt.y - CARD_H / 2 },
                height,
                anchorFrom == null ? undefined : { from: anchorFrom },
              )
              /*
                跟手的这条是**橡皮筋**：终点跟着指针乱跑，按「绕开卡片」去算会一路抖，
                所以它保持老画法（出线 → 竖直 → 进线），落手之后才走真正的路由。
              */
              const points = (edgeStyle === 'curved' ? curve : edgeElbow(curve[0], curve[3])).map((p) => ({
                x: p.x - edgeOrigin.x,
                y: p.y - edgeOrigin.y,
              }))
              return (
                <path
                  d={edgePathD(points, edgeStyle)}
                  fill="none"
                  // 虚线颜色跟着接入点走：拉的是哪一条，线就是那条的颜色
                  stroke={linkColor ?? 'currentColor'}
                  className={linkColor ? '' : 'text-seal/70'}
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
          const multi = multiIds?.has(node.id) ?? false
          const isHovered = hoverId === node.id
          const empty = !node.ref
          const h = height(node)
          const slots = node.kind === 'outline' ? outlineSlots(store, node, nodes, edges) : []
          const openable = node.kind !== 'outline'
          const lifted = draft?.id === node.id
          const hasUpstream = edges.some((e) => e.to === node.id)
          // 文档卡还没占任何目标项 = 还没确定要做什么，置灰（不点亮任何一条目标项）。
          // slot 是与上游大纲的约定：连线断了，占用关系也就不成立了（残留的 slot 不算数）
          const unassigned = node.kind === 'doc' && (!slotKeyOf(node) || !hasUpstream)
          const upstreamEdge = hasUpstream ? edges.find((e) => e.to === node.id) : undefined
          const upstreamNode = upstreamEdge ? byId.get(upstreamEdge.from) ?? null : null
          const upstreamDocRef = upstreamNode?.kind === 'doc' ? upstreamNode.ref ?? null : null
          // 空文档接了上游并占了一条目标项 = 它要落地什么已经确定，可以交给 AI 写正文
          const canGenerate = node.kind === 'doc' && !view.excerpt && hasUpstream && !!slotKeyOf(node)
          /*
           * 试卷/超级文档卡「生成」的落点：有 ref 的按 ref 找所属知识节点
           * （试卷按 exam.nodeId，超级文档按 ref 前半段）；空卡借上游文档的 ref。
           * 生成都是往**知识节点**上长的（出卷/超级实验室工作流的入口就是 nodeId），
           * 新长出来的卡由派生自己补上。
           */
          let leafOwnerNodeId: string | null = null
          if (node.kind === 'exam') {
            leafOwnerNodeId = node.ref ? store.exams.find((e) => e.id === node.ref)?.nodeId ?? null : upstreamDocRef
          } else if (node.kind === 'superdoc') {
            leafOwnerNodeId = node.ref ? splitLeafRef(node.ref)?.owner ?? null : upstreamDocRef
          }
          // 入口的子文档 = 这门课的权威根节点（从哪儿开始学），挂徽章
          const authoritativeRoot =
            node.kind === 'doc' && edges.some((e) => e.to === node.id && byId.get(e.from)?.kind === 'entry')
          /*
           * 空文档节点的标题是**借来的**：接了上游就显示上游大纲里对应目标项的标题，
           * 纯 UI 层——数据里它仍是一张空卡。连线一断标题即消失（它没有自己的身份）；
           * 有内容的文档不受影响（断线只失去连接关系，不失去身份）。
           */
          let displayTitle = view.title
          if (node.kind === 'doc' && empty && upstreamNode?.kind === 'outline') {
            const key = slotKeyOf(node)
            const entry = outlineSlots(store, upstreamNode, nodes, edges).find((s) => s.key === key)
            if (entry) displayTitle = entry.title
          }
          return (
            <Fragment key={node.id}>
            <div
              data-node-id={node.id}
              className={`absolute flex flex-col border ${KIND_TONE[node.kind]} ${
                empty || unassigned ? 'border-dashed' : ''
              } ${unassigned ? 'opacity-70' : ''} ${
                selected || multi ? 'ring-2 ring-seal/60' : isHovered ? 'ring-1 ring-seal/35' : ''
              } ${lifted ? 'shadow-lg' : 'shadow-sm'} ${flashId === node.id ? 'moji-structure-flash' : ''} ${
                candidateIds?.has(node.id) ? 'moji-structure-candidate' : ''
              }`}
              style={{
                left: node.x,
                top: node.y,
                width: CARD_W,
                height: h,
                cursor: lifted ? 'grabbing' : 'grab',
              }}
            >
              {/*
                标题行高度**必须**等于 OUTLINE_HEAD：目标项圆点的 y 是按这个常量算的
                （slotAnchorY = OUTLINE_HEAD + 行号 × 行高）。这里一旦改成 minHeight 或加
                padding，圆点就会和它那一行错开——真错过一次。
              */}
              <div className="flex shrink-0 items-center gap-1.5 px-3" style={{ height: OUTLINE_HEAD }}>
                <span className={`shrink-0 px-1.5 py-[1px] text-[10px] font-semibold ${KIND_BADGE[node.kind]}`}>
                  {t(GRAPH_KIND_LABEL[node.kind])}
                </span>
                <span
                  {...(openable ? { 'data-open-title': node.id } : {})}
                  title={openable ? t('点标题直接打开') : undefined}
                  className={`min-w-0 flex-1 truncate text-[13px] font-medium text-ink ${
                    openable ? 'hover:text-seal hover:underline' : ''
                  }`}
                >
                  {displayTitle}
                </span>
                {authoritativeRoot && (
                  <span
                    title={t('入口节点选定的文档：这门课从这里开始')}
                    className="shrink-0 rounded bg-rose-500/15 px-1 py-[1px] text-[9px] font-semibold text-rose-600 dark:text-rose-300"
                  >
                    {t('权威根')}
                  </span>
                )}
                {view.missing && <span className="text-[10px] text-rose-500">{t('内容不在了')}</span>}
              </div>

              {node.kind === 'outline' && slots.length > 0 ? (
                /* 容器不带左右内边距：行自己带，圆点才能贴到卡片右边框上 */
                /* 不能加 overflow-hidden：圆点要伸出卡片右边框半颗，裁了连点击都收不到 */
                <div className="flex flex-col pb-2">
                  {slots.map((slot) => (
                    <div
                      key={slot.key}
                      data-slot-key={slot.key}
                      data-slot-parent={node.id}
                      title={slot.childId ? t('跳到这个子文档') : t('生成一份空文档')}
                      onPointerEnter={() => setHoverSlot({ parentId: node.id, key: slot.key })}
                      onPointerLeave={() => setHoverSlot(null)}
                      className="relative flex cursor-pointer items-center gap-1.5 pr-3 pl-2 hover:bg-seal/[0.08]"
                      style={{ height: SLOT_ROW }}
                    >
                      <span className="h-2 w-2 shrink-0" />
                      <span
                        className="truncate text-[11.5px]"
                        style={{ color: slot.childId ? SLOT_ACCENT : undefined, opacity: slot.childId ? 1 : 0.55 }}
                      >
                        {slot.title}
                      </span>
                      {/*
                        圆点放在**这一行里面**：垂直居中由 flex 自动保证，
                        再也不用「按常量算 y」——那个算法已经错过两次。
                        水平方向 right: -0.5px 再平移半颗：圆心正好压在 1px 边框的**中线**上
                        （绝对定位的参照是 padding box，边框中线在参照缘外 0.5px）。
                      */}
                      <span
                        data-slot-dot={slot.key}
                        data-slot-dot-parent={node.id}
                        title={slot.childId ? t('已挂文档：拖出去可换一份') : t('从圆点拖出去挂一份文档')}
                        className="absolute top-1/2 -right-[0.5px] h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 cursor-crosshair rounded-full border-2"
                        style={{
                          borderColor: SLOT_ACCENT,
                          background: slot.childId ? SLOT_ACCENT : 'var(--color-card, #fff)',
                        }}
                      />
                    </div>
                  ))}
                  {/* 手动加一条目标项：这是大纲内容，不是画布节点 */}
                  <div
                    data-add-slot={node.id}
                    title={t('给这份大纲加一条目标项')}
                    className="flex cursor-pointer items-center gap-1.5 pr-3 pl-2 text-[11px] text-ink-faint hover:bg-seal/[0.08] hover:text-seal"
                    style={{ height: SLOT_ROW }}
                  >
                    ＋ {t('添加目标项')}
                  </div>
                </div>
              ) : node.kind === 'doc' && view.excerpt ? (
                /*
                  有正文：**正好两行**摘要。
                  外层只负责裁：高度就是两行的行高之和、**不带内边距**（溢出是在 padding box
                  上裁的，留了 pb 就等于在第三行上开了一条 8px 的窗口，让它探出来半截——
                  这就是「摘要溢出且被截断」的成因）。间距用 margin，margin 在裁剪范围之外。
                  内层留着 line-clamp-2 只为一件事：让第二行末尾出现省略号。
                */
                <div
                  className="overflow-hidden px-3"
                  style={{ height: DOC_LINES * DOC_LINE_H, marginBottom: CARD_PAD_B }}
                >
                  <div className="line-clamp-2 text-[11px] text-ink-soft" style={{ lineHeight: `${DOC_LINE_H}px` }}>
                    {view.excerpt}
                  </div>
                </div>
              ) : node.kind === 'doc' && canGenerate ? (
                /*
                  空文档：**接了上游**才给「生成文档」——它占了哪条目标项已经确定，
                  AI 才有得可写；没接上游的空文档还没确定要做什么，先保持灰。
                  点击把「父大纲 + 所占目标项」作为意图一并交给 agent 的工作流。
                */
                <div className="flex items-center justify-between gap-2 px-3 pb-2">
                  <span className="text-[11px] text-ink-faint">{t('还没有正文')}</span>
                  <button
                    type="button"
                    className="bg-seal/15 px-2 py-0.5 text-[11px] text-seal-deep hover:bg-seal/25"
                    onClick={() => {
                      const slotKey = slotKeyOf(node)
                      const slotTitle =
                        upstreamNode?.kind === 'outline' && slotKey
                          ? outlineSlots(store, upstreamNode, nodes, edges).find((s) => s.key === slotKey)?.title
                          : undefined
                      // 意图取舍：这是一次**空节点填充**——先把「写进当前节点、别建节点」钉死
                      // （开讲指令的边界同款），再给定位：它落地哪条大纲目标项、范围怎么错开
                      const hint =
                        upstreamNode?.ref && slotTitle
                          ? `【本轮是空节点填充】节点实体已就位，它就是当前节点：教学文档直接写进当前节点（api.node() 省略地址即它），不要创建任何新节点、不要拆下一层大纲。它的定位：大纲「${resolveNodeView(store, upstreamNode).title}」里「${slotTitle}」这条目标项的落地文档——正文围绕这条目标项展开，范围与同纲其他目标项错开。`
                          : undefined
                      if (!node.ref) {
                        /*
                         * 空文档节点：点生成的那一刻才建实体（带目标项标题）。卡片的 id/ref
                         * 就地换血（同 saveRename 的口径）：不换的话，派生会按 docGid(实体)
                         * 补一张新卡，这张 uuid 空卡又被「存过的卡保留」留下——同一份内容两张卡。
                         */
                        if (!upstreamNode?.ref || !slotTitle) return
                        const entityId = onCreateChildDoc?.(upstreamNode.ref, slotTitle) ?? null
                        if (!entityId) {
                          onToast?.(t('没能创建文档实体，请稍后再试'))
                          return
                        }
                        const nextId = docGid(entityId)
                        if (nodes.some((n) => n.id === nextId)) {
                          /*
                           * 同名实体已有一张卡（createNodeUnder 同名复用）：空卡退场，
                           * slot 交接给现有卡——不能换血，否则画布上出现两张同 id 的卡。
                           */
                          commit({
                            version: 1,
                            nodes: nodes
                              .filter((n) => n.id !== node.id)
                              .map((n) =>
                                n.id === nextId && !n.slot && slotKey ? { ...n, slot: slotKey } : n,
                              ),
                            edges: edges.filter((e) => e.from !== node.id && e.to !== node.id),
                          })
                        } else {
                          const swap = (id: string): string => (id === node.id ? nextId : id)
                          commit({
                            version: 1,
                            nodes: nodes.map((n) => (n.id === node.id ? { ...n, id: nextId, ref: entityId } : n)),
                            edges: edges.map((e) => ({ from: swap(e.from), to: swap(e.to) })),
                          })
                        }
                        onGenerateDoc?.(entityId, hint)
                        return
                      }
                      onGenerateDoc?.(node.ref, hint)
                    }}
                  >
                    {t('生成文档')}
                  </button>
                </div>
              ) : (node.kind === 'exam' || node.kind === 'superdoc') && leafOwnerNodeId ? (
                /*
                  试卷 / 超级文档：给一颗「生成」——出卷会先问类型与难度，超级实验室会先问
                  想做什么实验（导师自己问，卡片不用替它问）。生成物往所属知识节点上长，
                  新卡由派生自己补出来。
                */
                <div className="flex items-center justify-between gap-2 px-3 pb-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink-soft">{view.subtitle}</span>
                  <button
                    type="button"
                    className="shrink-0 bg-seal/15 px-2 py-0.5 text-[11px] text-seal-deep hover:bg-seal/25"
                    onClick={() =>
                      node.kind === 'exam'
                        ? docs.onNewExam(leafOwnerNodeId)
                        : docs.onNewSuperDoc(leafOwnerNodeId, splitLeafRef(node.ref ?? '')?.name)
                    }
                  >
                    {node.kind === 'exam' ? t('生成试卷') : t('生成超级文档')}
                  </button>
                </div>
              ) : (
                <div className="truncate px-3 pb-2 text-[11px] text-ink-soft">{view.subtitle}</div>
              )}

              {/*
                接口（连线进出的小圆点）圆心都压在 1px 边框的**中线**上：
                绝对定位的参照是 padding box，边框中线在参照缘外 0.5px——
                用整数偏移会差半像素，看着就是「点没对齐边框」。
                高度与连线的锚点同一个值（EDGE_ANCHOR_Y），拖出的线不会从手柄上方出发。
              */}
              {/*
                接口（连线进出的小圆点）：**统一样式**——实心印章色、卡色描边、不透明
                （不要空心、不要透明度状态）。圆心压在 1px 边框的**中线**上：绝对定位的
                参照是 padding box，边框中线在参照缘外 0.5px。高度与连线锚点同一个值。
                出线接口（右）只长在有出线能力的卡上：doc 与 entry——大纲的出线走目标项
                圆点，叶子没有下游。
              */}
              {(node.kind === 'doc' || node.kind === 'entry') && (
                <div
                  data-link-handle={node.id}
                  title={t('拖出去连到另一个节点')}
                  className="absolute -right-[7.5px] h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-card bg-seal"
                  style={{ top: EDGE_ANCHOR_Y }}
                />
              )}
              {/* 进线接口（左）：实心、不透明。入口不画——没有任何类型能把线连进入口 */}
              {node.kind !== 'entry' && (
                <div
                  className="pointer-events-none absolute -left-[7.5px] h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-card bg-seal"
                  style={{ top: EDGE_ANCHOR_Y }}
                />
              )}
            </div>
            {/*
              注释：**贴在卡片外面**、跟着节点走的一条便签。
              不塞进卡片里——它会撑高卡片、把连线的锚点和自动排列都带偏；
              挂在外面之后，它只是一个跟着坐标走的标签，节点怎么长都不影响。
            */}
            {node.note && (
              <div
                className="absolute max-w-[260px] text-[10.5px] leading-snug text-ink-soft"
                style={{ left: node.x, top: node.y + h + 6, width: CARD_W }}
                title={node.note}
              >
                {node.note}
              </div>
            )}
            </Fragment>
          )
        })}

        {/* 拉选框：跟手的世界坐标矩形（松手把相交的卡都选上） */}
        {marquee && (
          <div
            className="pointer-events-none absolute border border-seal bg-seal/10"
            style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
          />
        )}
      </div>

      {/*
        全景缩略图：节点按类型着色的微缩卡片（带描边与圆角）+ 半透明的当前视口框。
        点/拖哪里，镜头就把哪里居中——大图上找路比滚轮翻得快。
      */}
      {mini && (
        <div
          className="absolute bottom-6 left-4 z-20 flex items-center justify-center rounded-xl border border-line bg-card/90 p-1.5 shadow-sm backdrop-blur"
          style={{ width: MINI_W + 12, height: MINI_H + 12 }}
        >
          <svg
            ref={miniRef}
            width={mini.width}
            height={mini.height}
            className="block cursor-pointer touch-none"
            onPointerDown={onMinimapPointerDown}
            onPointerMove={onMinimapPointerMove}
            onPointerUp={onMinimapPointerUp}
            onPointerCancel={onMinimapPointerUp}
          >
            {displayNodes.map((n) => (
              <rect
                key={n.id}
                x={(n.x - mini.bounds.x) * mini.scale}
                y={(n.y - mini.bounds.y) * mini.scale}
                width={CARD_W * mini.scale}
                height={height(n) * mini.scale}
                rx={2}
                fill={MINI_FILL[n.kind]}
                stroke="var(--color-card, #fff)"
                strokeWidth={0.6}
                opacity={0.85}
              />
            ))}
            <rect
              x={(-camera.x / camera.zoom - mini.bounds.x) * mini.scale}
              y={(-camera.y / camera.zoom - mini.bounds.y) * mini.scale}
              width={(view.width / camera.zoom) * mini.scale}
              height={(view.height / camera.zoom) * mini.scale}
              rx={3}
              fill="var(--color-seal, #a8432f)"
              fillOpacity={0.12}
              stroke="var(--color-seal, #a8432f)"
              strokeOpacity={0.85}
              strokeWidth={1.5}
            />
          </svg>
        </div>
      )}

      {/* 左侧节点列表：拖到画布上生成节点（必须拖出列表再松手，见 Gesture.palette.leftList） */}
      <div
        ref={paletteRef}
        className="absolute top-4 left-4 z-20 flex w-[112px] flex-col gap-1 rounded-xl border border-line bg-card/85 p-2 backdrop-blur"
      >
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
          title={t('切换连线样式')}
          className="rounded px-1.5 py-0.5 hover:bg-line/60"
          onClick={() => {
            const next = EDGE_STYLES[(EDGE_STYLES.indexOf(edgeStyle) + 1) % EDGE_STYLES.length]
            // 只是显示口径，不进撤回栈（Ctrl+Z 不该把线拉回曲线）
            onChange({ ...map, edgeStyle: next })
          }}
        >
          {edgeStyle === 'straight' ? t('直线') : t('曲线')}
        </button>
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
                  // 删除的收尾（撤回提示、关菜单）都由 removeNode 统一处理
                  removeNode(menuNode.id)
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
              {menuNode.kind === 'doc' && menuNode.ref && (
                <button
                  type="button"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                  onClick={() => {
                    // 前置知识大纲：读这份文档，把「学它之前要先会什么」铺成它的大纲
                    // （空大纲卡入口退役后，文档卡自己是唯一触发点）
                    onGenerateOutline?.(menuNode.ref ?? '')
                    setMenu(null)
                  }}
                >
                  {t('生成前置知识大纲')}
                </button>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-1.5 p-1">
              <div className="text-[10px] text-ink-faint">
                {menu.mode === 'note'
                  ? t('写一句注释，贴在卡片底部')
                  : menu.mode === 'rename'
                    ? t('改笔记名（文件名一起改）')
                    : t('新的目标项标题')}
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
                    else if (menu.mode === 'rename') saveRename(menuNode, menuText)
                    else {
                      const title = menuText.trim()
                      if (title) onAddOutlineEntry?.(menuNode.id, title)
                      setMenu(null)
                    }
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
