/**
 * 文档：教学正文，同时是**把子树接上去的连接件**。
 *
 * 它能连四种东西：自己的大纲（先文档再大纲）、笔记、试卷、超级文档。
 * 这一条 `targets` 就是原来 `GRAPH_EDGE_RULES.doc` 的全部内容。
 */
import type { NodeKindSpec } from './base'

export const docKind: NodeKindSpec = {
  type: 'doc',
  label: '文档',
  rank: 1,
  targets: ['outline', 'note', 'exam', 'superdoc'],
  format: 'markdown',
  singleton: true,
  facet: { label: '文档' },
}
