import { describe, expect, it } from 'vitest'
import { buildDocs, parseDocs } from '../src/learn/files'
import { emptyLearnStore } from '../src/learn/store/empty'
import { structureViewOf, structureFromStore } from '../src/learn/structureSeed'
import {
  docGid,
  examGid,
  noteGid,
  outlineGid,
  type StructureMap,
} from '../src/learn/structure'
import { emptyOutline, type KnowledgeNode, type LearnStore } from '../src/learn/types'
import { updateNode } from '../src/learn/graph'

const NOW = 1700000000000

/**
 * 这一组测的是**「用户在画布上看到的东西」**，不是某个函数怎么实现。
 *
 * 为什么单独拉一份：`structure.json` 现在是「节点 + 坐标 + 连线」的独立快照，
 * 靠 `structureViewOf` 跟实体对账；下一步要把它改成「节点与边从 store 派生、只留坐标」。
 * 那次改动会换掉实现，但下面这些行为一条都不能变：
 *
 * 1. 存盘再读回，图**逐项一样**（坐标按节点 id 存，不按路径）；
 * 2. 一个节点该出几张卡、谁连谁，是内容决定的；
 * 3. agent 新写的东西要自己冒出来，用户删掉的不能自己回来；
 * 4. 改名 / 移动之后，坐标还在原地。
 *
 * 断言只写「有哪几张卡、哪几条边」，不写内部 id 之外的结构——这样换实现时用例不用重写。
 */

function makeNode(partial: Partial<KnowledgeNode> & { id: string; title: string }): KnowledgeNode {
  return {
    key: partial.title,
    description: '',
    docs: { teaching: '' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId: 'g1',
    outline: { ...emptyOutline(), updatedAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  }
}

function makeStore(nodes: KnowledgeNode[], extra: Partial<LearnStore> = {}): LearnStore {
  const base = emptyLearnStore()
  return {
    ...base,
    nodes,
    goals: [{ id: 'g1', rootNodeId: nodes[0]?.id ?? 'n1', question: 'q', createdAt: NOW, updatedAt: NOW }],
    edges: [],
    exams: [],
    ...extra,
  }
}

/** 一张图里「有哪些卡」：按类型数一遍，比逐个 id 更能表达"用户看到什么" */
function cardKinds(map: StructureMap): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of map.nodes) out[n.kind] = (out[n.kind] ?? 0) + 1
  return out
}

/** 一张图里「谁连谁」：用 kind 表示端点，避开内部 id */
function edgeShape(map: StructureMap): string[] {
  const kindOf = new Map(map.nodes.map((n) => [n.id, n.kind]))
  return map.edges
    .map((e) => `${kindOf.get(e.from) ?? '?'} → ${kindOf.get(e.to) ?? '?'}`)
    .sort()
}

/** 一棵最小的目标：根（有正文 + 大纲 + 笔记）→ 子节点（有正文） */
function baseStore(): LearnStore {
  const root = makeNode({
    id: 'n1',
    title: '高数',
    docs: { teaching: '# 高数' },
    outline: {
      intro: '路线',
      children: [{ key: '导数', title: '导数', summary: '' }],
      updatedAt: NOW,
    },
    notes: [{ name: '错题', content: '错题正文', createdAt: NOW, updatedAt: NOW }],
  })
  const child = makeNode({ id: 'n2', title: '导数', docs: { teaching: '导数正文' } })
  return makeStore([root, child], { edges: [{ from: 'n1', to: 'n2', createdAt: NOW }] })
}

describe('结构画布：落盘往返', () => {
  it('存盘再读回，节点 / 边 / 坐标 / 画法逐项一样', () => {
    const store = baseStore()
    const map = structureFromStore(store, 'g1')
    // 手动挪一张卡、换一种画法、记一条注释——这些都必须活过一次存盘
    const moved = {
      ...map,
      edgeStyle: 'curved' as const,
      nodes: map.nodes.map((n, i) => (i === 0 ? { ...n, x: 500, y: 300, note: '便签' } : n)),
    }
    const withMap: LearnStore = { ...store, structure: { g1: moved } }

    const back = parseDocs(buildDocs(withMap), {})
    expect(back).not.toBeNull()
    const reloaded = back!.structure?.g1
    expect(reloaded).toBeTruthy()
    expect(reloaded!.nodes).toEqual(moved.nodes)
    expect(reloaded!.edges).toEqual(moved.edges)
    expect(reloaded!.edgeStyle).toBe('curved')
  })

  it('坐标按节点 id 记：改名之后卡还在原地', () => {
    const store = baseStore()
    const map = structureFromStore(store, 'g1')
    const at = { ...map, nodes: map.nodes.map((n) => ({ ...n, x: 420, y: 240 })) }
    const before = { ...store, structure: { g1: at } }

    // 改名 = 换目录（磁盘上的落点变了），但节点 id 没变
    const renamed = updateNode(before, 'n2', { title: '导数与微分' })
    const reloaded = parseDocs(buildDocs(renamed), {})!

    const card = reloaded.structure?.g1.nodes.find((n) => n.id === docGid('n2'))
    expect(card).toBeTruthy()
    expect({ x: card!.x, y: card!.y }).toEqual({ x: 420, y: 240 })
    // 目录确实换了，坐标没跟着走丢
    expect([...buildDocs(renamed).keys()].some((k) => k.includes('导数与微分'))).toBe(true)
  })
})

describe('结构画布：一张图该有什么', () => {
  it('根节点出「文档 + 大纲」两张，子节点只出文档；笔记挂文档下', () => {
    const map = structureFromStore(baseStore(), 'g1')
    expect(cardKinds(map)).toEqual({ doc: 2, outline: 1, note: 1 })
    expect(map.nodes.map((n) => n.id).sort()).toEqual(
      [docGid('n1'), docGid('n2'), outlineGid('n1'), noteGid('n1', '错题')].sort(),
    )
    // 先文档再大纲；大纲的接入点连到子文档；笔记挂在文档下
    expect(edgeShape(map)).toEqual(['doc → note', 'doc → outline', 'outline → doc'])
  })

  it('试卷 / 超级文档各出一张卡，都挂在文档下', () => {
    const store = baseStore()
    const withExtras: LearnStore = {
      ...store,
      nodes: store.nodes.map((n) =>
        n.id === 'n1'
          ? { ...n, superdocs: [{ name: '讲义', html: '<html>x</html>', createdAt: NOW, updatedAt: NOW }] }
          : n,
      ),
      exams: [
        {
          id: 'e1',
          nodeId: 'n1',
          goalId: 'g1',
          title: '小考',
          kind: 'quiz',
          level: 'easy',
          minutes: 0,
          questions: [
            { id: 'q1', type: 'single', stem: '1+1', options: [{ id: 'a', text: '2' }, { id: 'b', text: '3' }], answer: ['a'], points: 10 },
          ],
          createdAt: NOW,
          attempts: [],
        },
      ],
    }
    const map = structureFromStore(withExtras, 'g1')
    expect(cardKinds(map)).toEqual({ doc: 2, outline: 1, note: 1, superdoc: 1, exam: 1 })
    expect(map.nodes.some((n) => n.id === examGid('e1'))).toBe(true)
  })

  it('空目标不造幽灵节点', () => {
    const store = makeStore([makeNode({ id: 'n1', title: '空目标' })])
    const map = structureFromStore(store, 'g1')
    // 根节点无条件有「文档 + 大纲」两张卡（大纲是总目标的计划位，空着也在），没有别的
    expect(cardKinds(map)).toEqual({ doc: 1, outline: 1 })
  })
})

describe('结构画布：跟实体对账', () => {
  it('agent 新写一份笔记 → 笔记卡自己冒出来，边跟着补，已有卡片位置不动', () => {
    const store = baseStore()
    const map = structureFromStore(store, 'g1')
    const pinned = {
      ...map,
      nodes: map.nodes.map((n) => ({ ...n, x: 100, y: 200 })),
    }

    const grown: LearnStore = {
      ...store,
      nodes: store.nodes.map((n) =>
        n.id === 'n1'
          ? { ...n, notes: [...n.notes, { name: '复盘', content: '新写的', createdAt: NOW, updatedAt: NOW }] }
          : n,
      ),
    }
    const next = structureViewOf(grown, 'g1', pinned)
    expect(next).not.toBe(pinned)
    expect(next.nodes.some((n) => n.id === noteGid('n1', '复盘'))).toBe(true)
    expect(next.edges).toContainEqual({ from: docGid('n1'), to: noteGid('n1', '复盘') })
    // 老卡片的坐标一个都没动
    for (const n of pinned.nodes) {
      expect(next.nodes.find((x) => x.id === n.id)).toMatchObject({ x: n.x, y: n.y })
    }
  })

  it('没有变化时算出来的图与存的一模一样（不会漂，也不会自己触发自己）', () => {
    const store = baseStore()
    const map = structureFromStore(store, 'g1')
    const next = structureViewOf(store, 'g1', map)
    expect(next.nodes.map((n) => `${n.id}@${n.x},${n.y}`).sort()).toEqual(
      map.nodes.map((n) => `${n.id}@${n.x},${n.y}`).sort(),
    )
    expect(next.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(
      map.edges.map((e) => `${e.from}>${e.to}`).sort(),
    )
  })

  it('用户删掉的卡不会自己回来（hidden 记着它）', () => {
    const store = baseStore()
    const map = structureFromStore(store, 'g1')
    const gone = noteGid('n1', '错题')
    const hidden: StructureMap = {
      ...map,
      nodes: map.nodes.filter((n) => n.id !== gone),
      edges: map.edges.filter((e) => e.to !== gone),
      hidden: [gone],
    }
    const next = structureViewOf(store, 'g1', hidden)
    expect(next.nodes.some((n) => n.id === gone)).toBe(false)
  })

  it('删掉节点之后重新铺，那张卡和它的边都不在了', () => {
    const store = baseStore()
    const trimmed: LearnStore = {
      ...store,
      nodes: store.nodes.filter((n) => n.id !== 'n2'),
      edges: [],
    }
    const map = structureFromStore(trimmed, 'g1')
    expect(map.nodes.some((n) => n.id === docGid('n2'))).toBe(false)
    expect(map.edges.some((e) => e.to === docGid('n2'))).toBe(false)
  })
})
