import { describe, expect, it } from 'vitest'
import { migrateOutlineToStructure } from '../src/lib/migration/outlineStructure'
import type { MigrationContext } from '../src/lib/migration/types'
import type { StructureMap } from '../src/learn/structure'

const UID = 'u1'
const DOCS = `users/${UID}/docs`
const GOAL = `${DOCS}/高数`

/** 一份内存里的假用户目录：够 listDir / readJson / readText / writeJson 用 */
function fakeCtx(seed: Record<string, string>): MigrationContext {
  const files = new Map(Object.entries(seed))
  const listDir = (rel: string) => {
    const prefix = `${rel}/`
    const names = new Map<string, boolean>()
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash === -1) names.set(rest, false)
      else names.set(rest.slice(0, slash), true)
    }
    return Promise.resolve([...names].map(([name, dir]) => ({ name, dir })))
  }
  return {
    uid: UID,
    userDir: `users/${UID}`,
    storage: {
      readJson: <T,>(rel: string) => {
        const text = files.get(rel)
        return Promise.resolve(text ? (JSON.parse(text) as T) : null)
      },
      writeJson: (rel: string, data: unknown) => {
        files.set(rel, JSON.stringify(data))
        return Promise.resolve(true)
      },
      readYaml: () => Promise.resolve(null),
      writeYaml: () => Promise.resolve(true),
      readText: (rel: string) => Promise.resolve(files.get(rel) ?? null),
      writeText: (rel: string, content: string) => {
        files.set(rel, content)
        return Promise.resolve(true)
      },
      listDir,
      removePath: (rel: string) => {
        files.delete(rel)
        return Promise.resolve(true)
      },
      mkdir: () => Promise.resolve(true),
    },
    log: () => {},
  } as MigrationContext
}

function meta(id: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, id, title: id, key: id, dependencies: [], ...extra })
}

/** 一棵最小的旧树：根（有正文 + 一份笔记）→ 子节点（空正文 + 一场考试） */
function legacyTree(): Record<string, string> {
  return {
    [`${GOAL}/高数.meta.json`]: meta('n1', { dependencies: [{ to: 'n2', createdAt: 1 }] }),
    [`${GOAL}/高数.md`]: '# 高数\n\n正文',
    [`${GOAL}/高数.notes/错题.md`]: '笔记正文',
    [`${GOAL}/导数/导数.meta.json`]: meta('n2'),
    [`${GOAL}/导数/导数.md`]: '   ',
    [`${GOAL}/导数/exams/e1.json`]: JSON.stringify({ id: 'e1', nodeId: 'n2' }),
  }
}

async function run(seed: Record<string, string>): Promise<{ ctx: MigrationContext; map: StructureMap | null }> {
  const ctx = fakeCtx(seed)
  const res = await migrateOutlineToStructure(ctx)
  expect(res.ok).toBe(true)
  const map = await ctx.storage.readJson<StructureMap>(`${GOAL}/structure.json`)
  return { ctx, map }
}

describe('数据迁移：大纲树 → 结构图', () => {
  it('一个学习节点拆成大纲节点 + 文档节点，笔记挂文档下游', async () => {
    const { map } = await run(legacyTree())
    expect(map).not.toBeNull()
    const kinds = Object.fromEntries(map!.nodes.map((n) => [n.id, n.kind]))
    expect(kinds).toMatchObject({
      'o:n1': 'outline',
      'd:n1': 'doc',
      'n:n1:错题': 'note',
      'd:n2': 'doc',
      'e:e1': 'exam',
    })
    // n2 没有目标项、也不是根 → 不建大纲卡（空大纲只是空壳）
    expect(kinds['o:n2']).toBeUndefined()
    expect(map!.edges).toEqual(
      expect.arrayContaining([
        // 先文档再大纲
        { from: 'd:n1', to: 'o:n1' },
        { from: 'd:n1', to: 'n:n1:错题' },
        // 父的**大纲** → 子的**文档**（大纲之间不再直接相连）
        { from: 'o:n1', to: 'd:n2' },
        { from: 'd:n2', to: 'e:e1' },
      ]),
    )
  })

  it('ref 指回现有实体，不复制内容', async () => {
    const { map } = await run(legacyTree())
    const byId = new Map(map!.nodes.map((n) => [n.id, n]))
    expect(byId.get('o:n1')?.ref).toBe('n1')
    expect(byId.get('d:n1')?.ref).toBe('n1')
    expect(byId.get('n:n1:错题')?.ref).toBe('n1:错题')
    expect(byId.get('e:e1')?.ref).toBe('e1')
  })

  it('文档节点无条件建：它是把子树接上去的连接件', async () => {
    // 大纲的父子节点只能是文档，没有文档，子节点就挂不上来
    const seed = {
      [`${GOAL}/高数.meta.json`]: meta('n1'),
      [`${GOAL}/高数.md`]: '',
    }
    const { map } = await run(seed)
    expect(map!.nodes.map((n) => n.id).sort()).toEqual(['d:n1', 'o:n1'])
    expect(map!.edges).toEqual([{ from: 'd:n1', to: 'o:n1' }])
  })

  it('每个节点都有坐标，且连线不会成环', async () => {
    const { map } = await run(legacyTree())
    for (const n of map!.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
    const seen = new Set<string>()
    const walk = (id: string): boolean => {
      if (seen.has(id)) return true
      seen.add(id)
      return false
    }
    // 大纲之间不允许互相指回去（n1 → n2 之后不能再有 n2 → n1）
    expect(map!.edges.filter((e) => e.from === 'o:n2' && e.to === 'o:n1')).toHaveLength(0)
    expect(walk('o:n1')).toBe(false)
  })

  it('重跑一次不会冲掉已有的图（幂等）', async () => {
    const seed = legacyTree()
    const { ctx, map } = await run(seed)
    // 用户把节点拖到了别处
    map!.nodes[0].x = 9999
    await ctx.storage.writeJson(`${GOAL}/structure.json`, map)
    const res = await migrateOutlineToStructure(ctx)
    expect(res.ok).toBe(true)
    expect(res.modifiedFiles).toEqual([])
    const again = await ctx.storage.readJson<StructureMap>(`${GOAL}/structure.json`)
    expect(again!.nodes[0].x).toBe(9999)
  })

  it('没有 docs 目录时安静地什么都不做', async () => {
    const ctx = fakeCtx({})
    const res = await migrateOutlineToStructure(ctx)
    expect(res.ok).toBe(true)
    expect(res.modifiedFiles).toEqual([])
  })
})
