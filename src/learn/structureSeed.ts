/**
 * 这个文件负责什么：**从内存里的 store 铺一张结构图**——第一次打开结构页（或新目标第一次进来）时用。
 *
 * 为什么不写在 learn/structure.ts 里：那个文件是纯几何与规则的领域层，不认识 LearnStore；
 * 这里只做「把 store 拼成装配输入」这一件事，装配规则本身仍然只有一份（structure 的 seedFromSource）。
 * 数据迁移走的是同一条装配，只是它的输入来自磁盘文件而不是内存（见 lib/migration/outlineStructure）。
 */

import type { LearnStore } from './types'
import { kindSpec } from './nodeKinds'
import {
  CARD_H,
  CARD_W,
  freeSpotNear,
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
    // 根节点派生入口卡，根文档自动挂到入口下面（权威根）
    isRoot: node.id === rootNodeId,
    downstream: downstream.get(node.id) ?? [],
    notes: node.notes.map((n) => n.name),
    superdocs: (node.superdocs ?? []).map((s) => s.name),
    exams: examsByNode.get(node.id) ?? [],
  }))

  return seedFromSource(source, heightOf(store), slotOrderOf(store, goalId))
}

/* ---------- 视图：把「实体 + 存过的那份图」算成一张能画的图 ---------- */

/**
 * 结构图派的**唯一来源**：`(store, 存过的那份)` → 一张能画的图。
 *
 * ## 架构（2026-10-24 实体先行定稿）
 *
 * **卡片的存在性一律由 store 派生，画布自有状态只有坐标与墓碑。** 实体长出来卡就在
 * （拖到画布上的挂件从落地那一刻起就是真实空实体——空试卷出题时被同 id 吸收、空超级文档
 * 按名字覆写）；实体没了卡就不在（hidden 记着用户删过哪些）。唯一的意图卡是**占着大纲
 * 目标项的空文档卡**（它的依托是 store 里的那条目标项，点「生成」时由宿主同步建实体并
 * 就地换血）。没有第三种来源，也就没有任何「意图 ↔ 实体」的对账规则——历史上那类
 * 「生成一个、多出一个空节点」「连线即消失」的 bug 全部由此而来，现已从根上消除
 * （无依托的旧幽灵卡在读盘归一时清理，见 learn/structure 的 normalizeStructure）。
 *
 * ## 三条规矩
 *
 * 1. **卡片 = 派生出来的 + 存过但派生不出来的**。后者只剩占目标项的空文档卡
 *    （store 派生不出「还没建的实体」，但目标项在，卡就得在）。
 * 2. **坐标以存过的那份为准**；没存过的新卡片落在父卡片右边。
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

  // 1. 卡片：派生的用存过的坐标，存过的意图卡（占目标项的空文档）原样留着
  const nodes: StructureNode[] = []
  for (const n of seeded.nodes) {
    /*
     * 入口的墓碑一律无视：它是每张图**默认存在**的起点，不是用户放上去的卡——
     * 旧数据里就算记着它的 hidden（比如老版本删过），这里也要把它长回来。
     */
    if (hidden.has(n.id) && n.kind !== 'entry') continue
    const prev = savedNodes.get(n.id)
    nodes.push(
      prev ? { ...n, x: prev.x, y: prev.y, ...(prev.note ? { note: prev.note } : {}) } : { ...n },
    )
  }
  for (const n of saved.nodes) {
    if (hidden.has(n.id) || seededIds.has(n.id)) continue
    // 入口现在只由派生长出来（见 seedFromSource 的 isRoot）：老版本拖出来的自由入口卡就此退场
    if (n.kind === 'entry') continue
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
   * 它下面的笔记 / 大纲 / 试卷也就无处可挂，一起不出现。循环到不再变化：删掉文档卡会让
   * 它的子卡片跟着失去入边。**锚点卡不受这条约束**（登记表里 anchor 的类型：文档是子树的
   * 挂点、入口是整张图的起点，本来就没有入边）；**存过的意图卡也不受**（占目标项的空文档卡
   * 还没有实体，本来就没有派生边）。
   */
  for (let changed = true; changed; ) {
    changed = false
    const alive = new Set(nodes.map((n) => n.id))
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      if (savedNodes.has(n.id) || kindSpec(n.kind).anchor) continue
      const attached = edges.some((e) => e.to === n.id && alive.has(e.from))
      if (attached) continue
      nodes.splice(i, 1)
      alive.delete(n.id)
      changed = true
    }
  }

  const kept = new Set(nodes.map((n) => n.id))
  const finalEdges = edges.filter((e) => kept.has(e.from) && kept.has(e.to))

  // 4. 新卡片落在父卡片右边（以前对账的落点），免得叠在别人身上。
  //    唯一的例外是入口：它是子文档的**上级**，落在子文档左边才符合「从入口往右读」的方向。
  //    老数据第一次补入口时尤其要防重叠——入口的种子坐标是世界原点，而老图的根文档
  //    八成就铺在原点上，不挪的话入口正好压在根文档底下，看起来就是「没有入口」。
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const hOf = heightOf(store)
  for (const n of nodes) {
    if (savedNodes.has(n.id)) continue
    if (n.kind === 'entry') {
      // 入口的落位锚是它的**子文档**（根文档）：铺到子文档左边，撞到谁就再往下挪
      const childEdge = finalEdges.find((e) => e.from === n.id)
      const child = childEdge ? byId.get(childEdge.to) : undefined
      if (child) {
        const spot = freeSpotNear(
          nodes.filter((x) => x.id !== n.id),
          { x: child.x - CARD_W - 96, y: child.y },
          { width: CARD_W, height: CARD_H },
          hOf,
        )
        n.x = spot.x
        n.y = spot.y
      }
      continue
    }
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
    /*
     * 墓碑必须跟着派生图走：组件里所有写回都以「派生图」为底合并（`{ ...map, ...next }`），
     * 这里一丢，下一次删除或拖动就会把 saved 里的 hidden 整个冲掉——
     * 用户会看到「删了一张卡，之前删掉的卡全回来了」。
     */
    ...(saved.hidden?.length ? { hidden: saved.hidden } : {}),
  }
}
