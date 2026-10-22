/**
 * 这个文件负责什么：**结构图**（页签 kind 'outline' 的新形态）的领域层——节点类型、连线规则、
 * 包围盒与缩放数学、初始铺排。纯函数，不碰 React、不碰文件系统。
 *
 * ## 为什么是「图」而不是「树」
 *
 * 旧的大纲是一棵树：子节点是父节点的一部分，位置由布局算法算出来，用户改不了。
 * 新形态里每个节点是**独立实体**，连线只表达「谁给谁提供上下文」——
 * 所以位置必须由用户拖、并且存下来（树能算，图算不了：同一批节点可以摆成任何形状）。
 *
 * ## 三个不变量（改这个文件前先读这三条）
 *
 * 1. **节点表就是画布**：`nodes` 里有它，画布上就有它；不在表里就是没放上画布。
 *    位置直接长在节点上，不另开一张「id → 坐标」的表——两张表迟早对不齐。
 * 2. **`ref` 为空 = 空节点**：节点可以还没有内容（刚拖出来的文档节点），
 *    它挂在父节点上、继承父节点的信息，生成什么由它自己决定（见 docs 的结构页设计）。
 *    `ref` 一旦有值就指回现有实体（KnowledgeNode / 笔记名 / 试卷 id / 超级文档名），
 *    内容永远只存一份，图里只存引用。
 * 3. **连线规则是唯一的判据**：UI 能不能连、读盘时要不要丢掉这条边，都问 `canConnect`。
 *    规则表本身还顺带保证了「不会成环」——层级严格递增，只有大纲→大纲这一层需要额外查。
 *
 * 别和 `learn/graph/state.ts` 的 `nodeStructure` 混了：那个说的是「一个节点的学习状态」
 * （掌握度 / 错误记忆 / 检验记录），这里的 structure 是「这门课的节点怎么摆、谁连着谁」。
 */

import type { LearnStore } from './types'
import { nodeById } from './graph'

/** 节点类型。顺序即「层级」：越靠后越下游（见 GRAPH_EDGE_RULES） */
export const GRAPH_KINDS = ['outline', 'doc', 'note', 'exam', 'superdoc'] as const
export type GraphKind = (typeof GRAPH_KINDS)[number]

export const GRAPH_KIND_LABEL: Record<GraphKind, string> = {
  outline: '大纲',
  doc: '文档',
  note: '笔记',
  exam: '试卷',
  superdoc: '超级文档',
}

/**
 * 允许的连线：`from` 把上下文交给 `to`。
 *
 * 需求原话（2026-10-21 第二次重构）：「不再是大纲-文档 大纲-大纲，改为文档-大纲，
 * 先文档再大纲。文档可以是大纲的父节点也可以是子节点，但大纲的父子节点只能是文档」。
 *
 * 于是：
 * - **大纲只和文档相连**：`outline → doc`（大纲列目标项、文档去落地）与
 *   `doc → outline`（这份文档自己的大纲）；
 * - **大纲 → 大纲不再允许**：大纲的父子节点只能是文档；
 * - 叶子（笔记 / 试卷 / 超级文档）仍然只挂在文档下面。
 *
 * 层级不再严格递增（doc ↔ outline 可以来回），所以**环检测对每一类边都要做**——
 * 见 canAddEdge 里的 wouldCycle，它不按类型特判。
 */
export const GRAPH_EDGE_RULES: Record<GraphKind, readonly GraphKind[]> = {
  outline: ['doc'],
  doc: ['outline', 'note', 'exam', 'superdoc'],
  note: [],
  exam: [],
  superdoc: [],
}

export function canConnect(from: GraphKind, to: GraphKind): boolean {
  return GRAPH_EDGE_RULES[from].includes(to)
}

/** 一条边能不能加：类型对不对 + 会不会在大纲之间绕回来 */
export function canAddEdge(nodes: readonly StructureNode[], edges: readonly GraphEdge[], from: string, to: string): boolean {
  if (from === to) return false
  const fromKind = kindOf(nodes, from)
  const toKind = kindOf(nodes, to)
  if (!fromKind || !toKind) return false
  if (!canConnect(fromKind, toKind)) return false
  if (edges.some((e) => e.from === from && e.to === to)) return false
  return !wouldCycle(edges, from, to)
}

/**
 * 加这条边会不会成环（从 to 顺着边走，能走回 from 就是环）。
 *
 * 只有「大纲 → 大纲」可能触发，其余类型的层级严格递增、天然无环；
 * 但这里不按类型特判——判据只有一条，少一个分支就少一处「只有某类型才炸」的坑。
 */
export function wouldCycle(edges: readonly GraphEdge[], from: string, to: string): boolean {
  if (from === to) return true
  const seen = new Set<string>()
  const stack = [to]
  while (stack.length) {
    const id = stack.pop() as string
    if (id === from) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of edges) if (e.from === id) stack.push(e.to)
  }
  return false
}

/** 一个图上的节点 */
export interface StructureNode {
  /** 图内 id（uuid）。与 ref 分开：空节点还没有 ref，但它已经在画布上了 */
  id: string
  kind: GraphKind
  /**
   * 指回现有实体的身份；空节点没有这一项。
   * - outline / doc：KnowledgeNode 的 id（大纲内容 / 教学文档都长在那个节点上）
   * - note / superdoc：`{节点 id}:{名字}`（笔记与超级文档都以名字为身份）
   * - exam：试卷 id
   */
  ref?: string
  /**
   * 这个**文档节点**占的是父大纲的哪一个接入点（= 目标项的 key，见 OutlineEntry）。
   *
   * 接入点挂的是文档：大纲列出目标项，每一条目标项由一个文档去落地
   * （「先文档再大纲」——文档是父，大纲是它自己的展开）。
   * 接入点数量是固定的（有几个目标项就有几个），一个接入点只挂一个文档。
   * 记 key 而不是序号：目标项重排、改名（key 跟着标题归一化）都不会把挂接关系弄丢。
   */
  slot?: string
  /**
   * 用户在画布上给这个节点写的注释（右键菜单「注释」）。
   *
   * 与大纲、文档里的内容无关：它是**贴在卡片上的便条**，只在图上看得见。
   * 跟着 structure.json 走——换了设备、重开应用，便条还在原处。
   */
  note?: string
  /** 画布坐标：节点卡片左上角，世界坐标（与缩放无关） */
  x: number
  y: number
}

export interface GraphEdge {
  from: string
  to: string
}

/** 连线画法：直线 / 曲线（默认直线，界面上可切换） */
export const EDGE_STYLES = ['straight', 'curved'] as const
export type EdgeStyle = (typeof EDGE_STYLES)[number]

export function isEdgeStyle(v: unknown): v is EdgeStyle {
  return v === 'straight' || v === 'curved'
}

/** 一个目标的结构图（落 `docs/{目标}/structure.json`） */
export interface StructureMap {
  version: 1
  nodes: StructureNode[]
  edges: GraphEdge[]
  /**
   * 连线画法。跟图一起存（每门课各记各的）而不是塞进 state.json：
   * 它是「这张图长什么样」的一部分，与节点坐标同一档。
   */
  edgeStyle?: EdgeStyle
  /**
   * 被用户**主动从画布上移除**的实体（存的是 ref，不是节点 id）。
   *
   * 图会跟着实体自动补齐（agent 新写了教学文档就该冒出文档节点），
   * 但「我就是要把它从画布上拿掉」这件事得记下来，否则下一次对账又把它加回来。
   * 撤回（Ctrl+Z）会连这一笔一起退回。
   */
  hidden?: string[]
}

export function emptyStructure(): StructureMap {
  return { version: 1, nodes: [], edges: [], edgeStyle: 'straight' }
}

/* ---------- 查表 ---------- */

export function kindOf(nodes: readonly StructureNode[], id: string): GraphKind | null {
  return nodes.find((n) => n.id === id)?.kind ?? null
}

export function nodeOf(nodes: readonly StructureNode[], id: string): StructureNode | null {
  return nodes.find((n) => n.id === id) ?? null
}

/** 按 ref 找节点（迁移与「实体已存在就复用」都要它） */
export function findByRef(nodes: readonly StructureNode[], kind: GraphKind, ref: string): StructureNode | null {
  return nodes.find((n) => n.kind === kind && n.ref === ref) ?? null
}

export function parentsOf(edges: readonly GraphEdge[], id: string): string[] {
  return edges.filter((e) => e.to === id).map((e) => e.from)
}

export function childrenOf(edges: readonly GraphEdge[], id: string): string[] {
  return edges.filter((e) => e.from === id).map((e) => e.to)
}

/* ---------- 卡片尺寸与包围盒 ---------- */

/**
 * 卡片尺寸（世界坐标）。布局、包围盒、拖拽落点都用这一份。
 *
 * 两处各写一个数，就会出现「算包围盒时按 200 宽、画的时候是 240」——
 * 缩放下限因此永远差一截，而且没人知道差在哪儿。
 */
export const CARD_W = 208
export const CARD_H = 76

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 一张卡有多高。默认全是 CARD_H，但大纲节点的卡片里要列出目标项，条目多了就更高。
 *
 * 为什么不在 StructureNode 上存 height：高度是**内容算出来的**（目标项几条），
 * 存进数据就多了一份会过期的副本——加一条目标项忘了改高度，卡片就会盖住别人。
 */
export type HeightOf = (node: StructureNode) => number

export const defaultHeight: HeightOf = () => CARD_H

export interface ViewSize {
  width: number
  height: number
}

/** 一张卡的矩形（世界坐标）。命中测试、连线端点、包围盒都从这里取 */
export function rectOf(node: StructureNode, heightOf: HeightOf = defaultHeight): Rect {
  return { x: node.x, y: node.y, width: CARD_W, height: heightOf(node) }
}

/** 全部节点的包围盒；一个节点都没有时返回 null（调用方据此不做「适应画布」） */
export function boundsOf(nodes: readonly StructureNode[], heightOf: HeightOf = defaultHeight): Rect | null {
  if (!nodes.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    const h = heightOf(n)
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
    if (n.x + CARD_W > maxX) maxX = n.x + CARD_W
    if (n.y + h > maxY) maxY = n.y + h
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/* ---------- 缩放 ---------- */

/**
 * 缩放下限不是写死的数字，而是**由内容包围盒算出来的**：
 * 小到「全部节点刚好装进视口」为止。内容多了，下限自己变小；内容少了，下限自己变大。
 *
 * 上限是固定的：再大也只是把一张卡片放大到糊，没有信息增量。
 */
export const STRUCT_MAX_ZOOM = 1.6

/** 绝对兜底：节点被拖得很散时包围盒会很大，算出来的下限可能趋近 0——那等于什么都看不见 */
export const STRUCT_MIN_ZOOM_FLOOR = 0.05

/** 适应画布时四周留白（屏幕像素，不参与缩放） */
export const STRUCT_FIT_PADDING = 96

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * 「刚好装下」的缩放倍数：宽高两个方向各算一次，取小的那个（等比缩放，不能拉伸）。
 *
 * 这就是需求里 `eastNode.x - westNode.x` 那套算法的落点——包围盒的宽高只用来**算系数**，
 * 不用来改当前缩放：当前缩放是用户自己的，跟着包围盒变会变成「拖一个节点，画面自己跳」。
 */
export function fitZoom(bounds: Rect, view: ViewSize, padding = STRUCT_FIT_PADDING): number {
  const usableW = Math.max(1, view.width - padding * 2)
  const usableH = Math.max(1, view.height - padding * 2)
  const zoom = Math.min(usableW / Math.max(1, bounds.width), usableH / Math.max(1, bounds.height))
  return clamp(zoom, STRUCT_MIN_ZOOM_FLOOR, STRUCT_MAX_ZOOM)
}

/** 当前内容的缩放下限（= 刚好装下的倍数） */
export function minZoomOf(bounds: Rect | null, view: ViewSize): number {
  if (!bounds) return STRUCT_MIN_ZOOM_FLOOR
  return fitZoom(bounds, view)
}

/** 把一次缩放收进 [动态下限, 固定上限]；滚轮与按钮都过它 */
export function clampZoom(zoom: number, bounds: Rect | null, view: ViewSize): number {
  return clamp(zoom, minZoomOf(bounds, view), STRUCT_MAX_ZOOM)
}

/**
 * 把包围盒摆到视口中央所需的平移量（世界坐标 → 屏幕坐标：先 scale 再 translate）。
 *
 * 与 mindmapNav 的 centerPanFor 是同一个式子，但那边带着「垂直 40%」的旧约定；
 * 结构图的「适应画布」要的是正中央，所以单独一个函数，别去改那边的默认值。
 */
export function centerPan(bounds: Rect, view: ViewSize, zoom: number): { x: number; y: number } {
  return {
    x: view.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: view.height / 2 - (bounds.y + bounds.height / 2) * zoom,
  }
}

/* ---------- 初始铺排（迁移与「新建目标」共用） ---------- */

/* ---------- 卡片高度（内容算出来的，不进数据） ---------- */

/** 大纲卡片的标题行高度（含上下 padding） */
export const OUTLINE_HEAD = 44
/** 每一行目标项的高度 */
export const SLOT_ROW = 22
/** 卡片底部那条注释标签的高度 */
export const NOTE_ROW = 20

/**
 * 一张卡有多高：大纲节点按目标项条数长高，有注释再加一行，其余一律 CARD_H。
 *
 * 大纲卡片必须能装下全部目标项——装不下的部分如果做成滚动或省略号，
 * 「点目标项生成子大纲」这个主要入口就有一半是点不到的。
 */
/** 有正文的文档卡：标题行 + 两行摘要 */
export const DOC_BODY_H = 104

export function cardHeight(store: LearnStore, node: { kind: GraphKind; ref?: string; note?: string }): number {
  if (node.kind === 'doc') {
    // 有正文的文档卡多两行摘要的高度；空文档还是标准高度（它要放「生成文档」按钮）
    const owner = node.ref ? nodeById(store, node.ref) : null
    return owner?.docs.teaching.trim() ? DOC_BODY_H : CARD_H
  }
  if (node.kind !== 'outline') return CARD_H
  const owner = node.ref ? nodeById(store, node.ref) : null
  const count = owner?.outline?.children.length ?? 0
  if (!count) return CARD_H
  return Math.max(CARD_H, OUTLINE_HEAD + count * SLOT_ROW + 8)
}

/** 把 store 包成一个高度访问器：布局与几何函数只认这个函数，不认 store */
export function heightOf(store: LearnStore): HeightOf {
  return (node) => cardHeight(store, node)
}

/**
 * 同列排序的「兄弟次序」：越小越靠上。
 *
 * 子大纲的上下顺序要跟**父大纲的目标项列表**一致——目标项第 1 条对应的子大纲在最上面。
 * 只按父节点的 y 排是排不出来的：兄弟们的父节点是同一个，y 全一样，最后就退化成比 uuid，
 * 那个顺序对人是随机的。所以次序由调用方算好传进来（它才知道大纲里有哪几条）。
 */
export type SiblingOrder = (node: { kind: GraphKind; ref?: string; slot?: string }) => number

const NO_ORDER: SiblingOrder = () => 0

/**
 * 从 store 造一个「兄弟次序」：目标项 key → 它在父大纲里的下标。
 *
 * 遍历整个目标的节点而不是只看出现在画布上的那几个：子大纲挂的是哪一条目标项，
 * 取决于**父节点的大纲**，父节点可能还没放到画布上。
 */
export function slotOrderOf(store: LearnStore, goalId: string): SiblingOrder {
  const rank = new Map<string, number>()
  for (const node of store.nodes) {
    if (node.goalId !== goalId) continue
    for (const [i, entry] of (node.outline?.children ?? []).entries()) rank.set(entry.key, i)
  }
  return (n) => {
    /*
     * 没记 slot 的节点（迁移铺出来的那批就是这样：只有 ref，没有 slot）
     * 退回用它自己的 key —— 旧模型里「子节点的 key」就是「父大纲里那一条目标项的 key」，
     * 两者本来就是同一套口径（见 types 的 OutlineEntry）。
     * 少了这条回退，所有迁移来的子大纲都会取到 0，排序退化成比 uuid。
     */
    const key = n.slot ?? (n.ref ? nodeById(store, n.ref)?.key : undefined)
    return key ? rank.get(key) ?? 0 : 0
  }
}

/** 同一列里类型的先后：大纲 → 文档 → 叶子（读图时从上往下就是这个顺序） */
const KIND_RANK: Record<GraphKind, number> = { outline: 0, doc: 1, note: 2, exam: 2, superdoc: 2 }

/** 列间距（世界坐标）：卡片宽 + 连线留白 */
export const COL_GAP = CARD_W + 112
/**
 * 同一列里两张卡之间的空（世界坐标）。
 *
 * **它是「空」不是「行距」**：卡片高度是内容算出来的（大纲卡片能长到两三百），
 * 按固定行距往下排，高的那张就会压住下一张——这正是「自动排列之后叠在一起」的成因。
 */
export const ROW_GAP = 36

export interface SeedGraph {
  nodes: Array<{ id: string; kind: GraphKind; ref?: string; slot?: string; note?: string }>
  edges: Array<{ from: string; to: string }>
}

/* ---------- 旧结构 → 图（迁移与「第一次打开结构页」共用一份装配） ---------- */

/**
 * 一个学习节点在旧模型里带着的东西。**这是唯一的装配输入**：
 * 数据迁移从磁盘文件拼它（见 lib/migration/outlineStructure），
 * 界面第一次打开结构页时从内存里的 store 拼它（见 structureFromStore）。
 *
 * 两处各自拼输入、共用下面的 seedFromSource——装配规则只有一份，
 * 不会出现「迁移铺出来的图」和「新目标铺出来的图」长得不一样。
 */
export interface SeedSourceNode {
  /** 学习节点的 id */
  id: string
  /** 归一化去重键（= 父大纲里那条目标项的 key），用来给子文档写上 slot */
  key?: string
  /**
   * 这个节点要不要一张大纲卡。
   *
   * 规矩：**只有总目标无条件有**，其余节点在它真的有目标项（outline.children 非空）时才有。
   * 空大纲卡片除了占地方没有意义——而且它是「先文档再大纲」里那一环，
   * 一旦凭空出现，整条链就会多出一截空壳。
   */
  hasOutline: boolean
  /** 旧树里「我 → 下游」的那些边（依赖边 from=我、to=下游） */
  downstream: string[]
  /** 笔记名 */
  notes: string[]
  /** 超级文档名 */
  superdocs: string[]
  /** 试卷 id */
  exams: string[]
}

/** 合成 id 的写法：确定性、可读、重跑得到同一张图（见文件头的说明） */
export const outlineGid = (id: string): string => `o:${id}`
export const docGid = (id: string): string => `d:${id}`
export const noteGid = (nodeId: string, name: string): string => `n:${nodeId}:${name}`
export const superdocGid = (nodeId: string, name: string): string => `s:${nodeId}:${name}`
export const examGid = (examId: string): string => `e:${examId}`

/**
 * 把一批学习节点铺成图：每个节点拆成大纲节点 + 文档节点，笔记/试卷/超级文档挂在文档下游。
 *
 * 为什么「空的文档不建节点」：旧模型每个节点都有一个空 `.md`，全建出来画布上一半是空盒子。
 * 想要就拖一个——这正是新架构的用法。
 */
export function seedFromSource(
  source: readonly SeedSourceNode[],
  heightOf: HeightOf = defaultHeight,
  siblingOrder: SiblingOrder = NO_ORDER,
): StructureMap {
  const seedNodes: SeedGraph['nodes'] = []
  const seedEdges: GraphEdge[] = []
  const known = new Set(source.map((n) => n.id))

  /*
   * 每个学习节点拆成**两张卡**：一张文档、一张大纲，边是 `文档 → 大纲`
   * （「先文档再大纲」：文档在前，大纲是它自己的展开）。
   *
   * 文档这次是**无条件建**的，哪怕还没有正文：它是把子树接上去的**连接件**——
   * 大纲的父子节点只能是文档，没有文档，子节点就挂不上来。
   */
  for (const item of source) {
    seedNodes.push({ id: docGid(item.id), kind: 'doc', ref: item.id })
    // 大纲卡：只有总目标、或者这个节点真的有目标项时才建（见 hasOutline）
    if (item.hasOutline) {
      seedNodes.push({ id: outlineGid(item.id), kind: 'outline', ref: item.id })
      seedEdges.push({ from: docGid(item.id), to: outlineGid(item.id) })
    }

    // ref 指回现有实体：内容永远只存一份，图里只存引用（见不变量 2）
    for (const name of item.notes) {
      seedNodes.push({ id: noteGid(item.id, name), kind: 'note', ref: `${item.id}:${name}` })
      seedEdges.push({ from: docGid(item.id), to: noteGid(item.id, name) })
    }
    for (const name of item.superdocs) {
      seedNodes.push({ id: superdocGid(item.id, name), kind: 'superdoc', ref: `${item.id}:${name}` })
      seedEdges.push({ from: docGid(item.id), to: superdocGid(item.id, name) })
    }
    for (const examId of item.exams) {
      seedNodes.push({ id: examGid(examId), kind: 'exam', ref: examId })
      seedEdges.push({ from: docGid(item.id), to: examGid(examId) })
    }
  }

  /*
   * 旧树的父子关系：父的**大纲** → 子的**文档**。
   * 大纲之间不再直接相连（大纲的父子节点只能是文档），中间必须隔一层文档。
   */
  for (const item of source) {
    // 父没有大纲卡就接不上子节点——但那种父本来也不会有子（没有目标项就没有接入点）
    if (!item.hasOutline) continue
    for (const dep of item.downstream) {
      if (!known.has(dep)) continue
      seedEdges.push({ from: outlineGid(item.id), to: docGid(dep) })
    }
  }

  /*
   * 接入点：子文档认领父大纲里 key 相同的那条目标项。
   *
   * 不写也能靠 `slotOrderOf` 按 key 回退对上号（老数据就是这么活的），但一旦节点改名、
   * key 变了，回退就断了；显式记下来之后，排顺序只认这一条，与标题怎么改无关。
   */
  const keyOf = new Map(source.filter((s) => s.key).map((s) => [s.id, s.key as string]))
  const byId = new Map(seedNodes.map((n) => [n.id, n]))
  for (const edge of seedEdges) {
    const parent = byId.get(edge.from)
    const child = byId.get(edge.to)
    if (parent?.kind !== 'outline' || child?.kind !== 'doc' || !child.ref) continue
    const key = keyOf.get(child.ref)
    if (key) child.slot = key
  }

  return seedLayout({ nodes: seedNodes, edges: seedEdges }, heightOf, siblingOrder)
}

/**
 * 给一张只有拓扑的图算一套初始坐标：**列 = 层级深度，行 = 同列内的顺序**。
 *
 * 用在哪：
 * - 数据迁移（旧的大纲树铺成图，见 lib/migration 的那个脚本）
 * - 新建目标时第一次打开结构页
 *
 * 它只负责「第一次摆得像话」，之后位置由用户拖、存进 structure.json，不再重算。
 * 根节点（没有入边）在第 0 列；同列内按「父节点的 y」再按 id 排序，尽量让兄弟挨着。
 */
export function seedLayout(
  seed: SeedGraph,
  heightOf: HeightOf = defaultHeight,
  siblingOrder: SiblingOrder = NO_ORDER,
): StructureMap {
  const nodes = seed.nodes
  const byId = new Map(nodes.map((n) => [n.id, n]))
  /** 有效边：两端都在表里才认（迁移时旧数据里可能有指向已删节点的依赖） */
  const edges = seed.edges.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to)

  const incoming = new Map<string, number>()
  for (const n of nodes) incoming.set(n.id, 0)
  for (const e of edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1)

  // 深度：从无入边的节点往下推；推不到的（理论上不该有，防御环）落在第 0 列
  const depth = new Map<string, number>()
  const queue: string[] = []
  for (const n of nodes) {
    if ((incoming.get(n.id) ?? 0) === 0) {
      depth.set(n.id, 0)
      queue.push(n.id)
    }
  }
  while (queue.length) {
    const id = queue.shift() as string
    const d = depth.get(id) ?? 0
    for (const e of edges) {
      if (e.from !== id) continue
      const next = d + 1
      if ((depth.get(e.to) ?? -1) < next) {
        depth.set(e.to, next)
        queue.push(e.to)
      }
    }
  }
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 0)

  // 同列内排序：先按父节点的 y（父已排好），再按 id，保证结果稳定
  const placed: StructureNode[] = []
  const maxDepth = Math.max(0, ...nodes.map((n) => depth.get(n.id) ?? 0))
  for (let d = 0; d <= maxDepth; d++) {
    const column = nodes.filter((n) => (depth.get(n.id) ?? 0) === d)
    const anchorY = (id: string): number => {
      const parent = edges.find((e) => e.to === id)?.from
      const p = parent ? placed.find((n) => n.id === parent) : undefined
      return p ? p.y : Number.MAX_SAFE_INTEGER
    }
    /*
     * 同一列里先按「父节点的 y」再按类型次序（大纲 → 文档 → 叶子）。
     *
     * 只按父节点的 y 排，兄弟之间谁上谁下就取决于 uuid 的大小——同一张图每次排出来
     * 顺序一样（id 是稳定的），但那个顺序对人是随机的：大纲可能被排到自己的文档下面。
     * 加上类型次序之后，同一列永远是「大纲在上、它的文档在下」，与读图的方向一致。
     */
    column.sort(
      (a, b) =>
        anchorY(a.id) - anchorY(b.id) ||
        KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
        siblingOrder(a) - siblingOrder(b) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    /*
     * 往下排的方式：**上一张的底 + 空隙**，而不是「第 i 行 × 固定行距」。
     * 卡片高度是内容算出来的（大纲卡片能长到两三百），按固定行距排，高的那张
     * 一定会压住下一张——这就是「自动排列之后节点叠在一起」的成因。
     */
    let cursorY = 0
    column.forEach((n) => {
      const node: StructureNode = {
        id: n.id,
        kind: n.kind,
        ...(n.ref ? { ref: n.ref } : {}),
        ...(n.slot ? { slot: n.slot } : {}),
        ...(n.note ? { note: n.note } : {}),
        x: d * COL_GAP,
        y: cursorY,
      }
      placed.push(node)
      cursorY += heightOf(node) + ROW_GAP
    })
  }

  return { version: 1, nodes: placed, edges }
}

/* ---------- 读盘校验 ---------- */

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isKind(v: unknown): v is GraphKind {
  return typeof v === 'string' && (GRAPH_KINDS as readonly string[]).includes(v)
}

/**
 * 读回来的结构图：逐字段重建，认不出来的一律丢掉。
 *
 * 与 store 的 normalize 同一条纪律——磁盘上的东西可能被人手改过、也可能是别的版本写的，
 * 直接信任它就会在界面上炸出一个坐标是 NaN 的卡片。**宁少一个节点，不留一个坏节点。**
 *
 * 边要过两道闸：两端节点都在 + 类型规则允许。类型规则变了之后，
 * 老数据里那条「文档 → 大纲」的边会在这里被安静地丢掉，而不是等 UI 连的时候才发现。
 */
export function normalizeStructure(raw: unknown): StructureMap {
  const out = emptyStructure()
  if (!raw || typeof raw !== 'object') return out
  const src = raw as { nodes?: unknown; edges?: unknown; edgeStyle?: unknown; hidden?: unknown }

  const seenIds = new Set<string>()
  for (const item of Array.isArray(src.nodes) ? src.nodes : []) {
    if (!item || typeof item !== 'object') continue
    const n = item as Record<string, unknown>
    if (typeof n.id !== 'string' || !n.id || seenIds.has(n.id)) continue
    if (!isKind(n.kind)) continue
    if (!isFiniteNumber(n.x) || !isFiniteNumber(n.y)) continue
    seenIds.add(n.id)
    out.nodes.push({
      id: n.id,
      kind: n.kind,
      ...(typeof n.ref === 'string' && n.ref ? { ref: n.ref } : {}),
      ...(typeof n.slot === 'string' && n.slot ? { slot: n.slot } : {}),
      ...(typeof n.note === 'string' && n.note.trim() ? { note: n.note } : {}),
      x: n.x,
      y: n.y,
    })
  }

  const seenEdges = new Set<string>()
  for (const item of Array.isArray(src.edges) ? src.edges : []) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    if (typeof e.from !== 'string' || typeof e.to !== 'string') continue
    if (!canAddEdge(out.nodes, out.edges, e.from, e.to)) continue
    const key = `${e.from}>${e.to}`
    if (seenEdges.has(key)) continue
    seenEdges.add(key)
    out.edges.push({ from: e.from, to: e.to })
  }

  if (isEdgeStyle(src.edgeStyle)) out.edgeStyle = src.edgeStyle
  const hidden = Array.isArray(src.hidden) ? src.hidden.filter((v): v is string => typeof v === 'string' && !!v) : []
  if (hidden.length) out.hidden = hidden
  return out
}

/**
 * 读回来的一整本结构图：目标 id → 那个目标的图。
 *
 * 目标已经不在的那些直接丢掉（与 reading.json / essay.json 同一条纪律：目标没了，
 * 它那本账跟着没）；归一之后一个节点都不剩的也不留——空图等于「还没铺过」，
 * 留个空对象只会让写盘时多出一个空文件。
 */
export function normalizeStructureBook(raw: unknown, goalIds: ReadonlySet<string>): Record<string, StructureMap> {
  const out: Record<string, StructureMap> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [goalId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!goalIds.has(goalId)) continue
    const map = normalizeStructure(value)
    if (map.nodes.length) out[goalId] = map
  }
  return out
}
