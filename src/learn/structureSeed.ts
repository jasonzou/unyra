/**
 * 这个文件负责什么：**从内存里的 store 铺一张结构图**——第一次打开结构页（或新目标第一次进来）时用。
 *
 * 为什么不写在 learn/structure.ts 里：那个文件是纯几何与规则的领域层，不认识 LearnStore；
 * 这里只做「把 store 拼成装配输入」这一件事，装配规则本身仍然只有一份（structure 的 seedFromSource）。
 * 数据迁移走的是同一条装配，只是它的输入来自磁盘文件而不是内存（见 lib/migration/outlineStructure）。
 */

import type { LearnStore } from './types'
import { heightOf, seedFromSource, type SeedSourceNode, type StructureMap } from './structure'

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
    hasDoc: node.docs.teaching.trim().length > 0,
    downstream: downstream.get(node.id) ?? [],
    notes: node.notes.map((n) => n.name),
    superdocs: (node.superdocs ?? []).map((s) => s.name),
    exams: examsByNode.get(node.id) ?? [],
  }))

  return seedFromSource(source, heightOf(store))
}
