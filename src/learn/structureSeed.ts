/**
 * 这个文件负责什么：**从内存里的 store 铺一张结构图**——第一次打开结构页（或新目标第一次进来）时用。
 *
 * 为什么不写在 learn/structure.ts 里：那个文件是纯几何与规则的领域层，不认识 LearnStore；
 * 这里只做「把 store 拼成装配输入」这一件事，装配规则本身仍然只有一份（structure 的 seedFromSource）。
 * 数据迁移走的是同一条装配，只是它的输入来自磁盘文件而不是内存（见 lib/migration/outlineStructure）。
 */

import type { LearnStore } from './types'
import {
  CARD_H,
  CARD_W,
  docGid,
  examGid,
  heightOf,
  noteGid,
  outlineGid,
  seedFromSource,
  slotOrderOf,
  superdocGid,
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

  const source: SeedSourceNode[] = nodes.map((node) => ({
    id: node.id,
    key: node.key,
    downstream: downstream.get(node.id) ?? [],
    notes: node.notes.map((n) => n.name),
    superdocs: (node.superdocs ?? []).map((s) => s.name),
    exams: examsByNode.get(node.id) ?? [],
  }))

  return seedFromSource(source, heightOf(store), slotOrderOf(store, goalId))
}

/* ---------- 对账：让图跟上实体 ---------- */

/**
 * 把「实体」与「画布上的节点」对一遍，缺的补上。
 *
 * 为什么需要它：图是一份**快照**（structure.json），而实体是会自己长出来的——
 * agent 写了一份教学文档、在资源管理器里新建了一份笔记、出了一份试卷……
 * 这些都不经过画布。没有对账的话，画布就永远停在第一次铺出来的那一刻，
 * 用户会问「为什么生成的文档没有出现在画布上」（问过一次了）。
 *
 * 三条规矩：
 * 1. **只补不删**：实体没了不自动清节点（用户可能只是暂时删了内容，位置还要留着）；
 * 2. **补的时候带上连线**：一张孤零零的文档卡没有意义，边一定跟着补；
 * 3. **用户删过的不再补**：`map.hidden` 记着那些被主动移除的节点 id。
 */
export function reconcileStructure(store: LearnStore, goalId: string, map: StructureMap): StructureMap {
  const nodes = [...map.nodes]
  const edges = [...map.edges]
  const hidden = new Set(map.hidden ?? [])
  const ids = new Set(nodes.map((n) => n.id))
  const linked = new Set(edges.map((e) => `${e.from}>${e.to}`))
  let changed = false

  /** 找一个没被占的落点：同一位置有卡就往下挪一格 */
  const spot = (x: number, y: number) => {
    let yy = y
    for (let i = 0; i < 40; i++) {
      if (!nodes.some((n) => Math.abs(n.x - x) < 1 && Math.abs(n.y - yy) < 1)) break
      yy += CARD_H + 24
    }
    return { x, y: yy }
  }

  const add = (node: StructureNode) => {
    nodes.push(node)
    ids.add(node.id)
    changed = true
    return node
  }

  /** 补一条边（两端都在图上才补） */
  const link = (from: string, to: string) => {
    if (!ids.has(from) || !ids.has(to) || linked.has(`${from}>${to}`)) return
    edges.push({ from, to })
    linked.add(`${from}>${to}`)
    changed = true
  }

  const goalNodes = store.nodes.filter((n) => n.goalId === goalId)

  for (const owner of goalNodes) {
    const did = docGid(owner.id)
    const oid = outlineGid(owner.id)
    const parentId = store.edges.find((e) => e.to === owner.id)?.from
    const parentOutline = parentId ? nodes.find((n) => n.id === outlineGid(parentId)) : undefined
    const parentDoc = parentId ? nodes.find((n) => n.id === docGid(parentId)) : undefined

    // 1. 文档：连接件，无条件存在
    let doc = nodes.find((n) => n.id === did) ?? null
    if (!doc && !hidden.has(did)) {
      const base = parentOutline ?? parentDoc
      const at = spot(base ? base.x + CARD_W + 96 : 0, base ? base.y : 0)
      doc = add({ id: did, kind: 'doc', ref: owner.id, x: at.x, y: at.y })
    }
    if (!doc) continue

    // 2. 大纲：挂在这份文档右边（先文档再大纲）
    let outline = nodes.find((n) => n.id === oid) ?? null
    if (!outline && !hidden.has(oid)) {
      const at = spot(doc.x + CARD_W + 96, doc.y)
      outline = add({ id: oid, kind: 'outline', ref: owner.id, x: at.x, y: at.y })
    }
    if (!outline) continue
    link(doc.id, outline.id)

    // 3. 父大纲 → 这份文档（顺便认领接入点）
    if (parentId) {
      const pid = outlineGid(parentId)
      if (ids.has(pid)) {
        link(pid, doc.id)
        if (!doc.slot && owner.key) {
          const idx = nodes.findIndex((n) => n.id === doc!.id)
          nodes[idx] = { ...nodes[idx], slot: owner.key }
          doc = nodes[idx]
          changed = true
        }
      }
    }

    // 4. 叶子：笔记 / 超级文档 / 试卷，挂在文档下面
    const leaves: Array<{ gid: string; kind: 'note' | 'superdoc' | 'exam'; ref: string }> = [
      ...owner.notes.map((note) => ({ gid: noteGid(owner.id, note.name), kind: 'note' as const, ref: `${owner.id}:${note.name}` })),
      ...(owner.superdocs ?? []).map((sd) => ({ gid: superdocGid(owner.id, sd.name), kind: 'superdoc' as const, ref: `${owner.id}:${sd.name}` })),
      ...store.exams
        .filter((e) => e.nodeId === owner.id)
        .map((exam) => ({ gid: examGid(exam.id), kind: 'exam' as const, ref: exam.id })),
    ]
    for (const leaf of leaves) {
      if (ids.has(leaf.gid) || hidden.has(leaf.gid)) continue
      const at = spot(doc.x + CARD_W + 96, doc.y)
      add({ id: leaf.gid, kind: leaf.kind, ref: leaf.ref, x: at.x, y: at.y })
      link(doc.id, leaf.gid)
    }
  }

  // 没有任何变化时返回**同一个对象**：调用方的 effect 靠这个判断要不要写回，避免死循环
  if (!changed) return map
  return { ...map, nodes, edges }
}
