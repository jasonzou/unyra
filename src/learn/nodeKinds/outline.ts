/**
 * 大纲：一个节点的一份结构化计划（intro + 直接目标项一层 children）。
 *
 * 只连文档——「大纲的父子节点只能是文档」（2026-10-21 用户定的拓扑）。
 */
import type { NodeKindSpec } from './base'

export const outlineKind: NodeKindSpec = {
  type: 'outline',
  label: '大纲',
  rank: 0,
  targets: ['doc'],
  format: 'json',
  singleton: true,
  facet: { label: '大纲' },
}
