/** 超级文档：一整份可交互 HTML（讲义、演示、小工具）。叶子，不再往下连。 */
import type { NodeKindSpec } from './base'

export const superdocKind: NodeKindSpec = {
  type: 'superdoc',
  label: '超级文档',
  rank: 2,
  targets: [],
  format: 'html',
  facet: { label: '超级文档' },
}
