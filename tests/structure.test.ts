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
  freeSpotNear,
  kindOf,
  minZoomOf,
  normalizeStructure,
  normalizeStructureBook,
  removeNodeFromMap,
  renameLeafInMap,
  seedLayout,
  slotOrderOf,
  wouldCycle,
  type StructureNode,
} from '../src/learn/structure'

function node(id: string, kind: StructureNode['kind'], x = 0, y = 0, ref?: string): StructureNode {
  return { id, kind, x, y, ...(ref ? { ref } : {}) }
}

describe('结构图：连线规则', () => {
  it('大纲只连文档；文档可以连大纲（父或子）与叶子', () => {
    // 2026-10-21 第二次重构：大纲的父子节点只能是文档
    expect(canConnect('outline', 'doc')).toBe(true)
    expect(canConnect('doc', 'outline')).toBe(true)
    expect(canConnect('outline', 'outline')).toBe(false)
    // 叶子仍然只挂在文档下面
    expect(canConnect('doc', 'note')).toBe(true)
    expect(canConnect('doc', 'exam')).toBe(true)
    expect(canConnect('doc', 'superdoc')).toBe(true)
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

  it('入口只连文档，且子级有且只有一个（权威根唯一）', () => {
    expect(canConnect('entry', 'doc')).toBe(true)
    expect(canConnect('entry', 'outline')).toBe(false)
    expect(canConnect('doc', 'entry')).toBe(false)
    const nodes = [node('e1', 'entry'), node('d1', 'doc'), node('d2', 'doc')]
    expect(canAddEdge(nodes, [], 'e1', 'd1')).toBe(true)
    // 已经有一个子级了：第二份文档接不上
    expect(canAddEdge(nodes, [{ from: 'e1', to: 'd1' }], 'e1', 'd2')).toBe(false)
    // 换个父照样能连：限制只针对入口的出线
    expect(canAddEdge(nodes, [{ from: 'e1', to: 'd1' }], 'd1', 'd2')).toBe(false) // doc→doc 本就不允许
  })

  it('自连、重复边、跨类型边都加不进去', () => {
    const nodes = [node('o1', 'outline'), node('o2', 'outline'), node('d1', 'doc'), node('n1', 'note')]
    expect(canAddEdge(nodes, [], 'o1', 'o1')).toBe(false)
    expect(canAddEdge(nodes, [{ from: 'o1', to: 'd1' }], 'o1', 'd1')).toBe(false)
    // 大纲 → 大纲 已经不允许了
    expect(canAddEdge(nodes, [], 'o1', 'o2')).toBe(false)
    // 大纲 ↔ 文档 两个方向都行
    expect(canAddEdge(nodes, [], 'o1', 'd1')).toBe(true)
    expect(canAddEdge(nodes, [], 'd1', 'o1')).toBe(true)
    // 叶子不能有下游
    expect(canAddEdge(nodes, [], 'n1', 'o1')).toBe(false)
  })

  it('环检测对每一类边都做（文档 ↔ 大纲 可以来回，所以必须查）', () => {
    // d1 → o1 → d2 → o2，再连 o2 → d1 就成环
    const edges = [
      { from: 'd1', to: 'o1' },
      { from: 'o1', to: 'd2' },
      { from: 'd2', to: 'o2' },
    ]
    const nodes = [node('o1', 'outline'), node('o2', 'outline'), node('d1', 'doc'), node('d2', 'doc')]
    expect(wouldCycle(edges, 'o2', 'd1')).toBe(true)
    expect(canAddEdge(nodes, edges, 'o2', 'd1')).toBe(false)
    expect(wouldCycle(edges, 'o2', 'd1')).toBe(true)
  })
})

describe('结构图：包围盒与缩放', () => {
  it('包围盒按卡片尺寸算，不是按坐标点算', () => {
    const box = boundsOf([node('a', 'outline', 100, 50), node('b', 'doc', 400, 200)])
    expect(box).toEqual({ x: 100, y: 50, width: 300 + CARD_W, height: 150 + CARD_H })
  })

  it('freeSpotNear：锚点空就原样返回，被占就往下找第一块空位', () => {
    // 占着 (400, 0) 的一张卡
    const nodes = [node('a', 'doc', 400, 0)]
    const size = { width: CARD_W, height: CARD_H }
    // 锚点正好撞上：往下挪到第一块空地
    const spot = freeSpotNear(nodes, { x: 400, y: 0 }, size)
    expect(spot.y).toBeGreaterThanOrEqual(CARD_H)
    // 锚点本来就空：原样返回
    expect(freeSpotNear(nodes, { x: 900, y: 0 }, size)).toEqual({ x: 900, y: 0 })
    // 一整列都被占：返回的是有限位置（不发散、坐标有限）
    const column = Array.from({ length: 6 }, (_, i) => node(`c${i}`, 'doc', 400, i * (CARD_H + ROW_GAP)))
    const last = freeSpotNear(column, { x: 400, y: 0 }, size)
    expect(Number.isFinite(last.y)).toBe(true)
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

  it('同列的子大纲按父大纲目标项的顺序排（不是按 uuid）', () => {
    // 目标项顺序：a(0) → b(1) → c(2)，但节点在表里是乱序的
    const order = (n: { slot?: string }) => (n.slot === 'c' ? 2 : n.slot === 'b' ? 1 : 0)
    const map = seedLayout(
      {
        nodes: [
          { id: 'o1', kind: 'outline' },
          { id: 'c1', kind: 'outline', slot: 'c' },
          { id: 'b1', kind: 'outline', slot: 'b' },
        ],
        edges: [
          { from: 'o1', to: 'c1' },
          { from: 'o1', to: 'b1' },
        ],
      },
      undefined,
      order,
    )
    const at = (id: string) => map.nodes.find((n) => n.id === id)!
    expect(at('b1').x).toBe(at('c1').x)
    expect(at('b1').y).toBeLessThan(at('c1').y)
  })

  it('slotOrderOf：目标项 key → 它在父大纲里的下标', () => {
    const store = {
      nodes: [
        {
          goalId: 'g1',
          outline: {
            intro: '',
            updatedAt: 0,
            children: [
              { key: 'a', title: 'A', summary: '' },
              { key: 'b', title: 'B', summary: '' },
            ],
          },
        },
        { goalId: 'g2', outline: { intro: '', updatedAt: 0, children: [{ key: 'x', title: 'X', summary: '' }] } },
      ],
    } as unknown as Parameters<typeof slotOrderOf>[0]
    const order = slotOrderOf(store, 'g1')
    expect(order({ kind: 'outline', slot: 'b' })).toBe(1)
    expect(order({ kind: 'outline', slot: 'a' })).toBe(0)
    // 别的目标的目标项不算进来
    expect(order({ kind: 'outline', slot: 'x' })).toBe(0)
    // 没有 slot（根大纲）恒为 0
    expect(order({ kind: 'outline' })).toBe(0)
  })

  it('没记 slot 的老数据：退回按节点 key 对上目标项次序', () => {
    // 迁移铺出来的图就是这样：只有 ref，没有 slot
    const store = {
      nodes: [
        {
          id: 'p',
          goalId: 'g1',
          key: 'p',
          outline: {
            intro: '',
            updatedAt: 0,
            children: [
              { key: 'a', title: 'A', summary: '' },
              { key: 'b', title: 'B', summary: '' },
            ],
          },
        },
        { id: 'ca', goalId: 'g1', key: 'a' },
        { id: 'cb', goalId: 'g1', key: 'b' },
      ],
    } as unknown as Parameters<typeof slotOrderOf>[0]

    const order = slotOrderOf(store, 'g1')
    expect(order({ kind: 'outline', ref: 'ca' })).toBe(0)
    expect(order({ kind: 'outline', ref: 'cb' })).toBe(1)

    const map = seedLayout(
      {
        nodes: [
          { id: 'o:p', kind: 'outline', ref: 'p' },
          { id: 'o:cb', kind: 'outline', ref: 'cb' },
          { id: 'o:ca', kind: 'outline', ref: 'ca' },
        ],
        edges: [
          { from: 'o:p', to: 'o:cb' },
          { from: 'o:p', to: 'o:ca' },
        ],
      },
      undefined,
      order,
    )
    const at = (id: string) => map.nodes.find((n) => n.id === id)!
    // 目标项 A 在前 → 它的子大纲排在上面
    expect(at('o:ca').y).toBeLessThan(at('o:cb').y)
  })

  it('每个节点都拿到坐标，一个不落', () => {
    const map = seedLayout(seed)
    expect(map.nodes).toHaveLength(seed.nodes.length)
    for (const n of map.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
  })

  it('带环的坏数据不能把深度传播变成死循环（守卫后正常返回）', () => {
    // 正常入口（canAddEdge 的环检测 + 读盘校验）进不来环，但自动排列吃的是画布现数据——
    // 坏数据一旦带环，没有上限守卫这里会无限入队、界面卡死
    const map = seedLayout({
      nodes: [
        { id: 'root', kind: 'doc' },
        { id: 'a', kind: 'outline' },
        { id: 'b', kind: 'doc' },
      ],
      edges: [
        { from: 'root', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    })
    expect(map.nodes).toHaveLength(3)
    expect(map.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true)
    // 环上的两个节点都拿到了列坐标，没有丢
    expect(map.nodes.find((n) => n.id === 'a')).toBeTruthy()
    expect(map.nodes.find((n) => n.id === 'b')).toBeTruthy()
  })
})

describe('结构图：图的编辑操作（组件三条删除路径与改名共用的规则）', () => {
  const base = {
    version: 1 as const,
    nodes: [
      node('d:n1', 'doc', 0, 0, 'n1'),
      node('o:n1', 'outline', 300, 0, 'n1'),
      node('n:n1:错题', 'note', 600, 0, 'n1:错题'),
    ],
    edges: [
      { from: 'd:n1', to: 'o:n1' },
      { from: 'd:n1', to: 'n:n1:错题' },
    ],
    hidden: ['e:gone'],
  }

  it('removeNodeFromMap：节点与相关边一起撤，墓碑去重追加，已有墓碑不动', () => {
    const next = removeNodeFromMap(base, 'd:n1')
    expect(next.nodes.map((n) => n.id)).toEqual(['o:n1', 'n:n1:错题'])
    expect(next.edges).toEqual([])
    expect(next.hidden).toEqual(['e:gone', 'd:n1'])
    // 删第二遍不产生重复墓碑
    expect(removeNodeFromMap(next, 'd:n1').hidden).toEqual(['e:gone', 'd:n1'])
    // 不存在的节点：原样返回（组件据此跳过写回，不留下一条空撤回）
    expect(removeNodeFromMap(base, 'ghost')).toBe(base)
  })

  it('renameLeafInMap：id 与 ref 一起换，边跟着改指向，无关字段原样保留', () => {
    const r = renameLeafInMap(base, base.nodes[2], '复盘')
    expect(r).not.toBeNull()
    expect(r!.leaf).toEqual({ owner: 'n1', name: '错题' })
    const next = r!.map
    expect(next.nodes.find((n) => n.id === 'n:n1:复盘')).toMatchObject({ kind: 'note', ref: 'n1:复盘' })
    expect(next.nodes.find((n) => n.id === 'n:n1:错题')).toBeUndefined()
    expect(next.edges).toContainEqual({ from: 'd:n1', to: 'n:n1:复盘' })
    expect(next.edges).not.toContainEqual({ from: 'd:n1', to: 'n:n1:错题' })
    expect(next.hidden).toEqual(['e:gone'])
  })

  it('renameLeafInMap：超级文档用 s: 前缀；id 拼法不符的老数据保持原 id', () => {
    const sdoc = { version: 1 as const, nodes: [node('s:n1:讲义', 'superdoc', 0, 0, 'n1:讲义')], edges: [] }
    const r = renameLeafInMap(sdoc, sdoc.nodes[0], '新讲义')
    expect(r!.map.nodes[0]).toMatchObject({ id: 's:n1:新讲义', ref: 'n1:新讲义' })
    // 老数据：id 不是 n:{owner}:{名字} / s:{owner}:{名字} 的拼法 → 只换 ref，id 不动
    const legacy = { version: 1 as const, nodes: [node('uuid-1', 'note', 0, 0, 'n1:错题')], edges: [] }
    const r2 = renameLeafInMap(legacy, legacy.nodes[0], '复盘')
    expect(r2!.map.nodes[0]).toMatchObject({ id: 'uuid-1', ref: 'n1:复盘' })
  })

  it('renameLeafInMap：不是叶子 / 没 ref / 名字没变（含空白）都算无事可做', () => {
    const doc = { version: 1 as const, nodes: [node('d:n1', 'doc', 0, 0, 'n1')], edges: [] }
    expect(renameLeafInMap(doc, doc.nodes[0], '新名字')).toBeNull()
    const free = { version: 1 as const, nodes: [node('uuid-2', 'note')], edges: [] }
    expect(renameLeafInMap(free, free.nodes[0], '新名字')).toBeNull()
    expect(renameLeafInMap(base, base.nodes[2], ' 错题 ')).toBeNull()
    expect(renameLeafInMap(base, base.nodes[2], '')).toBeNull()
  })
})

describe('结构图：读盘校验', () => {
  it('坏坐标、坏类型、重复 id 一律丢掉，宁少不留', () => {
    const map = normalizeStructure({
      version: 1,
      nodes: [
        { id: 'a', kind: 'outline', x: 0, y: 0, ref: 'n1' },
        { id: 'a', kind: 'doc', x: 10, y: 10, ref: 'n2' },
        { id: 'b', kind: 'nope', x: 0, y: 0 },
        { id: 'c', kind: 'doc', x: 'NaN', y: 0, ref: 'n3' },
        { id: 'd', kind: 'doc', x: 5, y: 5, ref: 'n4' },
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
        { id: 'o1', kind: 'outline', x: 0, y: 0, ref: 'n1' },
        { id: 'o2', kind: 'outline', x: 0, y: 100, ref: 'n2' },
        { id: 'd', kind: 'doc', x: 0, y: 200, ref: 'n3' },
      ],
      edges: [
        // 大纲 → 大纲：旧规则下合法，新规则下不合法，读盘时丢掉
        { from: 'o1', to: 'o2' },
        { from: 'o1', to: 'd' },
      ],
    })
    expect(map.edges).toEqual([{ from: 'o1', to: 'd' }])
  })

  it('空值与非对象输入给一张空图，不抛异常', () => {
    expect(normalizeStructure(null)).toEqual(emptyStructure())
    expect(normalizeStructure('x')).toEqual(emptyStructure())
    expect(normalizeStructure({ nodes: 'oops', edges: 3 })).toEqual(emptyStructure())
  })

  it('hidden 逐条校验：字符串留下，别的一律丢掉', () => {
    const map = normalizeStructure({ version: 1, nodes: [], edges: [], hidden: ['d:n1', 42, null, '', 'o:n2'] })
    expect(map.hidden).toEqual(['d:n1', 'o:n2'])
    // 没有 hidden 就不带这个字段
    expect(normalizeStructure({ version: 1, nodes: [], edges: [] }).hidden).toBeUndefined()
  })

  it('画布删空但墓碑还在的账本要留下（删空 ≠ 没铺过，否则重启全体复活）', () => {
    const out = normalizeStructureBook(
      { g1: { version: 1, nodes: [], edges: [], hidden: ['d:n1'] }, g2: { version: 1, nodes: [], edges: [] } },
      new Set(['g1', 'g2']),
    )
    expect(out.g1?.hidden).toEqual(['d:n1'])
    // 真的什么都没有的仍然不留
    expect(out.g2).toBeUndefined()
  })

  it('kindOf 只认表里的节点', () => {
    expect(kindOf([node('a', 'outline')], 'a')).toBe('outline')
    expect(kindOf([node('a', 'outline')], 'b')).toBeNull()
  })
})
