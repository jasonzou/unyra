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
  splitLeafRef,
  type EdgeStyle,
  type GraphKind,
  type HeightOf,
  type StructureNode,
} from '../../../learn/structure'

/**
 * 卡片高度与那几个行高常量住在领域层（`learn/structure`）：布局也要用它们
 * （自动排列按实际高度往下排），放在组件层会让领域层反向依赖界面。
 * 这里 re-export 一份，调用方从 structureView 取的习惯不变。
 */
export {
  CARD_FRAME_H,
  CARD_PAD_B,
  DOC_BODY_H,
  DOC_LINE_H,
  DOC_LINES,
  NOTE_ROW,
  OUTLINE_HEAD,
  SLOT_ROW,
  cardHeight,
  heightOf,
  outlineCardHeight,
  splitLeafRef,
} from '../../../learn/structure'
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

/** 六种节点的色板：边框与徽标用同一套（色值走主题变量，见 mindmapTint 的同一条理由） */
export const KIND_TONE: Record<GraphKind, string> = {
  entry: 'border-rose-500/35 bg-rose-500/[0.06]',
  outline: 'border-seal/35 bg-seal/[0.06]',
  doc: 'border-sky-500/30 bg-sky-500/[0.06]',
  note: 'border-emerald-500/30 bg-emerald-500/[0.06]',
  exam: 'border-amber-500/30 bg-amber-500/[0.06]',
  superdoc: 'border-violet-500/30 bg-violet-500/[0.06]',
}

export const KIND_BADGE: Record<GraphKind, string> = {
  entry: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  outline: 'bg-seal/15 text-seal-deep',
  doc: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  note: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  exam: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  superdoc: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
}

/* ---------- 目标项的统一色 ---------- */

/**
 * 目标项（接入点）圆点与它派生的连线**只用这一个颜色**。
 *
 * 以前按目标项序号发彩虹色——后来发现颜色在图上只承载一个含义就够了：
 * 「这条连接来自某条目标项」。至于是第几条，行序与文字已经说明白了，
 * 颜色再抢这个活只会让图花。取主题印章色（CSS 变量）：明暗主题与配色方案自动跟随，
 * SVG 的 stroke/fill 也认它（降级值与 theme.css 的默认主题一致）。
 */
export const SLOT_ACCENT = 'var(--color-seal, #a8432f)'

/** 大纲卡片里的一行目标项 */
export interface OutlineSlot {
  /** 目标项的 key（= normalizeKey(标题)），也是接入点的身份 */
  key: string
  title: string
  index: number
  /** 已经挂上来的子大纲节点 id；null = 这个接入点还空着（灰的，点一下生成） */
  childId: string | null
}

/** 叶子的 ref 格式规则在领域层（learn/structure 的 splitLeafRef），上面已转出口。 */

/**
 * 事件目标是不是文本输入位（输入框 / 多行框 / 可编辑区）。
 *
 * 画布把 Delete、Ctrl+Z 这类键都接在容器上，事件会从里面的输入框一路冒上来——
 * 不先把「正在打字」认出来，注释里按个退格就会把选中的节点删掉。
 * 空格手势与键盘快捷键两处共用这一份判据。
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  // 显式收窄成 boolean：isContentEditable 在形状不完整的事件目标上是 undefined，
  // 直接 || 出去会让返回值变成 undefined（调用方拿它做 === false 的判据时会走错分支）
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true)
}

function clip(text: string, max = 46): string {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * 把 Markdown 正文压成**一段**能塞进卡片两行的纯文字。
 *
 * 摘要只有两行：标题井号、列表符号、表格竖线这些记号白占宽度，而正文里的换行会把话
 * 切成半句（第一行还没说完就断）。所以这里是「读起来像一句话」的清洗，不是「保留结构」
 * 的转换——完整正文在文档里，摘要只负责让人认出这是哪一篇。
 */
function plainText(md: string): string {
  return (
    md
      .replace(/```[\s\S]*?```/g, ' ') // 代码块整段不要
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片：卡片上显示不出来
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只留文字
      .replace(/^\s{0,3}#{1,6}\s*/gm, '') // 标题井号
      .replace(/^\s{0,3}>\s?/gm, '') // 引用符
      .replace(/^\s{0,3}[-*+]\s+/gm, '') // 无序列表符号
      .replace(/^\s{0,3}\d+[.)]\s+/gm, '') // 有序列表序号
      .replace(/^\s*\|?[\s:|-]{6,}\|?\s*$/gm, ' ') // 表格的分隔行
      .replace(/\|/g, ' ')
      .replace(/\*\*([^*]+)\*\*/g, '$1') // 粗体
      .replace(/__([^_]+)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1') // 行内代码
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/\s*\n\s*/g, ' ') // 软换行并成一段（否则第一行就是半句）
      .replace(/\s{2,}/g, ' ')
      .trim()
  )
}

/**
 * 这个节点占的是哪个接入点：只认显式记下来的 slot。
 *
 * （历史包袱说明：签名里曾有 store 参数做「按节点 key 回退」——回退会把还没确定
 * 做什么的空文档卡也点亮目标项，已经删掉；参数随之移除，别再加回来。）
 */
export function slotKeyOf(node: StructureNode): string | null {
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
 * 「亮起」的判据有两条，缺一不可：下游文档**占着这个接入点**（slot 对得上）
 * 且**真的连着这张大纲**（有出边）。只看 slot 的话，删掉连线之后双方在数据层面
 * 还互相指着——大纲的圆点还亮着、文档还占着接入点（2026-10-22 修的 bug）。
 */
export function outlineSlots(
  store: LearnStore,
  node: StructureNode,
  nodes: readonly StructureNode[],
  edges: readonly { from: string; to: string }[],
): OutlineSlot[] {
  const owner = node.ref ? nodeById(store, node.ref) : null
  const entries = owner?.outline?.children ?? []
  return entries.map((entry, index) => {
    const child = nodes.find(
      (n) =>
        n.id !== node.id &&
        n.kind === 'doc' &&
        // 排除这张大纲自己的那份文档（它的 ref 与大纲相同），只看下游文档
        n.ref !== node.ref &&
        slotKeyOf(n) === entry.key &&
        // 占用必须有一条真实的连线背书
        edges.some((e) => e.from === node.id && e.to === n.id),
    )
    return { key: entry.key, title: entry.title, index, childId: child?.id ?? null }
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

  // 入口：纯图件，不指回任何实体（见 nodeKinds/entry）
  if (node.kind === 'entry') {
    return { title: '入口', subtitle: '这门课从这里开始', missing: false }
  }

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
    /*
     * 摘要给两行：洗掉 Markdown 记号、并成一段（否则第一行永远是「# 标题」或半句话）。
     * 整篇只有代码块 / 图片时洗出来是空的——退回原文，别让有正文的卡片显示成「还没有正文」。
     */
    const excerpt = body ? plainText(body).slice(0, 120) || body.replace(/\s+/g, ' ').slice(0, 120) : ''
    return {
      title: owner.title,
      subtitle: body ? `${body.length} 字` : '还没有正文',
      excerpt: excerpt || undefined,
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
  // 0 题的壳（画布拖出、等出题）要说清「还没出」，别显示成「0 题」像一张空数据
  return { title: exam.title, subtitle: exam.questions.length ? `${exam.questions.length} 题` : '还没有题', missing: false }
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

/* ---------- 直角路由：绕开卡片 ---------- */

/**
 * 线离卡片边框至少留这么多（世界坐标）。
 *
 * 0 会让线贴着卡片边框走，看着像卡片自己的边框；太大又会把走廊挤没——
 * 自动排列的行距是 36（`ROW_GAP`），两边各留 16 之后还剩 4px 能让线穿过去。
 */
export const EDGE_CLEARANCE = 16
/**
 * 出线 / 进线先直着走这么远再拐弯。
 *
 * 起点在卡片右沿、终点在左沿，如果一上来就拐，线会在卡片角上拧一个贴着边框的 90°；
 * 先直走一小段（比分外扩的 `EDGE_CLEARANCE` 大一点，好让这一小段落在障碍之外）。
 */
export const EDGE_STUB = 20
/** 拐一次弯折合多长：宁可多绕两步，也别拐成楼梯 */
const TURN_COST = 48

interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

function inflate(r: RectLike, by: number): RectLike {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 }
}

/** 判定「穿过」时的容差：贴边不算穿过（线可以沿着卡片边上走） */
const EPS = 0.5

function insideRect(p: Point, r: RectLike): boolean {
  return p.x > r.x + EPS && p.x < r.x + r.width - EPS && p.y > r.y + EPS && p.y < r.y + r.height - EPS
}

/** 轴对齐线段是否穿过矩形内部（贴边不算） */
function crossesRect(a: Point, b: Point, r: RectLike): boolean {
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  return maxX > r.x + EPS && minX < r.x + r.width - EPS && maxY > r.y + EPS && minY < r.y + r.height - EPS
}

function intersectsRect(a: RectLike, b: RectLike): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * 老画法：右出 → 竖直 → 右进。没有卡片挡路时就用它——同一张图上不该有两种线型混着。
 *
 * 往回连（目标在左边）时先往右伸出去 40px 再绕回来，否则中间那条竖线会落在源卡片里面。
 */
export function edgeElbow(start: Point, end: Point): Point[] {
  if (Math.abs(start.y - end.y) < 0.5) return [start, end]
  const midX = end.x > start.x + 48 ? (start.x + end.x) / 2 : start.x + 40
  return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
}

/** 去掉重复点与「三点共线」的中间点：路径越短，后面按长度取点越准 */
function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue
    out.push({ x: p.x, y: p.y })
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1]
    const b = out[i]
    const c = out[i + 1]
    const sameX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS
    const sameY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS
    if (sameX || sameY) out.splice(i, 1)
  }
  return out
}

/**
 * 候选坐标线：起点、终点各一条，其余取障碍的四条边。
 *
 * 障碍已经按 `EDGE_CLEARANCE` 外扩过，所以「贴着障碍边」就等于「离卡片留够白」。
 * 端点坐标**原样保留**（不能被去重掉，否则找不到起终点）；与它们挨得太近的边线直接丢掉。
 */
function axisLines(keep: readonly number[], edges: readonly number[]): number[] {
  const out = [...keep]
  for (const v of edges) {
    if (out.some((k) => Math.abs(k - v) <= 1)) continue
    out.push(v)
  }
  return out.sort((a, b) => a - b)
}

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

/** A* 的开集：二叉堆。拖节点时每条边都要重算，别用「每次扫一遍找最小」 */
class OpenSet {
  private ids: number[] = []
  private keys: number[] = []

  get size(): number {
    return this.ids.length
  }

  push(id: number, key: number): void {
    this.ids.push(id)
    this.keys.push(key)
    let i = this.ids.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.keys[parent] <= this.keys[i]) break
      this.swap(parent, i)
      i = parent
    }
  }

  pop(): number {
    const top = this.ids[0]
    const lastId = this.ids.pop() as number
    const lastKey = this.keys.pop() as number
    if (this.ids.length) {
      this.ids[0] = lastId
      this.keys[0] = lastKey
      let i = 0
      for (;;) {
        const left = i * 2 + 1
        const right = left + 1
        let small = i
        if (left < this.ids.length && this.keys[left] < this.keys[small]) small = left
        if (right < this.ids.length && this.keys[right] < this.keys[small]) small = right
        if (small === i) break
        this.swap(i, small)
        i = small
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const id = this.ids[a]
    this.ids[a] = this.ids[b]
    this.ids[b] = id
    const key = this.keys[a]
    this.keys[a] = this.keys[b]
    this.keys[b] = key
  }
}

/** 走一步的四个方向，第三项是「这一步是横的还是竖的」（拐弯要加钱） */
const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 2],
  [0, -1, 2],
]

/**
 * 在障碍之间找一条横平竖直的路（A*，代价 = 长度 + 拐弯）。
 *
 * 网格取「端点 + 障碍边」这些线（Hanan grid）：直角路线的最优解一定落在这组线上，
 * 所以不用真的铺一张密网格。起点、终点即使落在障碍里也允许（它们本来就贴着卡片边）。
 */
function orthogonalRoute(start: Point, end: Point, solids: readonly RectLike[]): Point[] | null {
  const xs = axisLines(
    [start.x, end.x],
    solids.flatMap((r) => [r.x, r.x + r.width]),
  )
  const ys = axisLines(
    [start.y, end.y],
    solids.flatMap((r) => [r.y, r.y + r.height]),
  )
  const nx = xs.length
  const ny = ys.length
  const cells = nx * ny

  const blocked = new Uint8Array(cells)
  for (let xi = 0; xi < nx; xi++) {
    for (let yi = 0; yi < ny; yi++) {
      const p = { x: xs[xi], y: ys[yi] }
      if (solids.some((r) => insideRect(p, r))) blocked[xi * ny + yi] = 1
    }
  }

  const startXi = xs.indexOf(start.x)
  const startYi = ys.indexOf(start.y)
  const endXi = xs.indexOf(end.x)
  const endYi = ys.indexOf(end.y)
  if (startXi < 0 || startYi < 0 || endXi < 0 || endYi < 0) return null
  const startCell = startXi * ny + startYi
  const endCell = endXi * ny + endYi
  blocked[startCell] = 0
  blocked[endCell] = 0

  // 状态 = 格子 × 方向：同样一个格子，横着进来和竖着进来，后面拐弯的价钱不一样
  const g = new Float64Array(cells * 3).fill(Infinity)
  const prev = new Int32Array(cells * 3).fill(-1)
  const done = new Uint8Array(cells * 3)
  const open = new OpenSet()
  const first = startCell * 3
  g[first] = 0
  open.push(first, manhattan(start, end))

  while (open.size) {
    const cur = open.pop()
    if (done[cur]) continue
    done[cur] = 1
    const dir = cur % 3
    const cell = (cur - dir) / 3
    if (cell === endCell) {
      const path: Point[] = []
      for (let id = cur; id >= 0; id = prev[id]) {
        const d = id % 3
        const c = (id - d) / 3
        const xi = Math.floor(c / ny)
        path.push({ x: xs[xi], y: ys[c - xi * ny] })
      }
      return simplify(path.reverse())
    }
    const xi = Math.floor(cell / ny)
    const yi = cell - xi * ny
    const here = { x: xs[xi], y: ys[yi] }
    for (const [dx, dy, nextDir] of STEPS) {
      const tx = xi + dx
      const ty = yi + dy
      if (tx < 0 || tx >= nx || ty < 0 || ty >= ny) continue
      const target = tx * ny + ty
      if (blocked[target]) continue
      const there = { x: xs[tx], y: ys[ty] }
      if (solids.some((r) => crossesRect(here, there, r))) continue
      const next = target * 3 + nextDir
      if (done[next]) continue
      const cost = g[cur] + manhattan(here, there) + (dir && dir !== nextDir ? TURN_COST : 0)
      if (cost < g[next] - 1e-6) {
        g[next] = cost
        prev[next] = cur
        open.push(next, cost + manhattan(there, end))
      }
    }
  }
  return null
}

/**
 * 一条边画在哪：**直角折线**，遇到卡片绕着走。
 *
 * 顺序是「先试老画法，穿不过去才绕」：
 * 1. 老画法（右出 → 竖直 → 右进）只要不穿过任何卡片，就用它——大多数图都是这种，
 *    保持一条线一个样子，比「每条边都算一次最优路」更好读，也省掉每帧的寻路；
 * 2. 穿过去了才寻路：出线先直走 `EDGE_STUB`、进线同样，中间那段交给 A* 绕。
 *
 * 判「穿过」时**源卡片和目标卡片也参与**（不外扩）：目标是同一列的另一张卡时，
 * 老画法会从它身上穿进去，这一条也得绕。
 */
export function edgeRoute(
  from: StructureNode,
  to: StructureNode,
  nodes: readonly StructureNode[],
  height: HeightOf = defaultHeight,
  anchor?: { from?: number; to?: number },
): Point[] {
  const fromRect = rectOf(from, height)
  const toRect = rectOf(to, height)
  /*
   * 接入位置**固定**：从源的右沿出、从目标的左沿进。
   *
   * 绕行只改中间怎么走，不改「接在哪条边上」——否则同一张图上会出现
   * 「这条从左进、那条从右进」，读图时认不出方向，点目标项圆点拉出来的线也会对不上。
   * 目标在左边、或者跟源同一列时，宁可绕一大圈回到它的左边，也不换边进。
   */
  const start = { x: fromRect.x + fromRect.width, y: fromRect.y + (anchor?.from ?? EDGE_ANCHOR_Y) }
  const end = { x: toRect.x, y: toRect.y + (anchor?.to ?? EDGE_ANCHOR_Y) }

  const others = nodes
    .filter((n) => n.id !== from.id && n.id !== to.id)
    .map((n) => inflate(rectOf(n, height), EDGE_CLEARANCE))
  const solids = [...others, fromRect, toRect]

  const elbow = edgeElbow(start, end)
  const blocked = solids.some((r) => elbow.some((p, i) => i > 0 && crossesRect(elbow[i - 1], p, r)))
  if (!blocked) return elbow

  // 绕行：出/进那一小段贴着卡片，不算障碍（所以用外扩后的矩形当障碍，两端点在外扩之外）
  const stubStart = { x: start.x + EDGE_STUB, y: start.y }
  const stubEnd = { x: end.x - EDGE_STUB, y: end.y }
  const around = [...others, inflate(fromRect, EDGE_CLEARANCE), inflate(toRect, EDGE_CLEARANCE)]
  /*
   * 只把「这条线可能经过的区域」里的卡片丢给 A*：网格是按障碍条数平方长的，
   * 一张几十个节点的图全丢进去，拖节点时每条边都要重算，会卡。
   * 剪枝可能漏掉远处的卡片，所以算完再拿**全量**验一遍，穿过去了就退回老画法。
   */
  const area = {
    x: Math.min(start.x, end.x) - 240,
    y: Math.min(start.y, end.y) - 240,
    width: Math.abs(start.x - end.x) + 480,
    height: Math.abs(start.y - end.y) + 480,
  }
  const near = around.filter((r) => intersectsRect(area, r))
  const found = orthogonalRoute(stubStart, stubEnd, near) ?? orthogonalRoute(stubStart, stubEnd, around)
  if (!found) return elbow

  const points = simplify([start, ...found, end])
  const hits = points.some((p, i) => i > 0 && solids.some((r) => crossesRect(points[i - 1], p, r)))
  return hits ? elbow : points
}

/** 连线样式（straight / curved）定义在领域层 learn/structure——这里只认它的类型，
 *  不再复制一份常量：两份清单迟早漂移。 */

/** 点 (x,y) 到线段 ab 的距离 */
function distanceToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 0.0001) return Math.hypot(x - a.x, y - a.y)
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2))
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t))
}

/**
 * 路径的 d：折线（`edgeRoute` / `edgeElbow` 的点列）直接连，曲线要四个贝塞尔控制点。
 *
 * 入参统一叫「点列」：画线、点选、两颗小圆点都吃同一份，就不会出现「看得到、点不到」。
 */
export function edgePathD(points: readonly Point[], style: EdgeStyle = 'straight'): string {
  if (style === 'curved' && points.length === 4) {
    const [p0, p1, p2, p3] = points
    return `M${p0.x} ${p0.y} C${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`
  }
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
}

/**
 * 折线上参数 t 处的点：按**累计长度**取（不是按拐点序号）。
 *
 * 按长度取才和视觉一致：拐点两侧的线段长短不一，按序号取会让两颗小圆点一密一疏。
 */
function polylineAt(points: readonly Point[], t: number): Point {
  if (!points.length) return { x: 0, y: 0 }
  const segs = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  const total = segs.reduce((a, b) => a + b, 0)
  if (total < 0.5) return points[0]
  let left = t * total
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i] || i === segs.length - 1) {
      const k = segs[i] < 0.5 ? 0 : Math.min(1, left / segs[i])
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * k,
        y: points[i].y + (points[i + 1].y - points[i].y) * k,
      }
    }
    left -= segs[i]
  }
  return points[points.length - 1]
}

/** 线上参数 t 处的点：折线按累计长度取，曲线是三次贝塞尔 */
export function edgePointAt(points: readonly Point[], t: number, style: EdgeStyle = 'straight'): Point {
  if (style === 'curved' && points.length === 4) {
    const [p0, p1, p2, p3] = points
    const u = 1 - t
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    }
  }
  return polylineAt(points, t)
}

/**
 * 点在哪条连线上（阈值内才算命中，取最近的一条）。
 *
 * 折线按「点到线段」算，比采样准；曲线只能采样 24 段——贝塞尔的「点到曲线距离」没有解析解。
 * `routeOf` 是画布算好的点列（和画出来的是同一份），不传就现算。
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
  routeOf?: (edge: { from: string; to: string }) => readonly Point[] | undefined,
): { from: string; to: string } | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let best: { from: string; to: string } | null = null
  let bestDist = threshold
  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    const points = edgePointsOf(nodes, edge, from, to, height, style, anchorOf, routeOf)
    let dist = Infinity
    if (style === 'curved' && points.length === 4) {
      for (let i = 0; i <= 24; i++) {
        const p = edgePointAt(points, i / 24, 'curved')
        dist = Math.min(dist, Math.hypot(p.x - x, p.y - y))
      }
    } else {
      for (let i = 1; i < points.length; i++) {
        dist = Math.min(dist, distanceToSegment(x, y, points[i - 1], points[i]))
      }
    }
    if (dist <= bestDist) {
      bestDist = dist
      best = edge
    }
  }
  return best
}

/**
 * 一条边的那份点列：优先用调用方算好的（画布上已经算过一遍），否则现算。
 *
 * 「现算」也要走同一套规则：折线 = `edgeRoute`（会绕卡片），曲线 = 贝塞尔控制点。
 * 两处各写一套，就会出现「画的是绕行的线、点的是老位置」。
 */
function edgePointsOf(
  nodes: readonly StructureNode[],
  edge: { from: string; to: string },
  from: StructureNode,
  to: StructureNode,
  height: HeightOf,
  style: EdgeStyle,
  anchorOf?: (edge: { from: string; to: string }) => { from?: number; to?: number } | undefined,
  routeOf?: (edge: { from: string; to: string }) => readonly Point[] | undefined,
): readonly Point[] {
  const cached = routeOf?.(edge)
  if (cached) return cached
  const anchor = anchorOf?.(edge)
  return style === 'curved' ? edgeCurve(from, to, height, anchor) : edgeRoute(from, to, nodes, height, anchor)
}

/**
 * 一条连线两端那两颗小圆点的位置：各距端点一段（按参数取，不用像素距离）。
 *
 * 用 t=0.22 / 0.78 而不是「离端点 40px」：路径会绕行、拐点位置不固定，
 * 按参数取点永远落在线上，按像素算就会偏出去。
 */
export function edgeDots(points: readonly Point[], style: EdgeStyle = 'straight'): { from: Point; to: Point } {
  return { from: edgePointAt(points, 0.22, style), to: edgePointAt(points, 0.78, style) }
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
  routeOf?: (edge: { from: string; to: string }) => readonly Point[] | undefined,
): { edge: { from: string; to: string }; side: 'from' | 'to' } | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    const dots = edgeDots(edgePointsOf(nodes, edge, from, to, height, style, anchorOf, routeOf), style)
    if (Math.hypot(dots.from.x - x, dots.from.y - y) <= threshold) return { edge, side: 'from' }
    if (Math.hypot(dots.to.x - x, dots.to.y - y) <= threshold) return { edge, side: 'to' }
  }
  return null
}

/**
 * 一条连线该是什么颜色：只有「大纲 → 子文档」这条（目标项派生的连线）上统一色，
 * 其余连线一律中性灰——颜色在图上只有一个含义「这是目标项的连接」。
 *
 * 这条边本身就是占用凭证（在画它 = 连线存在），所以只查 slot 是否真属于这张大纲。
 */
export function edgeColorOf(
  store: LearnStore,
  nodes: readonly StructureNode[],
  edge: { from: string; to: string },
): string | null {
  const from = nodes.find((n) => n.id === edge.from)
  const to = nodes.find((n) => n.id === edge.to)
  if (!from || !to || from.kind !== 'outline' || to.kind !== 'doc') return null
  const key = slotKeyOf(to)
  if (!key) return null
  const owner = from.ref ? nodeById(store, from.ref) : null
  return owner?.outline?.children.some((e) => e.key === key) ? SLOT_ACCENT : null
}
