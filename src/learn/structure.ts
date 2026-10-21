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
 * 需求原话：「大纲连大纲，大纲连文档，但文档不能（下游）连大纲；笔记/试卷/超级文档
 * 只能作为文档的下游」。**空数组 = 它是叶子**，不允许再往下连。
 *
 * 层级严格递增有一个免费的好处：除了「大纲 → 大纲」这一条，其余边都不可能成环，
 * 所以环检测只需要在大纲之间做（见 wouldCycle）。
 */
export const GRAPH_EDGE_RULES: Record<GraphKind, readonly GraphKind[]> = {
  outline: ['outline', 'doc'],
  doc: ['note', 'exam', 'superdoc'],
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
   * 这个大纲节点占的是父大纲的**哪一个接入点**（= 目标项的 key，见 OutlineEntry）。
   *
   * 只有「子大纲」有这一项：父大纲提供的接入点数量是固定的（有几个目标项就有几个），
   * 每个接入点只能挂一个子大纲；文档那一侧不受这个限制。
   * 记 key 而不是序号：目标项重排、改名（key 跟着标题归一化）都不会把挂接关系弄丢。
   */
  slot?: string
  /** 画布坐标：节点卡片左上角，世界坐标（与缩放无关） */
  x: number
  y: number
}

export interface GraphEdge {
  from: string
  to: string
}

/** 一个目标的结构图（落 `docs/{目标}/structure.json`） */
export interface StructureMap {
  version: 1
  nodes: StructureNode[]
  edges: GraphEdge[]
}

export function emptyStructure(): StructureMap {
  return { version: 1, nodes: [], edges: [] }
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

/** 列间距 / 行间距（世界坐标）：卡片 + 连线留白 */
export const COL_GAP = CARD_W + 112
export const ROW_GAP = CARD_H + 36

export interface SeedGraph {
  nodes: Array<{ id: string; kind: GraphKind; ref?: string; slot?: string }>
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
  /** 教学文档有没有正文（没有正文、也没有下游时不建文档节点） */
  hasDoc: boolean
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
export function seedFromSource(source: readonly SeedSourceNode[]): StructureMap {
  const seedNodes: SeedGraph['nodes'] = []
  const seedEdges: GraphEdge[] = []
  const known = new Set(source.map((n) => n.id))

  for (const item of source) {
    seedNodes.push({ id: outlineGid(item.id), kind: 'outline', ref: item.id })

    const needDoc = item.hasDoc || item.notes.length > 0 || item.superdocs.length > 0 || item.exams.length > 0
    if (!needDoc) continue

    seedNodes.push({ id: docGid(item.id), kind: 'doc', ref: item.id })
    seedEdges.push({ from: outlineGid(item.id), to: docGid(item.id) })

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

  // 旧树的父子关系：依赖边 → 大纲 → 大纲（指向已删节点的边在 seedLayout 里会被丢掉）
  for (const item of source) {
    for (const dep of item.downstream) {
      if (!known.has(dep)) continue
      seedEdges.push({ from: outlineGid(item.id), to: outlineGid(dep) })
    }
  }

  return seedLayout({ nodes: seedNodes, edges: seedEdges })
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
export function seedLayout(seed: SeedGraph): StructureMap {
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
    column.sort((a, b) => anchorY(a.id) - anchorY(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    column.forEach((n, i) => {
      placed.push({
        id: n.id,
        kind: n.kind,
        ...(n.ref ? { ref: n.ref } : {}),
        ...(n.slot ? { slot: n.slot } : {}),
        x: d * COL_GAP,
        y: i * ROW_GAP,
      })
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
  const src = raw as { nodes?: unknown; edges?: unknown }

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
