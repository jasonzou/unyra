import { describe, expect, it } from 'vitest'
import { buildDocs, parseDocsV3 } from '../src/learn/files'
import { emptyDocs } from '../src/learn/groups'
import { deriveCanvas } from '../src/components/learn/structure/structureView'
import type { LearnStore } from '../src/learn/types'

describe('空学习目标持久化与画布派生', () => {
  it('新建无根节点的空目标可完整落盘并解析读回', () => {
    const goalId = 'goal-empty-1'
    const now = 1700000000000
    const store: LearnStore = {
      version: 2,
      nodes: [],
      edges: [],
      goals: [
        {
          id: goalId,
          title: '深入理解计算机系统',
          question: '深入理解计算机系统',
          rootNodeId: '',
          createdAt: now,
          updatedAt: now,
        },
      ],
      conversations: [
        {
          id: 'conv-empty-1',
          goalId,
          messages: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
      exams: [],
      tmp: {},
      resources: {},
      activeGoalId: goalId,
      activeNodeId: null,
      activeConversationId: 'conv-empty-1',
      docArea: emptyDocs(),
      drafts: {},
      docScroll: {},
      localFiles: [],
    }

    const files = buildDocs(store)
    expect(files.has('docs/深入理解计算机系统/goal.json')).toBe(true)
    expect(files.has('docs/深入理解计算机系统/chat.json')).toBe(true)

    const goalJson = JSON.parse(files.get('docs/深入理解计算机系统/goal.json') as string)
    expect(goalJson.id).toBe(goalId)
    expect(goalJson.title).toBe('深入理解计算机系统')
    expect(goalJson.rootNodeId).toBe('')

    // 读回校验
    const restored = parseDocsV3(files, {})
    expect(restored).not.toBeNull()
    expect(restored!.goals.length).toBe(1)
    expect(restored!.goals[0].id).toBe(goalId)
    expect(restored!.goals[0].title).toBe('深入理解计算机系统')
    expect(restored!.goals[0].rootNodeId).toBe('')
    expect(restored!.conversations.length).toBe(1)
    expect(restored!.conversations[0].goalId).toBe(goalId)
  })

  it('空目标在没有文档节点时，deriveCanvas 能正常返回空图而不会报错', () => {
    const goalId = 'goal-empty-1'
    const store: LearnStore = {
      version: 2,
      nodes: [],
      edges: [],
      goals: [
        {
          id: goalId,
          title: '空目标',
          question: '空目标',
          rootNodeId: '',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      conversations: [],
      exams: [],
      tmp: {},
      resources: {},
      activeGoalId: goalId,
      activeNodeId: null,
      activeConversationId: null,
      docArea: emptyDocs(),
      drafts: {},
      docScroll: {},
      localFiles: [],
    }
    const canvas = deriveCanvas(store, goalId, undefined)
    expect(canvas.cards).toEqual([])
    expect(canvas.edges).toEqual([])
  })
})
