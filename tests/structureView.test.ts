import { describe, expect, it } from 'vitest'
import { CARD_H, CARD_W, type StructureNode } from '../src/learn/structure'
import {
  EDGE_ANCHOR_Y,
  OUTLINE_HEAD,
  SLOT_ROW,
  cardHeight,
  edgeAt,
  edgeColorOf,
  edgeCurve,
  edgeDotAt,
  edgeDots,
  edgePathD,
  edgePointAt,
  hitTest,
  outlineSlots,
  resolveNodeView,
  slotColor,
  slotKeyOf,
  splitLeafRef,
} from '../src/components/learn/structure/structureView'
import { reconcileStructure, structureFromStore } from '../src/learn/structureSeed'
import { emptyLearnStore } from '../src/learn/store/empty'
import { emptyOutline, type KnowledgeNode, type LearnStore } from '../src/learn/types'

const NOW = 1700000000000

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

describe('结构画布：叶子的 ref 怎么切', () => {
  it('按第一个冒号切，名字里再冒号也不影响归属', () => {
    expect(splitLeafRef('n1:错题')).toEqual({ owner: 'n1', name: '错题' })
    expect(splitLeafRef('n1:第三章:错题')).toEqual({ owner: 'n1', name: '第三章:错题' })
  })

  it('缺一半的 ref 认不出来（宁可不显示，不要显示错的归属）', () => {
    expect(splitLeafRef('n1')).toBeNull()
    expect(splitLeafRef(':错题')).toBeNull()
    expect(splitLeafRef('n1:')).toBeNull()
    expect(splitLeafRef('')).toBeNull()
  })
})

describe('结构画布：节点显示什么', () => {
  const root = makeNode({
    id: 'n1',
    title: '极限',
    docs: { teaching: '一二三四五' },
    notes: [{ name: '错题', content: '', createdAt: NOW, updatedAt: NOW }],
    outline: { intro: '', children: [{ key: 'a', title: 'A', summary: '' }, { key: 'b', title: 'B', summary: '' }], updatedAt: NOW },
  })
  const store = makeStore([root])

  it('大纲节点报子目标数，文档节点报正文长度（同一个节点，两副面孔）', () => {
    const outline = resolveNodeView(store, { id: 'o', kind: 'outline', ref: 'n1', x: 0, y: 0 })
    expect(outline.title).toBe('极限')
    expect(outline.subtitle).toBe('2 个目标项')
    const doc = resolveNodeView(store, { id: 'd', kind: 'doc', ref: 'n1', x: 0, y: 0 })
    expect(doc.subtitle).toBe('5 字')
  })

  it('笔记节点报名字与归属', () => {
    const view = resolveNodeView(store, { id: 'x', kind: 'note', ref: 'n1:错题', x: 0, y: 0 })
    expect(view.title).toBe('错题')
    expect(view.subtitle).toBe('属于「极限」')
    expect(view.missing).toBe(false)
  })

  it('ref 指向已经不存在的东西：标出来，不假装正常', () => {
    expect(resolveNodeView(store, { id: 'x', kind: 'note', ref: 'n1:没了', x: 0, y: 0 }).missing).toBe(true)
    expect(resolveNodeView(store, { id: 'y', kind: 'doc', ref: 'ghost', x: 0, y: 0 }).missing).toBe(true)
  })

  it('空节点（没有 ref）显示成「空节点」，且不算坏数据', () => {
    const view = resolveNodeView(store, { id: 'z', kind: 'doc', x: 0, y: 0 })
    expect(view.title).toBe('空节点')
    expect(view.missing).toBe(false)
  })
})

describe('结构画布：命中测试', () => {
  const nodes: StructureNode[] = [
    { id: 'a', kind: 'outline', x: 0, y: 0 },
    { id: 'b', kind: 'doc', x: 300, y: 0 },
  ]

  it('落在卡片矩形内才算命中（按卡片尺寸，不是按坐标点）', () => {
    expect(hitTest(nodes, 10, 10)?.id).toBe('a')
    expect(hitTest(nodes, CARD_W - 1, CARD_H - 1)?.id).toBe('a')
    expect(hitTest(nodes, CARD_W + 1, 10)).toBeNull()
    expect(hitTest(nodes, 310, 10)?.id).toBe('b')
  })

  it('重叠时取后画的那个（与渲染顺序一致）', () => {
    const overlap: StructureNode[] = [
      { id: 'under', kind: 'outline', x: 0, y: 0 },
      { id: 'over', kind: 'doc', x: 10, y: 10 },
    ]
    expect(hitTest(overlap, 20, 20)?.id).toBe('over')
  })
})

describe('从 store 铺图', () => {
  it('大纲 + 文档 + 笔记各成一个节点，并按类型连好', () => {
    const root = makeNode({
      id: 'n1',
      title: '极限',
      docs: { teaching: '正文' },
      notes: [{ name: '错题', content: 'x', createdAt: NOW, updatedAt: NOW }],
    })
    const store = makeStore([root])
    const map = structureFromStore(store, 'g1')
    const kinds = Object.fromEntries(map.nodes.map((n) => [n.kind, n.ref]))
    expect(kinds).toMatchObject({ outline: 'n1', doc: 'n1', note: 'n1:错题' })
    expect(map.edges).toHaveLength(2)
    expect(map.edges).toContainEqual({ from: 'o:n1', to: 'd:n1' })
    expect(map.edges).toContainEqual({ from: 'd:n1', to: 'n:n1:错题' })
  })

  it('空目标铺出空图（不抛异常、不造幽灵节点）', () => {
    const store = makeStore([])
    expect(structureFromStore(store, 'g1')).toEqual({ version: 1, nodes: [], edges: [] })
  })

  it('别的目标的节点不进来', () => {
    const mine = makeNode({ id: 'n1', title: '极限' })
    const other = makeNode({ id: 'n9', title: '别的', goalId: 'g2' })
    const map = structureFromStore(makeStore([mine, other]), 'g1')
    expect(map.nodes.every((n) => n.ref === 'n1')).toBe(true)
  })
})

describe('结构画布：折线的拐点', () => {
  const nodes: StructureNode[] = [
    { id: 'a', kind: 'outline', x: 0, y: 0 },
    { id: 'b', kind: 'doc', x: 300, y: 200 },
  ]

  it('上下错开时走成 Z：右出 → 竖直 → 右进', () => {
    const curve = edgeCurve(nodes[0], nodes[1])
    const midX = (CARD_W + 300) / 2
    expect(edgePathD(curve)).toBe(
      `M${CARD_W} ${EDGE_ANCHOR_Y} L${midX} ${EDGE_ANCHOR_Y} L${midX} ${200 + EDGE_ANCHOR_Y} L300 ${200 + EDGE_ANCHOR_Y}`,
    )
  })

  it('按累计长度取点：两颗小圆点都落在折线上，且一前一后', () => {
    const curve = edgeCurve(nodes[0], nodes[1])
    const a = edgePointAt(curve, 0.22)
    const b = edgePointAt(curve, 0.78)
    // 折线总长 = 横 46 + 竖 200 + 横 46，0.22 处已经拐进竖直段了——
    // 所以这里只验「在线上」和「前后关系」，不假设它停在哪一段
    expect(a.y).toBeGreaterThan(EDGE_ANCHOR_Y)
    expect(b.y).toBeGreaterThan(a.y)
    // 阈值用 8：edgeAt 是按 24 等分采样的，总长约 292，采样间隔就有 12
    const edges = [{ from: 'a', to: 'b' }]
    expect(edgeAt(nodes, edges, a.x, a.y, 8)).toEqual({ from: 'a', to: 'b' })
    expect(edgeAt(nodes, edges, b.x, b.y, 8)).toEqual({ from: 'a', to: 'b' })
  })

  it('往回连（目标在左边）时先向右绕出去，不穿过卡片', () => {
    const back = edgeCurve(nodes[1], nodes[0])
    const d = edgePathD(back)
    expect(d).toContain(`L${300 + CARD_W + 40} `)
  })
})

describe('结构画布：连线的点选', () => {
  const nodes: StructureNode[] = [
    { id: 'a', kind: 'outline', x: 0, y: 0 },
    { id: 'b', kind: 'doc', x: 300, y: 0 },
  ]
  const edges = [{ from: 'a', to: 'b' }]

  it('点在线上算命中，离得远就不算', () => {
    // 两张卡同一行：连线退化成一条 y = EDGE_ANCHOR_Y 的水平线
    expect(edgeAt(nodes, edges, 200, EDGE_ANCHOR_Y)).toEqual({ from: 'a', to: 'b' })
    expect(edgeAt(nodes, edges, 200, EDGE_ANCHOR_Y + 40)).toBeNull()
  })

  it('端点附近也算（从卡片边缘往外一点就开始算线）', () => {
    expect(edgeAt(nodes, edges, CARD_W + 2, EDGE_ANCHOR_Y)).toEqual({ from: 'a', to: 'b' })
  })

  it('两端节点不在表里的边直接跳过（不炸）', () => {
    expect(edgeAt(nodes, [{ from: 'a', to: 'ghost' }], 200, EDGE_ANCHOR_Y)).toBeNull()
  })

  it('画线与点选用同一组控制点（不会出现看得到点不到）', () => {
    const curve = edgeCurve(nodes[0], nodes[1])
    // 锚点是「离卡片顶部固定距离」，不随卡片高度居中
    expect(curve[0]).toEqual({ x: CARD_W, y: EDGE_ANCHOR_Y })
    expect(curve[3]).toEqual({ x: 300, y: EDGE_ANCHOR_Y })
    // 默认折线：同一行时竖直段为 0，退化成一条横线
    expect(edgePathD(curve)).toBe(`M${CARD_W} ${EDGE_ANCHOR_Y} L300 ${EDGE_ANCHOR_Y}`)
    // 曲线用同一组控制点（两卡只隔 92px，bend 取了下限 48）
    expect(edgePathD(curve, 'curved')).toBe(
      `M${CARD_W} ${EDGE_ANCHOR_Y} C${CARD_W + 48} ${EDGE_ANCHOR_Y}, ${300 - 48} ${EDGE_ANCHOR_Y}, 300 ${EDGE_ANCHOR_Y}`,
    )
  })
})

describe('结构画布：大纲的目标项（接入点）', () => {
  const parent = makeNode({
    id: 'p1',
    title: '极限',
    outline: {
      intro: '',
      children: [
        { key: 'a', title: '导数', summary: '' },
        { key: 'b', title: '中值定理', summary: '' },
      ],
      updatedAt: NOW,
    },
  })
  const store = makeStore([parent])

  const parentNode: StructureNode = { id: 'o:p1', kind: 'outline', ref: 'p1', x: 0, y: 0 }
  const childNode: StructureNode = { id: 'o:p2', kind: 'outline', ref: 'p2', slot: 'a', x: 400, y: 0 }
  const graph = [parentNode, childNode]

  it('每个目标项一行，颜色各不相同', () => {
    const slots = outlineSlots(store, parentNode, graph)
    expect(slots.map((s) => s.title)).toEqual(['导数', '中值定理'])
    expect(slots[0].color).not.toBe(slots[1].color)
    expect(slots[0].color).toBe(slotColor(0))
  })

  it('下游有子大纲占了这个接入点 → 亮起（childId 有值），其余是空的', () => {
    const slots = outlineSlots(store, parentNode, graph)
    expect(slots[0].childId).toBe('o:p2')
    expect(slots[1].childId).toBeNull()
  })

  it('没有显式 slot 的老数据：退回用节点的 key 对上号', () => {
    const legacy: StructureNode = { id: 'o:p2', kind: 'outline', ref: 'p2', x: 0, y: 0 }
    const store2 = makeStore([parent, makeNode({ id: 'p2', title: '导数', key: 'a' })])
    expect(slotKeyOf(store2, legacy)).toBe('a')
    expect(outlineSlots(store2, parentNode, [parentNode, legacy])[0].childId).toBe('o:p2')
  })

  it('大纲卡片按目标项条数长高（否则点不到后面的目标项）', () => {
    expect(cardHeight(store, parentNode)).toBe(OUTLINE_HEAD + 2 * SLOT_ROW + 8)
    // 其它类型恒为固定高度
    expect(cardHeight(store, { kind: 'doc', ref: 'p1' })).toBe(CARD_H)
    // 没有目标项的大纲也不缩到比默认更矮
    const bare = makeStore([makeNode({ id: 'p9', title: '空' })])
    expect(cardHeight(bare, { kind: 'outline', ref: 'p9' })).toBe(CARD_H)
  })

  it('大纲 → 子大纲 的连线取那个接入点的颜色；别的连线没有颜色', () => {
    expect(edgeColorOf(store, graph, { from: 'o:p1', to: 'o:p2' })).toBe(slotColor(0))
    const docNode: StructureNode = { id: 'd:p1', kind: 'doc', ref: 'p1', x: 400, y: 200 }
    expect(edgeColorOf(store, [parentNode, docNode], { from: 'o:p1', to: 'd:p1' })).toBeNull()
  })
})

describe('结构画布：连线两端的小圆点', () => {
  const nodes: StructureNode[] = [
    { id: 'a', kind: 'outline', x: 0, y: 0 },
    { id: 'b', kind: 'doc', x: 300, y: 0 },
  ]
  const edges = [{ from: 'a', to: 'b' }]

  it('两颗点分别靠近两端，且落在线上', () => {
    const dots = edgeDots(nodes[0], nodes[1])
    expect(dots.from.x).toBeGreaterThan(CARD_W)
    expect(dots.from.x).toBeLessThan(dots.to.x)
    expect(dots.to.x).toBeLessThan(300)
    expect(edgeAt(nodes, edges, dots.from.x, dots.from.y, 2)).toEqual({ from: 'a', to: 'b' })
  })

  it('点中圆点报出是哪一端（点它跳到另一端）', () => {
    const dots = edgeDots(nodes[0], nodes[1])
    expect(edgeDotAt(nodes, edges, dots.from.x, dots.from.y)).toEqual({ edge: edges[0], side: 'from' })
    expect(edgeDotAt(nodes, edges, dots.to.x, dots.to.y)).toEqual({ edge: edges[0], side: 'to' })
    expect(edgeDotAt(nodes, edges, 150, 400)).toBeNull()
  })
})

describe('结构画布：对账（实体长了，图跟着补）', () => {
  const owner = makeNode({
    id: 'n1',
    title: '极限',
    docs: { teaching: '正文' },
    notes: [{ name: '错题', content: 'x', createdAt: NOW, updatedAt: NOW }],
  })
  const store = makeStore([owner])

  it('agent 写出的教学文档会补出文档节点，并连到大纲', () => {
    // 图上只有大纲节点（就像「文档刚生成完」的那一刻）
    const map = { version: 1 as const, nodes: [{ id: 'o:n1', kind: 'outline' as const, ref: 'n1', x: 0, y: 0 }], edges: [] }
    const next = reconcileStructure(store, 'g1', map)
    expect(next).not.toBe(map)
    expect(next.nodes.some((n) => n.id === 'd:n1')).toBe(true)
    expect(next.edges).toContainEqual({ from: 'o:n1', to: 'd:n1' })
  })

  it('已有的节点不会重复补（返回同一个对象，调用方据此不写回）', () => {
    const map = structureFromStore(store, 'g1')
    expect(reconcileStructure(store, 'g1', map)).toBe(map)
  })

  it('笔记实体补成叶子节点，挂在文档下面', () => {
    const map = { version: 1 as const, nodes: [{ id: 'o:n1', kind: 'outline' as const, ref: 'n1', x: 0, y: 0 }], edges: [] }
    const next = reconcileStructure(store, 'g1', map)
    expect(next.nodes.some((n) => n.id === 'n:n1:错题')).toBe(true)
    expect(next.edges).toContainEqual({ from: 'd:n1', to: 'n:n1:错题' })
  })

  it('被用户主动移除的（hidden）不再补回来', () => {
    const map = {
      version: 1 as const,
      nodes: [{ id: 'o:n1', kind: 'outline' as const, ref: 'n1', x: 0, y: 0 }],
      edges: [],
      hidden: ['d:n1'],
    }
    const next = reconcileStructure(store, 'g1', map)
    expect(next.nodes.some((n) => n.id === 'd:n1')).toBe(false)
    // 文档没补，叶子也就无处可挂
    expect(next.nodes.some((n) => n.id === 'n:n1:错题')).toBe(false)
  })

  it('别的目标不掺和', () => {
    const other = makeNode({ id: 'n9', title: '别的', goalId: 'g2', docs: { teaching: '正文' } })
    const map = { version: 1 as const, nodes: [], edges: [] }
    const next = reconcileStructure(makeStore([owner, other]), 'g1', map)
    expect(next.nodes.some((n) => n.ref === 'n9')).toBe(false)
  })
})
