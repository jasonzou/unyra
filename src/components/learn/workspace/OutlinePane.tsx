/*
 * 这个文件负责：**一片常驻的大纲页（思维导图）**。
 *
 * 为什么要常驻：导图页面包含庞大的节点树、SVG 贝塞尔曲线、卡片 DOM 以及相机视角。
 * 切页签时切勿每次销毁与重建，而是通过 hidden（display:none）保持在 DOM 中。
 *
 * 为什么要 memo + sameOutlinePane 冻结：
 * 未激活时彻底冻结，不跟随父级 LearnWorkspace 的频繁 store/state 变化重新排版和重绘；
 * 当 active 变为 true 时才解除冻结并渲染最新状态。
 */

import { memo } from 'react'
import type { KnowledgeNode, LearnStore, OutlineEntry, TabRef } from '../../../learn/types'
import type { ExamActions, NodeDocActions } from '../explorer/types'
import OutlineView from '../OutlineView'

export interface OutlinePaneProps {
  active: boolean
  tabId: string
  store: LearnStore
  node: KnowledgeNode
  onOpenNode: (nodeId: string) => void
  onCreateChild: (parentNode: KnowledgeNode, entry: OutlineEntry) => void
  onGenerate: (node: KnowledgeNode) => void
  onSetTint: (nodeId: string, tint: string | null) => void
  docs: NodeDocActions
  exams: ExamActions
  activeTab: TabRef | null
  focusTarget?: { nodeId: string; nonce: number } | null
  onFocusHandled?: () => void
}

function sameOutlinePane(prev: OutlinePaneProps, next: OutlinePaneProps): boolean {
  // 激活状态变化（显示/隐藏切换）：必须重渲染以切换 className 和 hidden 属性
  if (prev.active !== next.active || prev.tabId !== next.tabId) return false

  // 隐藏状态下：彻底冻结！不跟随任何 store/node 改动重算导图和贝塞尔曲线
  if (!next.active) {
    if (next.focusTarget && next.focusTarget !== prev.focusTarget) return false
    return true
  }

  // 激活状态下：仅当外部关注节点、导图节点树、结构边或外部操作有变时才重渲染
  if (prev.focusTarget !== next.focusTarget) return false
  if (prev.node !== next.node) return false
  if (prev.store.nodes !== next.store.nodes || prev.store.edges !== next.store.edges) return false
  return true
}

export const OutlinePane = memo(function OutlinePane({
  active,
  tabId: _tabId,
  store,
  node,
  onOpenNode,
  onCreateChild,
  onGenerate,
  onSetTint,
  docs,
  exams,
  activeTab,
  focusTarget,
  onFocusHandled,
}: OutlinePaneProps) {
  return (
    <div
      data-outline-pane={active ? 'active' : 'idle'}
      className={active ? 'relative flex min-h-0 flex-1 flex-col' : 'hidden'}
      {...(!active ? { hidden: true } : {})}
    >
      <OutlineView
        store={store}
        node={node}
        onOpenNode={onOpenNode}
        onCreateChild={onCreateChild}
        onGenerate={onGenerate}
        onSetTint={onSetTint}
        docs={docs}
        exams={exams}
        activeTab={activeTab}
        focusTarget={focusTarget}
        onFocusHandled={onFocusHandled}
      />
    </div>
  )
}, sameOutlinePane)
