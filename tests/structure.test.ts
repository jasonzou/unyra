import { describe, expect, it } from 'vitest'
import {
  CARD_H,
  CARD_W,
  COL_GAP,
  GRAPH_KINDS,
  ROW_GAP,
  STRUCT_MAX_ZOOM,
  STRUCT_MIN_ZOOM_FLOOR,
  boundsOf,
  canAddEdge,
  canConnect,
  clampZoom,
  emptyStructure,
  fitZoom,
  kindOf,
  minZoomOf,
  normalizeStructure,
  seedLayout,
  wouldCycle,
  type StructureNode,
} from '../src/learn/structure'

function node(id: string, kind: StructureNode['kind'], x = 0, y = 0, ref?: string): StructureNode {
  return { id, kind, x, y, ...(ref ? { ref } : {}) }
}

describe('结构图：连线规则', () => {
  it('大纲能连大纲与文档，文档只能连笔记/试卷/超级文档', () => {
    expect(canConnect('outline', 'outline')).toBe(true)
    expect(canConnect('outline', 'doc')).toBe(true)
    expect(canConnect('doc', 'note')).toBe(true)
    expect(canConnect('doc', 'exam')).toBe(true)
    expect(canConnect('doc', 'superdoc')).toBe(true)
    // 需求里点名的那条：下游不能回流
    expect(canConnect('doc', 'outline')).toBe(false)
    expect(canConnect('note', 'outline')).toBe(false)
    expect(canConnect('note', 'doc')).toBe(false)
    expect(canConnect('exam', 'superdoc')).toBe(false)
  })

  it('叶子类型不允许有下游', () => {
    for (const kind of GRAPH_KINDS) {
      const downstream = GRAPH_KINDS.filter((to) => canConnect(kind, to))
      if (kind === 'note' || kind === 'exam' || kind === 'superdoc') expect(downstream).toEqual([])
    }
  })

  it('自连、重复边、跨类型边都加不进去', () => {
    const nodes = [node('o1', 'outline'), node('d1', 'doc'), node('n1', 'note')]
    expect(canAddEdge(nodes, [], 'o1', 'o1')).toBe(false)
    expect(canAddEdge(nodes, [{ from: 'o1', to: 'd1' }], 'o1', 'd1')).toBe(false)
    expect(canAddEdge(nodes, [], 'd1', 'o1')).toBe(false)
    expect(canAddEdge(nodes, [], 'n1', 'o1')).toBe(false)
    expect(canAddEdge(nodes, [], 'o1', 'd1')).toBe(true)
  })

  it('大纲之间会成环的组合被拦下（其余类型的层级递增，天然无环）', () => {
    const edges = [{ from: 'o1', to: 'o2' }]
    expect(wouldCycle(edges, 'o2', 'o1')).toBe(true)
    expect(wouldCycle(edges, 'o1', 'o3')).toBe(false)
    const nodes = [node('o1', 'outline'), node('o2', 'outline'), node('o3', 'outline')]
    expect(canAddEdge(nodes, edges, 'o2', 'o1')).toBe(false)
    expect(canAddEdge(nodes, edges, 'o2', 'o3')).toBe(true)
  })
})

describe('结构图：包围盒与缩放', () => {
  it('包围盒按卡片尺寸算，不是按坐标点算', () => {
    const box = boundsOf([node('a', 'outline', 100, 50), node('b', 'doc', 400, 200)])
    expect(box).toEqual({ x: 100, y: 50, width: 300 + CARD_W, height: 150 + CARD_H })
  })

  it('空图没有包围盒（调用方据此不缩放）', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('缩放下限由内容包围盒算出：内容越散，下限越小', () => {
    const view = { width: 1000, height: 700 }
    const tight = boundsOf([node('a', 'outline', 0, 0), node('b', 'doc', 100, 0)])
    const wide = boundsOf([node('a', 'outline', 0, 0), node('b', 'doc', 5000, 0)])
    const zTight = minZoomOf(tight, view)
    const zWide = minZoomOf(wide, view)
    expect(zTight).toBeGreaterThan(zWide)
    // 刚好装下：宽高都不溢出视口
    expect(tight!.width * zTight).toBeLessThanOrEqual(view.width)
    expect(wide!.width * zWide).toBeLessThanOrEqual(view.width)
  })

  it('上限固定、下限有绝对兜底', () => {
    const view = { width: 1000, height: 700 }
    const tiny = boundsOf([node('a', 'outline', 0, 0)])
    // 一个节点也顶到固定上限就停
    expect(fitZoom(tiny!, view)).toBeLessThanOrEqual(STRUCT_MAX_ZOOM)
    // 节点拖到天边：下限不会掉到 0（否则能缩到什么都看不见）
    const far = boundsOf([node('a', 'outline', 0, 0), node('b', 'doc', 1_000_000, 0)])
    expect(fitZoom(far!, view)).toBeGreaterThanOrEqual(STRUCT_MIN_ZOOM_FLOOR)
  })

  it('缩放只被收进区间，不会被自动改掉', () => {
    const view = { width: 1000, height: 700 }
    const box = boundsOf([node('a', 'outline', 0, 0), node('b', 'doc', 3000, 0)])
    const min = minZoomOf(box, view)
    // 用户手放到比下限还小 → 收回到下限
    expect(clampZoom(min / 2, box, view)).toBeCloseTo(min, 6)
    // 用户手放到比上限还大 → 收回到上限
    expect(clampZoom(99, box, view)).toBe(STRUCT_MAX_ZOOM)
    // 区间内原样返回：这里没有任何「根据包围盒重算当前值」的逻辑
    const mid = (min + STRUCT_MAX_ZOOM) / 2
    expect(clampZoom(mid, box, view)).toBe(mid)
  })
})

describe('结构图：初始铺排', () => {
  const seed = {
    nodes: [
      { id: 'o1', kind: 'outline' as const },
      { id: 'o2', kind: 'outline' as const },
      { id: 'd1', kind: 'doc' as const },
      { id: 'n1', kind: 'note' as const },
      { id: 'n2', kind: 'note' as const },
    ],
    edges: [
      { from: 'o1', to: 'o2' },
      { from: 'o1', to: 'd1' },
      { from: 'd1', to: 'n1' },
      { from: 'd1', to: 'n2' },
    ],
  }

  it('列 = 层级深度，行 = 同列顺序', () => {
    const map = seedLayout(seed)
    const at = (id: string) => map.nodes.find((n) => n.id === id)!
    expect(at('o1').x).toBe(0)
    expect(at('o2').x).toBe(COL_GAP)
    expect(at('d1').x).toBe(COL_GAP)
    expect(at('n1').x).toBe(COL_GAP * 2)
    // 同一列不重叠
    // 两张卡之间隔一个 ROW_GAP 的空（行距 = 卡片高度 + 空隙，高度是算出来的）
    expect(Math.abs(at('o2').y - at('d1').y)).toBe(CARD_H + ROW_GAP)
    expect(Math.abs(at('n1').y - at('n2').y)).toBe(CARD_H + ROW_GAP)
  })

  it('指向不存在节点的边被丢掉（旧数据里依赖指向已删节点很常见）', () => {
    const map = seedLayout({ ...seed, edges: [...seed.edges, { from: 'o1', to: 'ghost' }] })
    expect(map.edges.some((e) => e.to === 'ghost')).toBe(false)
    expect(map.nodes.some((n) => n.id === 'ghost')).toBe(false)
  })

  it('同一列里大纲排在文档前面（读图方向：先大纲、后文档）', () => {
    const map = seedLayout({
      nodes: [
        { id: 'o1', kind: 'outline' },
        { id: 'd1', kind: 'doc' },
        { id: 'o2', kind: 'outline' },
      ],
      edges: [
        { from: 'o1', to: 'o2' },
        { from: 'o1', to: 'd1' },
      ],
    })
    const at = (id: string) => map.nodes.find((n) => n.id === id)!
    expect(at('o2').x).toBe(at('d1').x)
    expect(at('o2').y).toBeLessThan(at('d1').y)
  })

  it('高的卡片不会压住下一张（按实际高度往下排）', () => {
    // 大纲卡片里有 8 个目标项时能长到 240 上下，按固定行距排必然叠住
    const tall = (n: { kind: string }) => (n.kind === 'outline' ? 240 : CARD_H)
    const map = seedLayout(
      {
        nodes: [
          { id: 'o1', kind: 'outline' },
          { id: 'o2', kind: 'outline' },
          { id: 'd1', kind: 'doc' },
        ],
        edges: [
          { from: 'o1', to: 'o2' },
          { from: 'o1', to: 'd1' },
        ],
      },
      tall,
    )
    const at = (id: string) => map.nodes.find((n) => n.id === id)!
    // o2 与 d1 同列，o2 在上：d1 的顶必须落在 o2 的底之下（含空隙）
    expect(at('d1').x).toBe(at('o2').x)
    expect(at('d1').y).toBeGreaterThanOrEqual(at('o2').y + 240)
  })

  it('每个节点都拿到坐标，一个不落', () => {
    const map = seedLayout(seed)
    expect(map.nodes).toHaveLength(seed.nodes.length)
    for (const n of map.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
  })
})

describe('结构图：读盘校验', () => {
  it('坏坐标、坏类型、重复 id 一律丢掉，宁少不留', () => {
    const map = normalizeStructure({
      version: 1,
      nodes: [
        { id: 'a', kind: 'outline', x: 0, y: 0 },
        { id: 'a', kind: 'doc', x: 10, y: 10 },
        { id: 'b', kind: 'nope', x: 0, y: 0 },
        { id: 'c', kind: 'doc', x: 'NaN', y: 0 },
        { id: 'd', kind: 'doc', x: 5, y: 5 },
      ],
      edges: [{ from: 'a', to: 'd' }],
    })
    expect(map.nodes.map((n) => n.id)).toEqual(['a', 'd'])
    expect(map.edges).toEqual([{ from: 'a', to: 'd' }])
  })

  it('违规边在读盘时就被丢掉（类型规则改了之后老数据不该诈尸）', () => {
    const map = normalizeStructure({
      version: 1,
      nodes: [
        { id: 'o', kind: 'outline', x: 0, y: 0 },
        { id: 'd', kind: 'doc', x: 0, y: 100 },
      ],
      edges: [
        { from: 'd', to: 'o' },
        { from: 'o', to: 'd' },
      ],
    })
    expect(map.edges).toEqual([{ from: 'o', to: 'd' }])
  })

  it('空值与非对象输入给一张空图，不抛异常', () => {
    expect(normalizeStructure(null)).toEqual(emptyStructure())
    expect(normalizeStructure('x')).toEqual(emptyStructure())
    expect(normalizeStructure({ nodes: 'oops', edges: 3 })).toEqual(emptyStructure())
  })

  it('kindOf 只认表里的节点', () => {
    expect(kindOf([node('a', 'outline')], 'a')).toBe('outline')
    expect(kindOf([node('a', 'outline')], 'b')).toBeNull()
  })
})
