/**
 * 节点类型登记表：**唯一的类型清单**。
 *
 * 这个对象就是 `GraphKind` 的来源——加一个键，联合类型自动多一个成员，
 * 所有 `Record<GraphKind, …>` 的地方会在编译期提醒你补上。
 *
 * 顺序是给人看的（也是 `GRAPH_KINDS` 的顺序）；真正决定连线的是每个类型自己的 `targets`，
 * 决定同列上下的是 `rank`。两者都不在这里重复写。
 */
import type { NodeKindSpec, NodeMethodDoc } from './base'
import { docKind, DocHandle } from './doc'
import { entryKind } from './entry'
import { examKind } from './exam'
import { noteKind, NoteHandle } from './note'
import { outlineKind, OutlineHandle } from './outline'
import { superdocKind, SuperdocHandle } from './superdoc'
import type { NodeHandle } from './handle'

export const NODE_KINDS = {
  entry: entryKind,
  outline: outlineKind,
  doc: docKind,
  note: noteKind,
  exam: examKind,
  superdoc: superdocKind,
} satisfies Record<string, NodeKindSpec>

export type GraphKind = keyof typeof NODE_KINDS

/**
 * 内容节点的行为类：api 层解析地址后用它实例化节点对象（api.node 通道）。
 * 键与登记表对齐——**声明了 methods 的类型必须有行为类**（对账见 tests/nodeHandle）；
 * 入口 / 试卷不是内容载体（没有 methods），不在这里。
 */
export const NODE_HANDLES = {
  doc: DocHandle,
  outline: OutlineHandle,
  note: NoteHandle,
  superdoc: SuperdocHandle,
} as const satisfies Record<string, new (ctx: import('./handle').HandleContext, nodeId: string, baseLabel: string, name?: string) => NodeHandle>

/** 有节点对象行为的类型（= 登记表里声明了 methods 的那几个，编译期由 NODE_HANDLES 键约束） */
export type HandleKind = keyof typeof NODE_HANDLES

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

/** 查一个类型的某个成员方法声明（调用校验与 help 共用）；没有就是 null */
export function methodDocOf(kind: GraphKind, name: string): NodeMethodDoc | null {
  return NODE_KINDS[kind].methods?.find((m) => m.name === name) ?? null
}

/**
 * 各类型成员方法的一览（api.node 组的 help 正文用它）：声明是唯一来源，
 * 这里只做排版——加一种内容类型，help 自动跟上，不用另抄一份清单。
 */
export function renderKindMethodsTable(): string {
  const lines: string[] = []
  for (const k of GRAPH_KINDS) {
    const spec = NODE_KINDS[k]
    if (!spec.methods?.length) continue
    const via = k === 'doc' ? 'api.node(路径)' : 'api.node(路径).' + (k === 'outline' ? 'outline()' : k + "(名字)")
    lines.push('- ' + spec.label + '（' + via + '）: ' + spec.methods.map((m) => m.signature.split('(')[0]).join(' / '))
  }
  return lines.join('\n')
}

export type { NodeKindSpec, NodeFormat, NodeMethodDoc } from './base'
export type { NodeHandle, HandleContext } from './handle'
