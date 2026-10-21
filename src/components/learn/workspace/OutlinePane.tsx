/*
 * 这个文件负责：**一片常驻的结构页（无限画布节点图）**。
 *
 * 为什么要常驻：画布里有相机（平移 / 缩放）、节点卡片与连线，切页签时销毁重建会让
 * 「我刚刚看到哪一块」丢掉。切走只藏不卸，切回时零延迟复原。
 *
 * 为什么要 memo + sameOutlinePane 冻结：未激活时彻底冻结，不跟随父级 LearnWorkspace
 * 的频繁 store/state 变化重新排版；当 active 变为 true 时才解除冻结并渲染最新状态。
 */

import { memo } from 'react'
import type { KnowledgeNode, LearnStore } from '../../../learn/types'
import type { StructureMap } from '../../../learn/structure'
import type { ExamActions, NodeDocActions } from '../explorer/types'
import OutlineView from '../OutlineView'

export interface OutlinePaneProps {
  active: boolean
  tabId: string
  store: LearnStore
  node: KnowledgeNode
  onChangeStructure: (goalId: string, next: StructureMap) => void
  docs: NodeDocActions
  exams: ExamActions
  onCreateNote?: (nodeId: string) => string | null
  onRenameNote?: (nodeId: string, from: string, to: string) => void
  onAddOutlineEntry?: (nodeId: string, title: string) => void
  onToast?: (msg: string) => void
  focusTarget?: { nodeId: string; nonce: number } | null
  onFocusHandled?: () => void
}

function sameOutlinePane(prev: OutlinePaneProps, next: OutlinePaneProps): boolean {
  // 激活状态变化（显示/隐藏切换）：必须重渲染以切换 className 和 hidden 属性
  if (prev.active !== next.active || prev.tabId !== next.tabId) return false

  // 隐藏状态下：彻底冻结！不跟随任何 store/node 改动重算图与连线
  if (!next.active) {
    if (next.focusTarget && next.focusTarget !== prev.focusTarget) return false
    return true
  }

  // 激活状态下：仅当外部关注节点、结构图或节点数据有变时才重渲染
  if (prev.focusTarget !== next.focusTarget) return false
  if (prev.node !== next.node) return false
  if (prev.store.structure !== next.store.structure) return false
  if (prev.store.nodes !== next.store.nodes || prev.store.exams !== next.store.exams) return false
  return true
}

export const OutlinePane = memo(function OutlinePane({
  active,
  tabId: _tabId,
  store,
  node,
  onChangeStructure,
  docs,
  exams,
  onCreateNote,
  onRenameNote,
  onAddOutlineEntry,
  onToast,
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
        onChangeStructure={onChangeStructure}
        docs={docs}
        exams={exams}
        onCreateNote={onCreateNote}
        onRenameNote={onRenameNote}
        onAddOutlineEntry={onAddOutlineEntry}
        onToast={onToast}
        focusTarget={focusTarget}
        onFocusHandled={onFocusHandled}
      />
    </div>
  )
}, sameOutlinePane)
