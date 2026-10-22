/**
 * 节点类型登记表：**唯一的类型清单**。
 *
 * 这个对象就是 `GraphKind` 的来源——加一个键，联合类型自动多一个成员，
 * 所有 `Record<GraphKind, …>` 的地方会在编译期提醒你补上。
 *
 * 顺序是给人看的（也是 `GRAPH_KINDS` 的顺序）；真正决定连线的是每个类型自己的 `targets`，
 * 决定同列上下的是 `rank`。两者都不在这里重复写。
 */
import type { NodeKindSpec } from './base'
import { docKind } from './doc'
import { examKind } from './exam'
import { noteKind } from './note'
import { outlineKind } from './outline'
import { superdocKind } from './superdoc'

export const NODE_KINDS = {
  outline: outlineKind,
  doc: docKind,
  note: noteKind,
  exam: examKind,
  superdoc: superdocKind,
} satisfies Record<string, NodeKindSpec>

export type GraphKind = keyof typeof NODE_KINDS

/** 全部类型（顺序即登记顺序） */
export const GRAPH_KINDS = Object.keys(NODE_KINDS) as GraphKind[]

/** 取一种类型的登记项 */
export function kindSpec(kind: GraphKind): NodeKindSpec {
  return NODE_KINDS[kind]
}

/** 读盘时的类型闸门：认不出来的类型一律丢掉（宁少一个节点，不留一个坏节点） */
export function isGraphKind(v: unknown): v is GraphKind {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(NODE_KINDS, v)
}

/** 显示名表：卡片、设置页、api 说明共用 */
export const GRAPH_KIND_LABEL = Object.fromEntries(
  GRAPH_KINDS.map((k) => [k, NODE_KINDS[k].label]),
) as Record<GraphKind, string>

/** 连线规则表：由各类型的 `targets` 派生（`from` 能把上下文交给 `to`） */
export const GRAPH_EDGE_RULES = Object.fromEntries(
  GRAPH_KINDS.map((k) => [k, NODE_KINDS[k].targets]),
) as Record<GraphKind, readonly string[]>

/** 同列排序权重：由各类型的 `rank` 派生 */
export const KIND_RANK = Object.fromEntries(
  GRAPH_KINDS.map((k) => [k, NODE_KINDS[k].rank]),
) as Record<GraphKind, number>

export type { NodeKindSpec, NodeFormat } from './base'
