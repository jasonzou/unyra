/**
 * 这个文件负责什么：**把旧的大纲树铺成结构图**（数据迁移脚本 m_0_6_3_to_0_7_0 的实现）。
 *
 * ## 为什么是一个迁移脚本，而不是业务代码里的兼容分支
 *
 * 结构页从「算出来的树」改成「拖出来的图」，数据形状变了：节点有坐标、有显式连线。
 * 这类改变如果写进 parseDocs / normalize 里（「读到老数据就顺手折一下」），
 * 就会变成永远删不掉的兼容分支——每加一个字段都要问一句「老的怎么算」。
 * 所以按这个仓库既定的路子走：**迁移脚本一次性搬完，业务代码只认新形状**。
 *
 * ## 搬什么
 *
 * 旧模型里一个 KnowledgeNode 同时拥有「大纲 + 教学文档 + 若干笔记/试卷/超级文档」。
 * 新模型里它们必须是**各自独立的节点**（需求：大纲和文档不能是一个节点），于是：
 *
 * | 旧数据 | 新节点 | 连线 |
 * |---|---|---|
 * | `{节点}.meta.json` | 大纲节点 | 依赖边 → 大纲 → 大纲 |
 * | `{节点}.md`（有正文） | 文档节点 | 大纲 → 文档 |
 * | `{节点}.notes/{名字}.md` | 笔记节点 | 文档 → 笔记 |
 * | `{节点}/exams/{id}.json` | 试卷节点 | 文档 → 试卷 |
 * | meta.superdocs[] | 超级文档节点 | 文档 → 超级文档 |
 *
 * 教学文档是空的不建文档节点：旧模型里每个节点都有一个空的 `.md`，
 * 全建出来等于让画布上一半是空盒子。想要就拖一个——这正是新架构的用法。
 *
 * ## 幂等
 *
 * 已经有 `structure.json` 且里面有节点时直接跳过：迁移重跑一次不该把用户摆好的位置冲掉。
 */

import type { MigrationContext, MigrationScript, MigrationStepResult } from './types'
import {
  CARD_H,
  NOTE_ROW,
  OUTLINE_HEAD,
  SLOT_ROW,
  seedFromSource,
  type SeedSourceNode,
} from '../../learn/structure'

/** meta.json 里迁移用得到的部分（其余字段搬不过来也不影响结构图） */
interface MetaLike {
  id?: unknown
  dependencies?: unknown
  notes?: unknown
  superdocs?: unknown
}

interface Collected {
  /** 节点目录（相对数据根，含 users/{uid}/ 前缀） */
  dir: string
  /** 文件名主干（`{base}.meta.json` 的 base） */
  base: string
  id: string
  /** 旧树里「我 → 下游」的节点 id（依赖边的 to 侧） */
  downstream: string[]
  notes: string[]
  superdocs: string[]
  /**
   * 大纲里目标项的 key，**按顺序**。两个用途：
   * 条数决定卡片高度；次序决定同列里子大纲的上下顺序。
   */
  slotKeys: string[]
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** 递归收集一个目标目录下的全部 meta（目标目录 = docs/{一级目录}） */
async function collectMetas(ctx: MigrationContext, goalDir: string): Promise<Collected[]> {
  const out: Collected[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await ctx.storage.listDir(dir)
    const dirs: string[] = []
    for (const entry of entries) {
      if (entry.dir) {
        dirs.push(entry.name)
        continue
      }
      // 只要 `{base}.meta.json`：同目录下还有 .md / .outline.json / exams/ 等
      if (!entry.name.endsWith('.meta.json')) continue
      const base = entry.name.slice(0, -'.meta.json'.length)
      const meta = await ctx.storage.readJson<MetaLike>(`${dir}/${entry.name}`)
      if (!meta || typeof meta !== 'object') continue
      const id = str(meta.id)
      if (!id) continue
      /**
       * 笔记与超级文档**两头都看**：meta 里登记的名字，以及目录里真实存在的文件。
       *
       * 只信 meta 会漏：手改过目录、或者某个版本写 meta 时漏了登记，文件就在那儿却搬不过去。
       * 只信目录也会漏：超级文档在新版里是整份存 meta 的（不落独立文件）。
       * 两边取并集、按名字去重——迁移宁可多搬一个真文件，也不要丢掉用户写过的东西。
       */
      const metaNotes = asArray(meta.notes)
        .map((n) => str((n as { name?: unknown } | null)?.name))
        .filter(Boolean)
      const diskNotes = (await ctx.storage.listDir(`${dir}/${base}.notes`))
        .filter((e) => !e.dir && e.name.endsWith('.md'))
        .map((e) => e.name.slice(0, -3))
      const outline = await ctx.storage.readJson<{ children?: unknown[] }>(`${dir}/${base}.outline.json`)
      const metaSuperdocs = asArray(meta.superdocs)
        .map((s) => str((s as { name?: unknown } | null)?.name))
        .filter(Boolean)
      const diskSuperdocs = (await ctx.storage.listDir(`${dir}/superdocs`))
        .filter((e) => !e.dir && e.name.endsWith('.html'))
        .map((e) => e.name.slice(0, -5))
      out.push({
        dir,
        base,
        id,
        downstream: asArray(meta.dependencies)
          .map((d) => str((d as { to?: unknown } | null)?.to))
          .filter(Boolean),
        notes: [...new Set([...metaNotes, ...diskNotes])],
        superdocs: [...new Set([...metaSuperdocs, ...diskSuperdocs])],
        slotKeys: asArray(outline?.children)
          .map((c) => str((c as { key?: unknown } | null)?.key))
          .filter(Boolean),
      })
    }
    // 子目录里也可能有节点（旧模型允许节点嵌在节点目录里）
    for (const name of dirs) await walk(`${dir}/${name}`)
  }
  await walk(goalDir)
  return out
}

/** 这个节点有没有正文（空 .md 不建文档节点，理由见文件头） */
async function hasTeaching(ctx: MigrationContext, item: Collected): Promise<boolean> {
  const text = await ctx.storage.readText(`${item.dir}/${item.base}.md`)
  return !!text && text.trim().length > 0
}

/** 这个节点下的试卷 id 清单（`{节点}/exams/{id}.json`） */
async function examIds(ctx: MigrationContext, item: Collected): Promise<string[]> {
  const entries = await ctx.storage.listDir(`${item.dir}/exams`)
  return entries.filter((e) => !e.dir && e.name.endsWith('.json')).map((e) => e.name.slice(0, -'.json'.length))
}

/** 把收集到的文件信息拼成装配输入（装配规则在 learn/structure 的 seedFromSource，不在这里） */
function toSource(
  items: readonly Collected[],
  docsWithBody: ReadonlySet<string>,
  examsOf: ReadonlyMap<string, string[]>,
): SeedSourceNode[] {
  return items.map((item) => ({
    id: item.id,
    hasDoc: docsWithBody.has(item.id),
    downstream: item.downstream,
    notes: item.notes,
    superdocs: item.superdocs,
    exams: examsOf.get(item.id) ?? [],
  }))
}

export async function migrateOutlineToStructure(ctx: MigrationContext): Promise<MigrationStepResult> {
  const modifiedFiles: string[] = []
  const docsRoot = `${ctx.userDir}/docs`
  const goals = (await ctx.storage.listDir(docsRoot)).filter((e) => e.dir)
  ctx.log(`发现 ${goals.length} 个目标目录`)

  for (const goal of goals) {
    const goalDir = `${docsRoot}/${goal.name}`
    const target = `${goalDir}/structure.json`

    // 幂等：已经有图就跳过（重跑不该冲掉用户摆好的位置）
    const existing = await ctx.storage.readJson<{ nodes?: unknown[] }>(target)
    if (existing && Array.isArray(existing.nodes) && existing.nodes.length) {
      ctx.log(`跳过「${goal.name}」：已经有结构图（${existing.nodes.length} 个节点）`)
      continue
    }

    const items = await collectMetas(ctx, goalDir)
    if (!items.length) {
      ctx.log(`跳过「${goal.name}」：没有节点`)
      continue
    }

    const docsWithBody = new Set<string>()
    const examsOf = new Map<string, string[]>()
    for (const item of items) {
      if (await hasTeaching(ctx, item)) docsWithBody.add(item.id)
      const ids = await examIds(ctx, item)
      if (ids.length) examsOf.set(item.id, ids)
    }

    /*
     * 高度要跟着数据走：大纲卡片的行数就是目标项条数，不传高度的话
     * 迁移铺出来的图会像「按固定行距排」那样叠在一起。
     */
    const slotsOf = new Map(items.map((i) => [i.id, i.slotKeys.length]))
    /** 目标项 key → 它在父大纲里的下标（子大纲按这个上下排） */
    const slotRank = new Map<string, number>()
    for (const item of items) item.slotKeys.forEach((key, index) => slotRank.set(key, index))
    const height = (node: { kind: string; ref?: string; note?: string }): number => {
      const noteRow = node.note ? NOTE_ROW : 0
      if (node.kind !== 'outline' || !node.ref) return CARD_H + noteRow
      const count = slotsOf.get(node.ref) ?? 0
      if (!count) return CARD_H + noteRow
      return Math.max(CARD_H, OUTLINE_HEAD + count * SLOT_ROW + 8) + noteRow
    }
    const map = seedFromSource(
      toSource(items, docsWithBody, examsOf),
      height,
      (node) => (node.slot ? slotRank.get(node.slot) ?? 0 : 0),
    )
    if (!map.nodes.length) {
      ctx.log(`跳过「${goal.name}」：铺出来是空的`)
      continue
    }

    const ok = await ctx.storage.writeJson(target, map)
    if (!ok) {
      return {
        ok: false,
        fromVersion: '0.6.3',
        toVersion: '0.7.0',
        modifiedFiles,
        error: `写入 ${target} 失败`,
      }
    }
    modifiedFiles.push(target)
    ctx.log(`「${goal.name}」铺好：${map.nodes.length} 个节点、${map.edges.length} 条连线`)
  }

  return {
    ok: true,
    fromVersion: '0.6.3',
    toVersion: '0.7.0',
    modifiedFiles,
    details: modifiedFiles.length ? `为 ${modifiedFiles.length} 个目标铺出了结构图` : '没有需要迁移的目标',
  }
}

export const outlineToStructure: MigrationScript = {
  id: 'm_0_6_3_to_0_7_0',
  fromVersion: '0.6.3',
  toVersion: '0.7.0',
  title: '大纲树 → 结构图',
  summary:
    '结构页从「算出来的大纲树」改成「拖出来的节点图」：为每个目标生成 structure.json，' +
    '把每个学习节点拆成大纲节点 + 文档节点，笔记/试卷/超级文档各自成为文档的下游节点。',
  changes: [
    '每个目标新增 docs/{目标}/structure.json（节点坐标 + 连线）',
    '一个学习节点拆成「大纲节点」与「文档节点」两个独立节点（有正文或有下游时才建文档节点）',
    '笔记 / 试卷 / 超级文档各成为一个节点，挂在文档节点下游',
    '旧的依赖边转成「大纲 → 大纲」的连线；指向已删节点的边丢弃',
    '已有结构图的目标跳过（可重复执行）',
  ],
  migrate: migrateOutlineToStructure,
}
