/**
 * 入口：一张结构图有且只有一个的「从这里开始」节点。
 *
 * 它是**纯图件**——不指回任何实体（structure 不变量 2：ref 为空 = 空节点），
 * 所以它只存在于 structure.json 的 saved.nodes 里，永远不会被派生补出来或冲掉。
 *
 * 两条硬约束（都不在这一层，落在各自的执行点）：
 * - 下游只能是一份文档（targets），且**有且只有一个**——唯一性由 canAddEdge 把关
 *   （entry 再连第二份文档会被拒绝），画布上唯一由组件在拖入时把关；
 * - 被它选中的那份文档就是这门课的**权威根节点**（从哪儿开始学），画布给它挂徽章。
 */
import type { NodeKindSpec } from './base'

export const entryKind: NodeKindSpec = {
  type: 'entry',
  label: '入口',
  /** 排在所有类型之前：它是一张图的起点，自动排列时也该在最左列最上面 */
  rank: -1,
  targets: ['doc'],
  format: 'markdown',
  singleton: true,
  anchor: true,
  facet: { label: '入口' },
}
