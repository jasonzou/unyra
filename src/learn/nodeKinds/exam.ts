/** 试卷：一次出卷 + 历次作答。叶子，不再往下连。 */
import type { NodeKindSpec } from './base'

export const examKind: NodeKindSpec = {
  type: 'exam',
  label: '试卷',
  rank: 2,
  targets: [],
  format: 'json',
  facet: { label: '试卷' },
}
