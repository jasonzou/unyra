import { describe, expect, it } from 'vitest'
import { emptyLearnStore } from '../src/learn/store/empty'
import { nodeById } from '../src/learn/graph/lookup'
import { parentIds, prereqIds } from '../src/learn/graph/edges'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import {
  GRAPH_EDGE_RULES,
  GRAPH_KINDS,
  GRAPH_KIND_LABEL,
  KIND_RANK,
  NODE_KINDS,
  isGraphKind,
} from '../src/learn/nodeKinds'

function makeNode(id: string, title = id): KnowledgeNode {
  return {
    id,
    title,
    key: title.trim().toLowerCase(),
    description: '',
    docs: { teaching: '' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId: 'g1',
    createdAt: 1,
    updatedAt: 1,
  }
}

function storeWith(ids: string[], edges: Array<[string, string]> = []): LearnStore {
  const base = emptyLearnStore()
  return {
    ...base,
    nodes: ids.map((id) => makeNode(id)),
    edges: edges.map(([from, to]) => ({ from, to, createdAt: 1 })),
  }
}

/**
 * P0 的两个索引（按 id 取节点、按边取邻接）都挂在**数组引用**上做缓存。
 * 这里钉住的是三件事：结果与原来的线性查找逐项一致、重复 id 仍取第一个、
 * 数组换了之后索引跟着换（不能拿旧缓存骗人）。
 */
describe('P0：图索引', () => {
  describe('nodeById', () => {
    it('结果与线性查找一致', () => {
      const store = storeWith(['a', 'b', 'c'])
      for (const id of ['a', 'b', 'c']) {
        expect(nodeById(store, id)?.id).toBe(store.nodes.find((n) => n.id === id)?.id)
      }
      expect(nodeById(store, 'nope')).toBeUndefined()
    })

    it('重复 id 保留第一个（与原 find 语义一致）', () => {
      const base = emptyLearnStore()
      const first = makeNode('dup', '第一个')
      const second = makeNode('dup', '第二个')
      const store: LearnStore = { ...base, nodes: [first, second] }
      expect(nodeById(store, 'dup')?.title).toBe('第一个')
    })

    it('节点数组换了之后索引跟着换（不会命中旧缓存）', () => {
      const before = storeWith(['a', 'b'])
      expect(nodeById(before, 'b')?.id).toBe('b')

      // store 是不可变的：删节点 = 换一个新数组
      const after: LearnStore = { ...before, nodes: before.nodes.filter((n) => n.id !== 'b') }
      expect(nodeById(after, 'b')).toBeUndefined()
      expect(nodeById(after, 'a')?.id).toBe('a')
      // 旧 store 仍然自洽
      expect(nodeById(before, 'b')?.id).toBe('b')
    })
  })

  describe('prereqIds / parentIds', () => {
    it('两个方向的结果与原来的 filter 逐项一致（含顺序）', () => {
      const store = storeWith(
        ['root', 'a', 'b', 'c'],
        [
          ['root', 'a'],
          ['root', 'b'],
          ['a', 'c'],
        ],
      )
      for (const id of ['root', 'a', 'b', 'c', 'nope']) {
        expect(prereqIds(store, id)).toEqual(
          store.edges.filter((e) => e.from === id).map((e) => e.to),
        )
        expect(parentIds(store, id)).toEqual(store.edges.filter((e) => e.to === id).map((e) => e.from))
      }
    })

    it('边数组换了之后邻接索引跟着换', () => {
      const before = storeWith(['a', 'b'], [['a', 'b']])
      expect(prereqIds(before, 'a')).toEqual(['b'])

      // 直接换一个边数组（绕开 addEdge 的环检测：这里测的是索引，不是规则）
      const after: LearnStore = { ...before, edges: [...before.edges, { from: 'b', to: 'a', createdAt: 2 }] }
      expect(prereqIds(after, 'a')).toEqual(['b'])
      expect(prereqIds(after, 'b')).toEqual(['a'])
      expect(parentIds(after, 'a')).toEqual(['b'])
      // 旧 store 的索引没被污染
      expect(prereqIds(before, 'b')).toEqual([])
    })

    it('返回的是只读缓存：调用方 copy 之后可以随便改，不影响下一次查询', () => {
      const store = storeWith(['a', 'b', 'c'], [
        ['a', 'b'],
        ['a', 'c'],
      ])
      const first = [...prereqIds(store, 'a')].sort().reverse()
      expect(first).toEqual(['c', 'b'])
      expect(prereqIds(store, 'a')).toEqual(['b', 'c'])
    })
  })
})

/**
 * 类型登记表：一种类型一个文件，`nodeKinds/index.ts` 汇总。
 * 这里钉住「派生出来的那几张表确实来自登记项」，以及 2026-10-21 定的连线拓扑没被改动。
 */
describe('P0：类型登记表', () => {
  it('GRAPH_KINDS 就是登记表的键', () => {
    expect(GRAPH_KINDS).toEqual(Object.keys(NODE_KINDS))
    expect(GRAPH_KINDS).toEqual(['outline', 'doc', 'note', 'exam', 'superdoc'])
  })

  it('显示名 / 同列权重 / 连线规则都从登记项派生', () => {
    for (const kind of GRAPH_KINDS) {
      expect(GRAPH_KIND_LABEL[kind]).toBe(NODE_KINDS[kind].label)
      expect(KIND_RANK[kind]).toBe(NODE_KINDS[kind].rank)
      expect(GRAPH_EDGE_RULES[kind]).toEqual(NODE_KINDS[kind].targets)
    }
  })

  it('连线拓扑与 2026-10-21 定的一致（大纲只连文档，叶子不往下连）', () => {
    expect(GRAPH_EDGE_RULES.outline).toEqual(['doc'])
    expect(GRAPH_EDGE_RULES.doc).toEqual(['outline', 'note', 'exam', 'superdoc'])
    expect(GRAPH_EDGE_RULES.note).toEqual([])
    expect(GRAPH_EDGE_RULES.exam).toEqual([])
    expect(GRAPH_EDGE_RULES.superdoc).toEqual([])
  })

  it('同列次序：大纲在上、文档居中、叶子在下', () => {
    expect(KIND_RANK.outline).toBeLessThan(KIND_RANK.doc)
    expect(KIND_RANK.doc).toBeLessThan(KIND_RANK.note)
    expect(KIND_RANK.note).toBe(KIND_RANK.exam)
    expect(KIND_RANK.exam).toBe(KIND_RANK.superdoc)
  })

  it('isGraphKind 只认登记过的类型（没登记的读盘时被丢掉）', () => {
    for (const kind of GRAPH_KINDS) expect(isGraphKind(kind)).toBe(true)
    expect(isGraphKind('goal')).toBe(false)
    expect(isGraphKind('flashcard')).toBe(false)
    expect(isGraphKind('')).toBe(false)
    expect(isGraphKind(null)).toBe(false)
  })
})
