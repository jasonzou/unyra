/**
 * 这个文件负责什么：**从内存里的 store 铺一张结构图**——第一次打开结构页（或新目标第一次进来）时用。
 *
 * 为什么不写在 learn/structure.ts 里：那个文件是纯几何与规则的领域层，不认识 LearnStore；
 * 这里只做「把 store 拼成装配输入」这一件事，装配规则本身仍然只有一份（structure 的 seedFromSource）。
 * 数据迁移走的是同一条装配，只是它的输入来自磁盘文件而不是内存（见 lib/migration/outlineStructure）。
 */

import type { LearnStore } from './types'
import {
  CARD_W,
  heightOf,
  seedFromSource,
  slotOrderOf,
  type GraphEdge,
  type SeedSourceNode,
  type StructureMap,
  type StructureNode,
} from './structure'

/**
 * 把一个目标的旧结构铺成图。
 *
 * 与迁移脚本的输入一一对应：
 * - 下游 = 依赖边里 from 是我、to 是别人（旧树就是这么表达的）
 * - 教学文档有没有正文 = `docs.teaching` 非空白
 * - 笔记 / 超级文档按名字，试卷按 nodeId 归属
 */
export function structureFromStore(store: LearnStore, goalId: string): StructureMap {
  const nodes = store.nodes.filter((n) => n.goalId === goalId)
  if (!nodes.length) return { version: 1, nodes: [], edges: [] }
  const alive = new Set(nodes.map((n) => n.id))

  const downstream = new Map<string, string[]>()
  for (const edge of store.edges) {
    if (!alive.has(edge.from) || !alive.has(edge.to)) continue
    const list = downstream.get(edge.from)
    if (list) list.push(edge.to)
    else downstream.set(edge.from, [edge.to])
  }

  const examsByNode = new Map<string, string[]>()
  for (const exam of store.exams) {
    if (!alive.has(exam.nodeId)) continue
    const list = examsByNode.get(exam.nodeId)
    if (list) list.push(exam.id)
    else examsByNode.set(exam.nodeId, [exam.id])
  }

  const rootNodeId = store.goals.find((g) => g.id === goalId)?.rootNodeId ?? null
  const source: SeedSourceNode[] = nodes.map((node) => ({
    id: node.id,
    key: node.key,
    // 只有总目标无条件有大纲卡；其余节点看它有没有目标项
    hasOutline: node.id === rootNodeId || (node.outline?.children.length ?? 0) > 0,
    downstream: downstream.get(node.id) ?? [],
    notes: node.notes.map((n) => n.name),
    superdocs: (node.superdocs ?? []).map((s) => s.name),
    exams: examsByNode.get(node.id) ?? [],
  }))

  return seedFromSource(source, heightOf(store), slotOrderOf(store, goalId))
}

/* ---------- 视图：把「实体 + 存过的那份图」算成一张能画的图 ---------- */

/**
 * 结构图的**唯一来源**：`(store, 存过的那份)` → 一张能画的图。
 *
 * ## 为什么改成纯函数
 *
 * 以前是「第一次进来铺一张」+「每次 store 变化对账补节点」两个 effect 叠加：
 * 图是一份独立快照，靠增量补偿跟实体对齐。副作用有三条路——首帧、store 变化、
 * 用户拖拽——谁先谁后都会影响结果，出了问题很难复现（"生成的文档不出现在画布上"
 * 就是这么来的）。
 *
 * 现在只有一个入口：**每次渲染从头算**。派生出来的卡片一定在，存过的坐标一定被尊重，
 * 用户删掉的卡片（`hidden`）一定不在。没有中间状态，也就没有对不齐的可能。
 *
 * ## 三条规矩
 *
 * 1. **卡片 = 派生出来的 + 存过但派生不出来的**。后者是用户从左侧拖出来的自由卡片
 *    （还没有 ref 的那种），派生不出来但必须留着，否则一刷新就没了。
 * 2. **坐标以存过的那份为准**；没存过的新卡片落在父卡片右边（与以前的落点一致）。
 * 3. **派生出来的边只给「这次才出现的卡片」补**。两张卡都在存过的图里时，那条线
 *    用户可能已经删了——再补回来就是以前那个"删不掉的线"的 bug。
 */
export function structureViewOf(
  store: LearnStore,
  goalId: string,
  saved: StructureMap | undefined,
): StructureMap {
  const seeded = structureFromStore(store, goalId)
  if (!saved) return seeded

  const hidden = new Set(saved.hidden ?? [])
  const savedNodes = new Map(saved.nodes.map((n) => [n.id, n]))
  const seededIds = new Set(seeded.nodes.map((n) => n.id))

  // 1. 卡片：派生的用存过的坐标，自由卡片原样留着
  const nodes: StructureNode[] = []
  for (const n of seeded.nodes) {
    if (hidden.has(n.id)) continue
    const prev = savedNodes.get(n.id)
    nodes.push(
      prev ? { ...n, x: prev.x, y: prev.y, ...(prev.note ? { note: prev.note } : {}) } : { ...n },
    )
  }
  for (const n of saved.nodes) {
    if (hidden.has(n.id) || seededIds.has(n.id)) continue
    nodes.push(n)
  }

  // 2. 边：先补「新卡片自己那条」，再原样接上存过的边
  const ids = new Set(nodes.map((n) => n.id))
  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  const push = (e: GraphEdge): void => {
    const key = `${e.from}>${e.to}`
    if (seen.has(key) || !ids.has(e.from) || !ids.has(e.to)) return
    seen.add(key)
    edges.push(e)
  }
  for (const e of seeded.edges) {
    if (savedNodes.has(e.from) && savedNodes.has(e.to)) continue
    push(e)
  }
  for (const e of saved.edges) push(e)

  /**
   * 3. 挂不上的新卡片不出现。
   *
   * 派生出来的卡片必须有一条来自**还在的**父卡片的入边——文档卡被用户删掉（hidden）时，
   * 它下面的笔记 / 大纲 / 试卷也就无处可挂，一起不出现（旧的对账就是这个口径）。
   * 循环到不再变化：删掉文档卡会让它的子卡片跟着失去入边。
   * **存过的自由卡片不受这条约束**（用户从左侧拖出来、还没有 ref 的那种，本来就没边）。
   */
  for (let changed = true; changed; ) {
    changed = false
    const alive = new Set(nodes.map((n) => n.id))
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      if (savedNodes.has(n.id)) continue
      // 文档卡是连接件：它是子树的挂点，本来就没有入边，不能按「挂不上」处理
      if (n.kind === 'doc') continue
      const attached = edges.some((e) => e.to === n.id && alive.has(e.from))
      if (attached) continue
      nodes.splice(i, 1)
      alive.delete(n.id)
      changed = true
    }
  }

  const kept = new Set(nodes.map((n) => n.id))
  const finalEdges = edges.filter((e) => kept.has(e.from) && kept.has(e.to))

  // 4. 新卡片落在父卡片右边（以前对账的落点），免得叠在别人身上
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const n of nodes) {
    if (savedNodes.has(n.id)) continue
    const parentEdge = finalEdges.find((e) => e.to === n.id)
    const parent = parentEdge ? byId.get(parentEdge.from) : undefined
    if (!parent) continue
    n.x = parent.x + CARD_W + 96
    n.y = parent.y
  }

  return {
    version: 1,
    nodes,
    edges: finalEdges,
    ...(saved.edgeStyle ? { edgeStyle: saved.edgeStyle } : {}),
  }
}

