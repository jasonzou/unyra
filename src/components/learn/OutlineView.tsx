/*
 * 这个文件负责：结构页（页签 kind 'outline'）——**一个目标的节点图**。
 *
 * 它曾经是「一个目标的大纲树」（思维导图，位置由布局算法算）。现在换成了无限画布上的
 * 类型化节点图：节点各自独立、位置由用户拖、连线由用户连（见 learn/structure 与
 * components/learn/structure/StructureCanvas）。
 *
 * 图是**目标级**的（`docs/{目标}/structure.json`），不是节点级：同一门课里
 * 大纲节点、文档节点、笔记节点都在这一张图上。页签绑定的那个节点只决定
 * 「打开时先看谁」（见 focusTarget）。
 */

import { memo, useCallback } from 'react'
import type { KnowledgeNode, LearnStore } from '../../learn/types'
import type { StructureMap } from '../../learn/structure'
import type { ExamActions, NodeDocActions } from './explorer/types'
import { StructureCanvas } from './structure/StructureCanvas'

export interface OutlineViewProps {
  store: LearnStore
  /** 这一页属于哪个节点（页签绑定的那个）；图本身按 goalId 取 */
  node: KnowledgeNode
  /** 图变了：上层写进 store 并落盘（goalId 由这里补上，调用方只认图） */
  onChangeStructure: (goalId: string, next: StructureMap) => void
  /** 文档那一侧的动作（点标题打开教学文档 / 笔记 / 超级文档） */
  docs: NodeDocActions
  /** 考试那一侧的动作（点试卷标题开考试窗口） */
  exams: ExamActions
  /** 新建一份笔记并返回名字（笔记节点不需要上下文，拖出来就是真笔记） */
  onCreateNote?: (nodeId: string) => string | null
  onCreateExam?: (nodeId: string) => string | null
  onCreateSuperDoc?: (nodeId: string) => string | null
  /** 改笔记名 */
  onRenameNote?: (nodeId: string, from: string, to: string) => void
  /** 给某个节点的大纲手动加一条目标项 */
  onAddOutlineEntry?: (nodeId: string, title: string) => void
  /** 在目标项上挂一份带标题的空文档（壳），返回新节点 id */
  onCreateChildDoc?: (ownerNodeId: string, title: string) => string | null
  /** 空文档卡上的「生成文档」：交给 AI 写正文。hint 为画布侧的意图（挂在哪条目标项下） */
  onGenerateDoc?: (nodeId: string, hint?: string) => void
  /** 空大纲卡上的「生成大纲」：按上游文档节点生成前置知识大纲 */
  onGenerateOutline?: (ownerNodeId: string) => void
  onToast?: (msg: string) => void
  /** 外部指定的聚焦目标（如 chip 路由） */
  focusTarget?: { nodeId: string; nonce: number } | null
  onFocusHandled?: () => void
}

function sameOutlineView(prev: OutlineViewProps, next: OutlineViewProps): boolean {
  if (prev.node !== next.node) return false
  if (prev.store.structure !== next.store.structure) return false
  if (prev.store.nodes !== next.store.nodes || prev.store.exams !== next.store.exams) return false
  if (prev.docs !== next.docs || prev.exams !== next.exams) return false
  if (prev.focusTarget !== next.focusTarget) return false
  return true
}

export default memo(function OutlineView({
  store,
  node,
  onChangeStructure,
  docs,
  exams,
  onCreateNote,
  onCreateExam,
  onCreateSuperDoc,
  onRenameNote,
  onAddOutlineEntry,
  onCreateChildDoc,
  onGenerateDoc,
  onGenerateOutline,
  onToast,
  focusTarget,
  onFocusHandled,
}: OutlineViewProps) {
  const goalId = node.goalId
  const change = useCallback((next: StructureMap) => onChangeStructure(goalId, next), [onChangeStructure, goalId])
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-paper dark:bg-card/30">
      <div className="relative min-h-0 flex-1">
        <StructureCanvas
          store={store}
          goalId={goalId}
          onChange={change}
          docs={docs}
          exams={exams}
          onCreateNote={onCreateNote}
          onCreateExam={onCreateExam}
          onCreateSuperDoc={onCreateSuperDoc}
          onRenameNote={onRenameNote}
          onAddOutlineEntry={onAddOutlineEntry}
          onCreateChildDoc={onCreateChildDoc}
          onGenerateDoc={onGenerateDoc}
          onGenerateOutline={onGenerateOutline}
          onToast={onToast}
          focusTarget={focusTarget}
          onFocusHandled={onFocusHandled}
        />
      </div>
    </div>
  )
}, sameOutlineView)

