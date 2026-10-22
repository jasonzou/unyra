/**
 * 这个文件负责什么：结构画布的**纯逻辑**——一个图节点该显示成什么样、点在哪张卡上、
 * 连线怎么弯、大纲节点里那几行目标项怎么算。
 *
 * 为什么从组件里拆出来：
 * 1. 仓库的 oxlint 规矩是「组件文件只导出组件」（见 outline/mindmapNav 的说明）；
 * 2. 这些事都能单测，而且都容易在「顺手优化一下」时改错——
 *    比如把笔记的 ref 按最后一个冒号切，笔记名叫「a:b」时就认错了归属。
 */

import type { LearnStore } from '../../../learn/types'
import {
  OUTLINE_HEAD,
  SLOT_ROW,
  defaultHeight,
  rectOf,
  type GraphKind,
  type HeightOf,
  type StructureNode,
} from '../../../learn/structure'

/**
 * 卡片高度与那几个行高常量住在领域层（`learn/structure`）：布局也要用它们
 * （自动排列按实际高度往下排），放在组件层会让领域层反向依赖界面。
 * 这里 re-export 一份，调用方从 structureView 取的习惯不变。
 */
export { DOC_BODY_H, NOTE_ROW, OUTLINE_HEAD, SLOT_ROW, cardHeight, heightOf } from '../../../learn/structure'
import { nodeById } from '../../../learn/graph'

/**
 * 连线从卡片**顶部往下多少**出线（固定值，不随卡片高度变）。
 *
 * 取标题行下沿附近：线从标题旁边出去，视觉上落在一条齐平的横带上。
 */
export const EDGE_ANCHOR_Y = 34

/** 卡片上要显示的两行字 */
export interface NodeView {
  title: string
  subtitle: string
  /** 文档卡上的两行正文摘要（只给有正文的文档节点） */
  excerpt?: string
  /** 有 ref、但正文还是空的：卡片上给一颗「生成文档」 */
  blank?: boolean
  /** ref 指向的实体已经不在了（节点删了、笔记改名了） */
  missing: boolean
}

/** 五种节点的色板：边框与徽标用同一套（色值走主题变量，见 mindmapTint 的同一条理由） */
export const KIND_TONE: Record<GraphKind, string> = {
  outline: 'border-seal/35 bg-seal/[0.06]',
  doc: 'border-sky-500/30 bg-sky-500/[0.06]',
  note: 'border-emerald-500/30 bg-emerald-500/[0.06]',
  exam: 'border-amber-500/30 bg-amber-500/[0.06]',
  superdoc: 'border-violet-500/30 bg-violet-500/[0.06]',
}

export const KIND_BADGE: Record<GraphKind, string> = {
  outline: 'bg-seal/15 text-seal-deep',
  doc: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  note: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  exam: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  superdoc: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
}

/* ---------- 目标项的颜色 ---------- */

/**
 * 目标项的配色。**按目标项的序号取**，同一个目标项在「卡片上的小圆点」与
 * 「它到子大纲的那条连线」上必须是同一个颜色——两处各取一次色，就会对不上。
 *
 * 用色值而不是 Tailwind 类：连线是 SVG 的 stroke，`className` 上的色板类管不到它；
 * 而颜色要跟着数据走（第 3 个目标项恒为第 3 个颜色），不适合用语义 token。
 */
export const SLOT_COLORS = [
  '#2e8b6e',
  '#c2410c',
  '#7c3aed',
  '#0891b2',
  '#be123c',
  '#4d7c0f',
  '#a16207',
  '#475569',
] as const

export function slotColor(index: number): string {
  return SLOT_COLORS[((index % SLOT_COLORS.length) + SLOT_COLORS.length) % SLOT_COLORS.length]
}

/** 大纲卡片里的一行目标项 */
export interface OutlineSlot {
  /** 目标项的 key（= normalizeKey(标题)），也是接入点的身份 */
  key: string
  title: string
  index: number
  color: string
  /** 已经挂上来的子大纲节点 id；null = 这个接入点还空着（灰的，点一下生成） */
  childId: string | null
}

/** 叶子的 ref 是 `{节点 id}:{名字}`：按**第一个**冒号切，名字里再冒号也不影响归属 */
export function splitLeafRef(ref: string): { owner: string; name: string } | null {
  const at = ref.indexOf(':')
  if (at <= 0 || at === ref.length - 1) return null
  return { owner: ref.slice(0, at), name: ref.slice(at + 1) }
}

function clip(text: string, max = 46): string {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * 这个节点占的是哪个接入点：先看显式 slot，老数据退回去用节点的 key。
 *
 * 接入点现在挂在**文档**上（大纲的父子节点只能是文档）；`outline` 也认，是为了
 * 让上一次重构留下的老数据（slot 记在大纲节点上）不至于当场失效。
 */
export function slotKeyOf(_store: LearnStore, node: StructureNode): string | null {
  /*
   * **只认显式记下来的 slot**，不再按节点 key 回退。
   *
   * 回退会把「空节点」也算成占了某条目标项：拖出来一张还没写内容的文档卡，
   * 它恰好叫「导数」，就把「导数」那条目标项点亮了——可它其实还没确定要做什么。
   * 空节点就是「还没确定」，在图上保持灰色。
   */
  return node.slot ?? null
}

/**
 * 某条目标项在卡片里的中心 y（离卡片顶部）。
 *
 * 连线的「大纲那一端」要对准这条目标项，而不是卡片顶部那个固定锚点——
 * 一眼就能看出这根线是从哪一条目标项长出来的。
 */
export function slotAnchorY(index: number): number {
  return OUTLINE_HEAD + index * SLOT_ROW + SLOT_ROW / 2
}

/**
 * 一个大纲节点卡片里要列出的目标项，以及每个接入点有没有挂上子文档。
 *
 * 「亮起」的判据是**下游有没有一个子大纲节点占了这个接入点**，不是「这个目标项有没有被学过」——
 * 图上看得见的东西就应该是图上真实存在的连接；拿学习状态来染色，会让人以为连线也在那儿。
 */
export function outlineSlots(store: LearnStore, node: StructureNode, nodes: readonly StructureNode[]): OutlineSlot[] {
  const owner = node.ref ? nodeById(store, node.ref) : null
  const entries = owner?.outline?.children ?? []
  return entries.map((entry, index) => {
    const child = nodes.find(
      (n) =>
        n.id !== node.id &&
        n.kind === 'doc' &&
        // 排除这张大纲自己的那份文档（它的 ref 与大纲相同），只看下游文档
        n.ref !== node.ref &&
        slotKeyOf(store, n) === entry.key,
    )
    return { key: entry.key, title: entry.title, index, color: slotColor(index), childId: child?.id ?? null }
  })
}

/* ---------- 节点显示什么 ---------- */

/**
 * 一个节点该显示什么。
 *
 * 大纲节点与文档节点共用同一个 ref（都是那个学习节点），差别只在副标题：
 * 大纲报「几个目标项」，文档报「正文多长」——一眼能看出这个盒子里装的是什么。
 */
export function resolveNodeView(store: LearnStore, node: StructureNode): NodeView {
  const ref = node.ref ?? ''

  if (node.kind === 'outline' || node.kind === 'doc') {
    const owner = ref ? nodeById(store, ref) : null
    if (!owner) return { title: '空节点', subtitle: '还没有挂到任何内容上', missing: !ref ? false : true }
    if (node.kind === 'outline') {
      const count = owner.outline?.children.length ?? 0
      const intro = owner.outline?.intro?.trim() ?? ''
      return {
        title: owner.title,
        subtitle: count ? `${count} 个目标项` : intro ? clip(intro) : '还没有大纲',
        missing: false,
      }
    }
    const body = owner.docs.teaching.trim()
    return {
      title: owner.title,
      subtitle: body ? `${body.length} 字` : '还没有正文',
      // 摘要给两行：去掉标题井号与多余空行，不然第一行永远是「# 标题」
      excerpt: body ? body.replace(/^#{1,6}\s*/gm, '').replace(/\n{2,}/g, '\n').trim().slice(0, 220) : undefined,
      blank: !body,
      missing: false,
    }
  }

  if (node.kind === 'note' || node.kind === 'superdoc') {
    const leaf = ref ? splitLeafRef(ref) : null
    if (!leaf) return { title: '空节点', subtitle: '还没有内容', missing: false }
    const owner = nodeById(store, leaf.owner)
    const exists =
      node.kind === 'note'
        ? !!owner?.notes.some((n) => n.name === leaf.name)
        : !!(owner?.superdocs ?? []).some((s) => s.name === leaf.name)
    return {
      title: leaf.name,
      subtitle: owner ? `属于「${owner.title}」` : '所属节点已删除',
      missing: !exists,
    }
  }

  const exam = store.exams.find((e) => e.id === ref)
  if (!exam) return { title: '空节点', subtitle: '还没有试卷', missing: !!ref }
  return { title: exam.title, subtitle: `${exam.questions.length} 题`, missing: false }
}

/**
 * 世界坐标落在哪张卡上（卡片的命中测试）。
 *
 * 用它而不是 `elementFromPoint`：拖动连线时指针已经被容器捕获，子元素收不到 enter/leave，
 * 只有几何判断是可靠的。矩形与画卡片用的是同一份尺寸（含大纲卡片的长高）。
 */
export function hitTest(
  nodes: readonly StructureNode[],
  x: number,
  y: number,
  height: HeightOf = defaultHeight,
): StructureNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const rect = rectOf(nodes[i], height)
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) return nodes[i]
  }
  return null
}

/* ---------- 连线的几何（画线与「点到线上」共用一份） ---------- */

export interface Point {
  x: number
  y: number
}

/**
 * 一条连线的三次贝塞尔控制点：从左卡右沿中点出发，进右卡左沿中点。
 *
 * 画线（StructureCanvas 的 path）、点选（edgeAt）与那两颗小圆点（edgeDots）都从这里取，
 * 不各算一遍——两处各写一个 bend 系数，就会出现「看着连上了，点它却没反应」。
 */
export function edgeCurve(
  from: StructureNode,
  to: StructureNode,
  height: HeightOf = defaultHeight,
  /** 两端的锚点离各自卡片顶部多远；省略就用 EDGE_ANCHOR_Y */
  anchor?: { from?: number; to?: number },
): [Point, Point, Point, Point] {
  const fromRect = rectOf(from, height)
  const toRect = rectOf(to, height)
  /*
   * 锚点离卡片**顶部**一个固定距离，而不是垂直居中。
   *
   * 大纲卡片的高度是内容算出来的（可能 76，也可能 228），按中心连的话，
   * 同一列里两张卡片的线会一高一低地错开；固定从标题行下方出线，
   * 线在视觉上就落成一条齐平的横带，跟读图的方向一致。
   */
  const p0 = { x: fromRect.x + fromRect.width, y: fromRect.y + (anchor?.from ?? EDGE_ANCHOR_Y) }
  const p3 = { x: toRect.x, y: toRect.y + (anchor?.to ?? EDGE_ANCHOR_Y) }
  const bend = Math.max(48, Math.abs(p3.x - p0.x) * 0.45)
  return [p0, { x: p0.x + bend, y: p0.y }, { x: p3.x - bend, y: p3.y }, p3]
}

/** 连线样式：默认折线（横平竖直，读起来干净），可以切成曲线 */
export const EDGE_STYLES = ['straight', 'curved'] as const
export type EdgeStyle = (typeof EDGE_STYLES)[number]

/** 折线的拐点：右出 → 竖直 → 右进。两卡上下错开时，线走成一个「Z」 */
function edgePolyline(curve: readonly Point[]): Point[] {
  const [p0, , , p3] = curve
  /*
   * 拐点取两卡中间。往回连（目标在左边）时中间点会落到源卡里面，
   * 于是改成「先往右伸出去 40px 再绕回来」，避免线从卡片身上穿过去。
   */
  // 同一行：折线退化成一条横线，不必留拐点（留了也是三点共线）
  if (Math.abs(p0.y - p3.y) < 0.5) return [p0, p3]
  const midX = p3.x > p0.x + 48 ? (p0.x + p3.x) / 2 : p0.x + 40
  const raw = [p0, { x: midX, y: p0.y }, { x: midX, y: p3.y }, p3]
  // 同一行时竖直段长度为 0，去掉重合点，路径与「按长度取点」都干净
  return raw.filter(
    (p, i) => i === 0 || Math.abs(p.x - raw[i - 1].x) > 0.5 || Math.abs(p.y - raw[i - 1].y) > 0.5,
  )
}

/** 点 (x,y) 到线段 ab 的距离 */
function distanceToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 0.0001) return Math.hypot(x - a.x, y - a.y)
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2))
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t))
}

export function edgePathD(curve: readonly Point[], style: EdgeStyle = 'straight'): string {
  const [p0, p1, p2, p3] = curve
  if (style === 'straight') {
    return edgePolyline(curve)
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`)
      .join(' ')
  }
  return `M${p0.x} ${p0.y} C${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`
}

/**
 * 线上参数 t 处的点：折线按**累计长度**取（不是按拐点序号），曲线是三次贝塞尔。
 *
 * 按长度取才和视觉一致：拐点两侧的线段长短不一，按序号取会让两颗小圆点一密一疏。
 */
export function edgePointAt(curve: readonly Point[], t: number, style: EdgeStyle = 'straight'): Point {
  const [p0, p1, p2, p3] = curve
  if (style === 'straight') {
    const pts = edgePolyline(curve)
    const segs = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y))
    const total = segs.reduce((a, b) => a + b, 0)
    if (total < 0.5) return pts[0]
    let left = t * total
    for (let i = 0; i < segs.length; i++) {
      if (left <= segs[i] || i === segs.length - 1) {
        const k = segs[i] < 0.5 ? 0 : Math.min(1, left / segs[i])
        return {
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * k,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * k,
        }
      }
      left -= segs[i]
    }
    return pts[pts.length - 1]
  }
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

/**
 * 点在哪条连线上（阈值内才算命中，取最近的一条）。
 *
 * 采样 24 段而不是解方程：贝塞尔的「点到曲线距离」没有解析解，采样够密就够用，
 * 而且与画出来的那条线用的是同一组控制点，不会出现「看得到、点不到」。
 */
export function edgeAt(
  nodes: readonly StructureNode[],
  edges: readonly { from: string; to: string }[],
  x: number,
  y: number,
  threshold = 8,
  height: HeightOf = defaultHeight,
  style: EdgeStyle = 'straight',
  anchorOf?: (edge: { from: string; to: string }) => { from?: number; to?: number } | undefined,
): { from: string; to: string } | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let best: { from: string; to: string } | null = null
  let bestDist = threshold
  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    const curve = edgeCurve(from, to, height, anchorOf?.(edge))
    if (style === 'straight') {
      // 折线是线段拼的：直接算「点到线段」的距离，比按 24 等分采样准得多
      const pts = edgePolyline(curve)
      let dist = Infinity
      for (let i = 1; i < pts.length; i++) {
        dist = Math.min(dist, distanceToSegment(x, y, pts[i - 1], pts[i]))
      }
      if (dist <= bestDist) {
        bestDist = dist
        best = edge
      }
      continue
    }
    for (let i = 0; i <= 24; i++) {
      const p = edgePointAt(curve, i / 24, style)
      const dist = Math.hypot(p.x - x, p.y - y)
      if (dist <= bestDist) {
        bestDist = dist
        best = edge
      }
    }
  }
  return best
}

/**
 * 一条连线两端那两颗小圆点的位置：各距端点一段（按参数取，不用像素距离）。
 *
 * 用 t=0.22 / 0.78 而不是「离端点 40px」：卡片长高（大纲节点）时曲线的弯法会变，
 * 按参数取点永远落在线上，按像素算就会偏出去。
 */
export function edgeDots(
  from: StructureNode,
  to: StructureNode,
  height: HeightOf = defaultHeight,
  style: EdgeStyle = 'straight',
  anchor?: { from?: number; to?: number },
): { from: Point; to: Point } {
  const curve = edgeCurve(from, to, height, anchor)
  return { from: edgePointAt(curve, 0.22, style), to: edgePointAt(curve, 0.78, style) }
}

/** 点在哪颗小圆点上（点它 = 跳到线的另一端） */
export function edgeDotAt(
  nodes: readonly StructureNode[],
  edges: readonly { from: string; to: string }[],
  x: number,
  y: number,
  threshold = 11,
  height: HeightOf = defaultHeight,
  style: EdgeStyle = 'straight',
  anchorOf?: (edge: { from: string; to: string }) => { from?: number; to?: number } | undefined,
): { edge: { from: string; to: string }; side: 'from' | 'to' } | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    const dots = edgeDots(from, to, height, style, anchorOf?.(edge))
    if (Math.hypot(dots.from.x - x, dots.from.y - y) <= threshold) return { edge, side: 'from' }
    if (Math.hypot(dots.to.x - x, dots.to.y - y) <= threshold) return { edge, side: 'to' }
  }
  return null
}

/**
 * 一条连线该是什么颜色：只有「大纲 → 子大纲」这条有颜色，取的是那个接入点的颜色。
 *
 * 其余连线一律中性灰——颜色在图上只有一个含义「这是第几个目标项」，
 * 给别的线也上色，这个含义就废了。
 */
export function edgeColorOf(
  store: LearnStore,
  nodes: readonly StructureNode[],
  edge: { from: string; to: string },
): string | null {
  const from = nodes.find((n) => n.id === edge.from)
  const to = nodes.find((n) => n.id === edge.to)
  // 只有「大纲 → 子文档」这条有颜色（子文档占了一条目标项）
  if (!from || !to || from.kind !== 'outline' || to.kind !== 'doc') return null
  const key = slotKeyOf(store, to)
  if (!key) return null
  return outlineSlots(store, from, nodes).find((s) => s.key === key)?.color ?? null
}
