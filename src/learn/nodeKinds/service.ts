/**
 * 节点服务：节点宇宙的唯一入口——**画布与 agent 走同一条通道**就在这一层兑现。
 *
 * 四个动作：create / get / list / delete（api.node 收缩后的全部；沙箱一侧只透传这里）。
 * 落点派发（uuid → 哪种节点、长在哪个文档上）是派生事实，画布、页签、agent 共用
 * `locateUuid` 这一份——没有第二张「谁在哪」的表，也就没有对账。
 */
import {
  createNodeUnder,
  createNote,
  deleteNode,
  deleteNote,
  examsOfNode,
  nodeById,
  parentIds,
  shellExamOf,
  upsertExam,
} from '../graph'
import { nodePathOf } from '../paths'
import { clearOutline } from '../outline'
import { notesOf } from '../notes'
import { SUPERDOC_DEFAULT_NAME, removeSuperDoc, writeSuperDoc } from '../superdocs'
import { superDocsOf, type LearnStore } from '../types'
import { docIdOfEntryUuid, docIdOfOutlineUuid, entryUuid, outlineUuid, GNode, type NodeCtx, type NodeResult } from './base'
import { DocGNode } from './doc'
import { EntryGNode } from './entry'
import { ExamGNode } from './exam'
import { NoteGNode } from './note'
import { OutlineGNode } from './outline'
import { SuperdocGNode } from './superdoc'

export interface NodeServiceDeps {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
  goalId: () => string
}

/** uuid 在 store 里的落点（派生事实的唯一出口；画布取卡片、服务取对象都用它） */
export type UuidLocation =
  | { kind: 'doc'; docId: string }
  | { kind: 'outline'; docId: string }
  | { kind: 'entry'; docId: string }
  | { kind: 'note'; docId: string; noteId: string }
  | { kind: 'superdoc'; docId: string; sdocId: string }
  | { kind: 'exam'; docId: string; examId: string }

export function locateUuid(store: LearnStore, uuid: string): UuidLocation | null {
  const entryDoc = docIdOfEntryUuid(uuid)
  if (entryDoc) {
    return store.goals.some((g) => g.rootNodeId === entryDoc) ? { kind: 'entry', docId: entryDoc } : null
  }
  const outlineDoc = docIdOfOutlineUuid(uuid)
  if (outlineDoc) {
    return nodeById(store, outlineDoc) ? { kind: 'outline', docId: outlineDoc } : null
  }
  const exam = store.exams.find((e) => e.id === uuid)
  if (exam) return { kind: 'exam', docId: exam.nodeId, examId: exam.id }
  for (const node of store.nodes) {
    if (node.id === uuid) return { kind: 'doc', docId: node.id }
    const note = notesOf(node).find((n) => n.id === uuid)
    if (note) return { kind: 'note', docId: node.id, noteId: note.id }
    const sdoc = superDocsOf(node).find((d) => d.id === uuid)
    if (sdoc) return { kind: 'superdoc', docId: node.id, sdocId: sdoc.id }
  }
  return null
}

/** under 参数（上游 uuid）→ 宿主文档 id：大纲 uuid 与文档 uuid 都认，入口拒绝 */
function hostDocOfUnder(store: LearnStore, under: unknown): { docId: string } | { error: string } {
  if (typeof under !== 'string' || !under.trim()) {
    return { error: '必须写 under（挂在哪个文档之下）：给文档的 uuid，或它大纲的 uuid（o: 前缀）' }
  }
  const raw = under.trim()
  if (docIdOfEntryUuid(raw)) return { error: '入口不是挂点——挂件挂在文档之下，under 给文档或大纲的 uuid' }
  const outlineDoc = docIdOfOutlineUuid(raw)
  if (outlineDoc) {
    return nodeById(store, outlineDoc) ? { docId: outlineDoc } : { error: '这份大纲的宿主文档已经不在了' }
  }
  return nodeById(store, raw) ? { docId: raw } : { error: 'under 里给的 uuid 不存在：先 api.node.list() 查清楚再建' }
}

export class NodeService {
  private readonly deps: NodeServiceDeps

  constructor(deps: NodeServiceDeps) {
    this.deps = deps
  }

  private get ctx(): NodeCtx {
    return { store: this.deps.getLatest, commit: this.deps.set, goalId: this.deps.goalId }
  }

  /** 按 uuid 取节点对象；不存在回 undefined（api 层翻成「没有这个节点」的回执） */
  get(uuid: string): GNode | undefined {
    const store = this.deps.getLatest()
    const raw = (uuid ?? '').trim()
    if (!raw) return undefined
    const loc = locateUuid(store, raw)
    if (!loc) return undefined
    switch (loc.kind) {
      case 'doc':
        return new DocGNode(this.ctx, loc.docId)
      case 'outline':
        return new OutlineGNode(this.ctx, outlineUuid(loc.docId))
      case 'entry':
        return new EntryGNode(this.ctx, entryUuid(loc.docId))
      case 'note':
        return new NoteGNode(this.ctx, loc.noteId, loc.docId)
      case 'superdoc':
        return new SuperdocGNode(this.ctx, loc.sdocId, loc.docId)
      case 'exam':
        return new ExamGNode(this.ctx, loc.examId)
    }
  }

  /**
   * 建节点（画布拖挂件与 agent 建节点走的同一条路）。
   * 挂件（笔记 / 试卷 / 超级文档）创建即挂到 under 的文档之下；文档建在 under 的大纲之下
   * （under 给文档 uuid 时视同它的大纲）。试卷遇到空壳（画布上拖出来的那份）直接复用。
   */
  create(input: Record<string, unknown>): { ok: true; uuid: string; title: string; created: boolean; note: string } | { error: string } {
    const kind = typeof input.kind === 'string' ? input.kind : ''
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    const store = this.deps.getLatest()

    if (kind === 'outline') {
      return { error: '大纲随文档存在：api.node.get("' + (typeof input.under === 'string' ? input.under : '') + '") 换成 o: 前缀就是那份大纲' }
    }
    if (kind === 'entry') {
      return { error: '入口由目标绑定自动生成（每张图一个），不能创建' }
    }

    const under = hostDocOfUnder(store, input.under)
    if ('error' in under) return { error: under.error }
    const host = nodeById(store, under.docId)
    if (!host) return { error: 'under 里给的文档已经不在了' }

    if (kind === 'doc') {
      if (!title) return { error: '建文档要给 title（新文档的标题）' }
      const r = createNodeUnder(store, under.docId, {
        title,
        ...(typeof input.description === 'string' ? { description: input.description } : {}),
      })
      if (r.node.id === under.docId) {
        return { error: '本目标里已经有「' + title + '」这个文档（' + r.node.id + '），没有另建一份' }
      }
      this.deps.set(r.store)
      return {
        ok: true,
        uuid: r.node.id,
        title: r.node.title,
        created: r.created,
        note: r.created
          ? '已建文档「' + r.node.title + '」并挂到「' + host.title + '」的大纲之下；教学正文用 editContent 写'
          : '本目标里已有同名文档「' + r.node.title + '」，直接复用（没有另建）',
      }
    }

    if (kind === 'note') {
      const r = createNote(store, under.docId, title || undefined)
      if (!r.name) return { error: '笔记没有建成（文档可能刚被删除）' }
      const note = notesOf(nodeById(r.store, under.docId) ?? host).find((n) => n.name === r.name)
      this.deps.set(r.store)
      return {
        ok: true,
        uuid: note?.id ?? '',
        title: r.name,
        created: true,
        note: '已在「' + host.title + '」下建笔记「' + r.name + '」；正文用 editContent({ text }) 写',
      }
    }

    if (kind === 'superdoc') {
      const name = title || SUPERDOC_DEFAULT_NAME
      const next = writeSuperDoc(store, under.docId, name, '')
      if (!next) return { error: '超级文档没有建成（文档可能刚被删除）' }
      const created = superDocsOf(nodeById(next, under.docId) ?? host).find((d) => d.name === name)
      this.deps.set(next)
      return {
        ok: true,
        uuid: created?.id ?? '',
        title: name,
        created: true,
        note: '已在「' + host.title + '」下建空超级文档「' + name + '」；完整 HTML 用 editContent({ html }) 写入',
      }
    }

    if (kind === 'exam') {
      // 空壳吸收：画布上拖出的空试卷卡是一份真实实体，出题沿用它的 id 原地变实
      const shell = shellExamOf(store, under.docId)
      if (shell) {
        return {
          ok: true,
          uuid: shell.id,
          title: shell.title,
          created: false,
          note: '「' + host.title + '」下已经有一份空卷（' + shell.id + '），直接对它 editContent 出题，不要另建',
        }
      }
      const exam = {
        id: crypto.randomUUID(),
        nodeId: under.docId,
        goalId: host.goalId,
        title: title || host.title + ' · 待出题',
        kind: 'quiz' as const,
        level: 'easy' as const,
        minutes: 0,
        questions: [],
        attempts: [],
        createdAt: Date.now(),
      }
      this.deps.set(upsertExam(store, exam))
      return {
        ok: true,
        uuid: exam.id,
        title: exam.title,
        created: true,
        note: '已在「' + host.title + '」下建空卷；题目用 editContent({ questions }) 出（help() 里有题目格式）',
      }
    }

    return { error: 'kind 只能是 doc / note / exam / superdoc（outline 随文档存在、entry 由目标生成）' }
  }

  /** 目标的全量清单（agent 的导航图；含挂件，全部带 uuid） */
  list(): Record<string, unknown> {
    const store = this.deps.getLatest()
    const goalId = this.deps.goalId()
    const goal = store.goals.find((g) => g.id === goalId)
    const docs = store.nodes.filter((n) => n.goalId === goalId)
    return {
      ok: true,
      goal: {
        id: goalId,
        question: goal?.question ?? '',
        entry: goal ? entryUuid(goal.rootNodeId) : null,
        root: goal?.rootNodeId ?? null,
      },
      nodes: docs.map((node) => ({
        uuid: node.id,
        title: node.title,
        status: node.status,
        path: nodePathOf(store, goalId, node.id),
        upstreams:
          goal && goal.rootNodeId === node.id
            ? [entryUuid(node.id)]
            : parentIds(store, node.id).map((p) => outlineUuid(p)),
        outline: node.outline ? { uuid: outlineUuid(node.id), entries: node.outline.children.length } : null,
        notes: notesOf(node).map((n) => ({ uuid: n.id, title: n.name, chars: n.content.length })),
        superdocs: superDocsOf(node).map((d) => ({ uuid: d.id, title: d.name, chars: d.html.length })),
        exams: examsOfNode(store, node.id).map((e) => ({
          uuid: e.id,
          title: e.title,
          questions: e.questions.length,
          attempts: e.attempts.length,
        })),
      })),
      note: '要动哪个就 const n = await api.node.get(uuid) 取对象；动手前 await n.help() 看它自己怎么说。',
    }
  }

  /** 删除节点（删谁只删谁；摘线不连坐——下游断线成游离，不删除） */
  delete(uuid: string): NodeResult {
    const store = this.deps.getLatest()
    const raw = (uuid ?? '').trim()
    const loc = locateUuid(store, raw)
    if (!loc) return { error: '没有 uuid 为「' + raw + '」的节点；先 api.node.list() 查清楚' }

    if (loc.kind === 'outline') {
      // 大纲是文档的「计划」层：删除 = 清空计划。文档、树边、下游文档都原样保留。
      const node = nodeById(store, loc.docId)
      const next = clearOutline(store, loc.docId, Date.now())
      if (!next) return { error: '这份大纲还没有写过内容，没有可删的东西' }
      this.deps.set(next)
      return { ok: true, note: '已删除「' + (node?.title ?? loc.docId) + '」的大纲：计划清空，文档与它的下级文档都还在' }
    }
    if (loc.kind === 'entry') return { error: '入口由目标绑定生成，删不掉（目标删了它自然消失）' }
    if (loc.kind === 'exam') {
      return { error: '试卷的删除走 api.exam.delete——要先确认没有等着判分 / 讲解的考试' }
    }

    if (loc.kind === 'doc') {
      const node = nodeById(store, loc.docId)
      const next = deleteNode(store, loc.docId)
      if (next === store) return { error: '这个文档已经不在了' }
      this.deps.set(next)
      return {
        ok: true,
        note:
          '已删除「' + (node?.title ?? loc.docId) + '」本身：下游文档只是断了线，还在画布上；' +
          '它名下的笔记、试卷与超级文档随它一起走了',
      }
    }

    if (loc.kind === 'note') {
      const node = nodeById(store, loc.docId)
      const note = node ? notesOf(node).find((n) => n.id === loc.noteId) : undefined
      if (!note) return { error: '这份笔记已经不在了' }
      this.deps.set(deleteNote(store, loc.docId, note.name))
      return { ok: true, note: '已删除笔记「' + note.name + '」（开着它的页签会一并关掉）' }
    }

    const node = nodeById(store, loc.docId)
    const sdoc = node ? superDocsOf(node).find((d) => d.id === loc.sdocId) : undefined
    if (!sdoc) return { error: '这份超级文档已经不在了' }
    this.deps.set(removeSuperDoc(store, loc.docId, sdoc.name))
    return { ok: true, note: '已删除超级文档「' + sdoc.name + '」（开着它的页签会一并失效）' }
  }
}
