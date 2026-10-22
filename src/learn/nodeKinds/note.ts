/** 笔记：学习者与导师都能写的一份 markdown。叶子，不再往下连。 */
import type { NodeKindSpec } from './base'

export const noteKind: NodeKindSpec = {
  type: 'note',
  label: '笔记',
  rank: 2,
  targets: [],
  format: 'markdown',
  facet: { label: '笔记' },
}
