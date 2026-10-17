/*
 * 这个文件负责：大纲页（页签 kind 'outline'）——一个**目标**的路线图。
 *
 * 它是目标级的（不是节点级）：页签由目标根节点打开，页上只有一张思维导图，
 * 目标的路线怎么展开、哪些节点建了、哪些还在计划里，一眼看全。
 * 顶部通栏已被移除，给导图画布最大的可视空间。
 */

import { memo } from 'react'
import type { KnowledgeNode, LearnStore, OutlineEntry, TabRef } from '../../learn/types'
import type { ExamActions, NodeDocActions } from './explorer/types'
import MindmapView from './outline/MindmapView'

export interface OutlineViewProps {
  store: LearnStore
  /** 这一页大纲属于哪个目标 */
  node: KnowledgeNode
  /** 打开某个子目标的教学文档 */
  onOpenNode: (nodeId: string) => void
  /** 把大纲里还没创建的子目标真的建出来（交给导师开讲） */
  onCreateChild: (parentNode: KnowledgeNode, entry: OutlineEntry) => void
  /** 请导师规划 / 重排某个节点的大纲 */
  onGenerate: (node: KnowledgeNode) => void
  /** 改某个节点的自定义颜色（右键节点改色）；null = 回到「随分支」 */
  onSetTint: (nodeId: string, tint: string | null) => void
  /** 节点 tip 里的文档动作（与侧栏资源管理器同一份） */
  docs: NodeDocActions
  /** 考试那一侧的动作 */
  exams: ExamActions
  /** 焦点格里正开着的那份文档（tip 里对应行要亮） */
  activeTab: TabRef | null
  /** 外部指定的聚焦/选中节点目标（如 chip 路由） */
  focusTarget?: { nodeId: string; nonce: number } | null
  /** 外部聚焦已完成的回调 */
  onFocusHandled?: () => void
}

function sameOutlineView(prev: OutlineViewProps, next: OutlineViewProps): boolean {
  if (prev.node !== next.node) return false
  if (prev.store.nodes !== next.store.nodes || prev.store.edges !== next.store.edges || prev.store.exams !== next.store.exams) return false
  if (prev.focusTarget !== next.focusTarget) return false
  return true
}

export default memo(function OutlineView({
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
}: OutlineViewProps) {
  const t0 = (window as any).__tabSwitchT0
  const prefix = typeof t0 === 'number' ? `${(performance.now() - t0).toFixed(1)}ms: ` : ''
  console.log(`[TabSwitch] ${prefix}👁️ OutlineView rendered for node="${node.title}"`)

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-paper dark:bg-card/30">
      <div className="relative min-h-0 flex-1">
        <MindmapView
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
    </div>
  )
}, sameOutlineView)
