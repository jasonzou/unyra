import { describe, expect, it } from 'vitest'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { LearnStore, NoteFile, SuperDocFile } from '../src/learn/types'
import type { Exam } from '../src/learn/exam'
import { entryUuid, outlineUuid } from '../src/learn/nodeKinds'
import { CARD_H, CARD_W, COL_GAP, emptyStructure, type StructureMap } from '../src/learn/structure'
import { deriveCanvas, edgeElbow, edgePathD } from '../src/components/learn/structure/structureView'

/* ---------- 夹具：一个目标（根 + 子文档 + 挂件） ---------- */

function makeStore(): LearnStore {
  const base = emptyLearnStore()
  const note: NoteFile = { id: 'note1', name: '错题本', content: '第一题', createdAt: 1, updatedAt: 1 }
  const sdoc: SuperDocFile = { id: 'sdoc1', name: '实验', html: '', createdAt: 1, updatedAt: 1 }
  const exam: Exam = {
    id: 'exam1', nodeId: 'a', goalId: 'g1', title: '小测', kind: 'quiz', level: 'easy', minutes: 0,
    questions: [], attempts: [], createdAt: 1,
  }
  return {
    ...base,
    goals: [{ id: 'g1', rootNodeId: 'r', question: '学微积分', createdAt: 1, updatedAt: 1 }],
    nodes: [
      {
        id: 'r',
        title: '微积分',
        key: 'weijifen',
        description: '',
        docs: { teaching: '# 微积分' },
        notes: [note],
        superdocs: [sdoc],
        outline: { intro: '', children: [{ key: 'jixian', title: '极限', summary: '' }], updatedAt: 1 },
        annotations: [],
        status: 'learning',
        origin: 'user',
        goalId: 'g1',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'a',
        title: '极限',
        key: 'jixian',
        description: '',
        docs: { teaching: '' },
        notes: [],
        annotations: [],
        status: 'learning',
        origin: 'user',
        goalId: 'g1',
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    edges: [{ from: 'r', to: 'a', createdAt: 1 }],
    exams: [exam],
  }
}

describe('deriveCanvas：卡片就是节点、连线全部派生', () => {
  it('每份实体一张卡：入口、文档、可见大纲、挂件；uuid 直接对上实体', () => {
    const view = deriveCanvas(makeStore(), 'g1', undefined)
    const kinds = Object.fromEntries(view.cards.map((c) => [c.uuid, c.kind]))
    expect(kinds[entryUuid('r')]).toBe('entry')
    expect(kinds['r']).toBe('doc')
    expect(kinds[outlineUuid('r')]).toBe('outline')
    // 子文档 a 没有目标项也没有子级：它的大纲卡不上画布（空壳没有意义）
    expect(kinds[outlineUuid('a')]).toBeUndefined()
    expect(kinds['note1']).toBe('note')
    expect(kinds['sdoc1']).toBe('superdoc')
    expect(kinds['exam1']).toBe('exam')
    // 入口 + 根 + 根的大纲 + 子文档 + 笔记 + 超级文档 + 试卷 = 7
    expect(view.cards).toHaveLength(7)
  })

  it('连线全派生：入口→根、大纲→子文档（树边）、文档→大纲与挂件（归属）', () => {
    const view = deriveCanvas(makeStore(), 'g1', undefined)
    const keys = view.edges.map((e) => `${e.from}>${e.to}`)
    expect(keys).toContain(`${entryUuid('r')}>r`)
    expect(keys).toContain(`${outlineUuid('r')}>a`)
    expect(keys).toContain(`r>${outlineUuid('r')}`)
    expect(keys).toContain('r>note1')
    expect(keys).toContain('r>sdoc1')
    expect(keys).toContain('a>exam1')
  })

  it('子文档的目标项点亮：childId 按 key 对上号', () => {
    const view = deriveCanvas(makeStore(), 'g1', undefined)
    const outline = view.cards.find((c) => c.uuid === outlineUuid('r'))!
    expect(outline.slots).toEqual([{ key: 'jixian', title: '极限', index: 0, childId: 'a' }])
  })

  it('空文档卡给「生成」按钮（blank），空试卷 / 空超级文档同款；有正文的给摘要', () => {
    const view = deriveCanvas(makeStore(), 'g1', undefined)
    const byUuid = Object.fromEntries(view.cards.map((c) => [c.uuid, c]))
    expect(byUuid['a'].blank).toBe(true)
    expect(byUuid['a'].excerpt).toBeUndefined()
    expect(byUuid['exam1'].blank).toBe(true)
    expect(byUuid['sdoc1'].blank).toBe(true)
    expect(byUuid['r'].blank).toBeUndefined()
    // 摘要是洗过 Markdown 记号的一段纯文字
    expect(byUuid['r'].excerpt).toBe('微积分')
  })

  it('没有目标 / 没有节点：空图', () => {
    expect(deriveCanvas(emptyLearnStore(), 'g1', undefined).cards).toEqual([])
    const s = makeStore()
    const noGoal = { ...s, goals: [] }
    expect(deriveCanvas(noGoal, 'g1', undefined).cards).toEqual([])
  })
})

describe('deriveCanvas：坐标以存过的为准，没存的自动铺排（确定性）', () => {
  it('存过的坐标与便条被尊重', () => {
    const saved: StructureMap = {
      version: 2,
      positions: {
        r: { x: 1000, y: 500, note: '根的便条' },
        note1: { x: 42, y: 24 },
      },
    }
    const view = deriveCanvas(makeStore(), 'g1', saved)
    const r = view.cards.find((c) => c.uuid === 'r')!
    const note = view.cards.find((c) => c.uuid === 'note1')!
    expect(r).toMatchObject({ x: 1000, y: 500, note: '根的便条' })
    expect(note).toMatchObject({ x: 42, y: 24 })
  })

  it('没存过的卡自动铺排：入口最左、根在其右、挂件再右；同一份输入派生两次结果一致', () => {
    const store = makeStore()
    const first = deriveCanvas(store, 'g1', undefined)
    const second = deriveCanvas(store, 'g1', undefined)
    expect(first.cards).toEqual(second.cards)

    const byUuid = Object.fromEntries(first.cards.map((c) => [c.uuid, c]))
    const entry = byUuid[entryUuid('r')]
    const root = byUuid['r']
    const note = byUuid['note1']
    expect(entry.x).toBeLessThan(root.x)
    expect(root.x).toBeLessThan(note.x)
    // 自动铺排的卡都拿到有限坐标
    for (const c of first.cards) {
      expect(Number.isFinite(c.x)).toBe(true)
      expect(Number.isFinite(c.y)).toBe(true)
    }
  })

  it('自动铺排不重叠：任意两张卡不交叠', () => {
    const view = deriveCanvas(makeStore(), 'g1', undefined)
    for (const a of view.cards) {
      for (const b of view.cards) {
        if (a === b) continue
        const overlap =
          a.x < b.x + CARD_W && b.x < a.x + CARD_W && a.y < b.y + view.heightOf(b) && b.y < a.y + view.heightOf(a)
        expect(overlap).toBe(false)
      }
    }
  })

  it('入口没存过坐标时贴到根文档左边（读图方向「从入口往右」）', () => {
    const saved: StructureMap = { version: 2, positions: { r: { x: 900, y: 100 } } }
    const view = deriveCanvas(makeStore(), 'g1', saved)
    const entry = view.cards.find((c) => c.uuid === entryUuid('r'))!
    const root = view.cards.find((c) => c.uuid === 'r')!
    expect(entry.x).toBeLessThan(root.x)
  })

  it('游离文档（摘了线）也在画布上：按深度补铺，不凭空消失', () => {
    const store = makeStore()
    const detached = { ...store, edges: [] }
    const view = deriveCanvas(detached, 'g1', undefined)
    const ids = view.cards.map((c) => c.uuid)
    expect(ids).toContain('a')
    // 树边没了：大纲→子文档那条连线也就没了（连线永远跟着事实走）
    expect(view.edges.some((e) => e.to === 'a')).toBe(false)
  })

  it('空表兜底：saved 为空对象等价于没存过', () => {
    const store = makeStore()
    expect(deriveCanvas(store, 'g1', emptyStructure()).cards).toEqual(deriveCanvas(store, 'g1', undefined).cards)
  })
})

describe('连线几何（与画布共用一份口径）', () => {
  it('同高度的直线不绕弯：两点直接连', () => {
    const points = edgeElbow({ x: 0, y: 0 }, { x: 100, y: 0 })
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ])
  })

  it('折线的 path 按点列拼，曲线按贝塞尔拼', () => {
    expect(edgePathD([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe('M0 0 L10 10')
    expect(
      edgePathD(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
          { x: 10, y: 10 },
        ],
        'curved',
      ),
    ).toBe('M0 0 C10 0, 0 10, 10 10')
  })

  it('列距常量还在（自动铺排的列宽 = 卡片宽 + 连线留白）', () => {
    expect(COL_GAP).toBe(CARD_W + 112)
    expect(CARD_H).toBeGreaterThan(0)
  })
})
