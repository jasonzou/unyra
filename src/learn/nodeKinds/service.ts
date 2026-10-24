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
  normalizeKey,
  parentIds,
  shellExamOf,
  upsertExam,
} from '../graph'
import type { Exam } from '../exam'
import { detachedPoolOf, findNoteEntity, findSuperDocEntity, withDetached } from '../detached'
import { nodePathOf } from '../paths'
import { clearOutline } from '../outline'
import { NOTE_DEFAULT_NAME, notesOf, uniqueNoteName } from '../notes'
import { SUPERDOC_DEFAULT_NAME, removeSuperDoc, writeSuperDoc } from '../superdocs'
import { emptyDocs, superDocsOf, type KnowledgeNode, type LearnStore, type NoteFile, type SuperDocFile } from '../types'
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
  // 游离池（剪了线 / 还没绑过的笔记与超级文档）：独立实体，没有宿主（docId 空串）
  for (const bucket of Object.values(store.detached ?? {})) {
    if (bucket.notes.some((n) => n.id === uuid)) return { kind: 'note', docId: '', noteId: uuid }
    if (bucket.superdocs.some((d) => d.id === uuid)) return { kind: 'superdoc', docId: '', sdocId: uuid }
  }
  return null
}

/**
 * 独立文档：无父无纲的新实体。标题与目标内现有文档重名时顺延（画布空白处落下的
 * 那一下必须**真的长出一张新卡**，不走「同名复用」——那是挂在层下时的规矩）。
 */
function freeNode(store: LearnStore, goalId: string, rawTitle: string, description = ''): { store: LearnStore; record: KnowledgeNode } {
  const taken = new Set(store.nodes.filter((n) => n.goalId === goalId).map((n) => n.title))
  let title = rawTitle
  let i = 2
  while (taken.has(title)) title = rawTitle + ' ' + i++
  const now = Date.now()
  const record: KnowledgeNode = {
    id: crypto.randomUUID(),
    title,
    key: normalizeKey(title),
    description,
    docs: emptyDocs(),
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId,
    createdAt: now,
    updatedAt: now,
  }
  return { store: { ...store, nodes: [...store.nodes, record] }, record }
}

/** 给文档补一份空大纲（大纲实体存在 = 画布上有那张卡；内容之后用 editContent 写） */
function ensureOutline(store: LearnStore, docId: string): LearnStore {
  const node = nodeById(store, docId)
  if (!node || node.outline) return store
  return {
    ...store,
    nodes: store.nodes.map((n) => (n.id === docId ? { ...n, outline: { intro: '', children: [], updatedAt: Date.now() } } : n)),
  }
}

/** under 参数（上游 uuid）→ 宿主文档 id：大纲 uuid 与文档 uuid 都认，入口拒绝 */
function hostDocOfUnder(store: LearnStore, under: unknown): { docId: string } | { error: string } {
  if (typeof under !== 'string' || !under.trim()) {
    return { error: 'under 给了空值：要建游离实体就别传 under，要挂就给文档的 uuid 或它大纲的 uuid（o: 前缀）' }
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
    return {
      store: this.deps.getLatest,
      commit: this.deps.set,
      goalId: this.deps.goalId,
      // getPortData 按 uuid 还原上游对象（基类不反向依赖本服务，走 ctx 注入）
      objectOf: (uuid: string) => this.get(uuid),
    }
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
        return new NoteGNode(this.ctx, loc.noteId)
      case 'superdoc':
        return new SuperdocGNode(this.ctx, loc.sdocId)
      case 'exam':
        return new ExamGNode(this.ctx, loc.examId)
    }
  }

  /**
   * 建节点（画布拖拽与 agent 建节点走的同一条路）。
   * **under 是可选的**：给了就创建即绑（挂件挂到那份文档之下、文档挂进大纲之下）；
   * 不给 = 创建**独立的游离实体**（画布空白处落地的那一下）——笔记 / 超级文档进游离池，
   * 试卷宿主悬空，文档无父无纲，大纲 = 连同宿主文档一起配对成形。
   * 试卷遇到空壳（画布上拖出来的那份）直接复用，不无限堆壳。
   */
  create(input: Record<string, unknown>): { ok: true; uuid: string; title: string; created: boolean; note: string } | { error: string } {
    const kind = typeof input.kind === 'string' ? input.kind : ''
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    const store = this.deps.getLatest()
    const goalId = this.deps.goalId()

    if (kind === 'entry') {
      return { error: '入口由目标绑定自动生成（每张图一个），不能创建' }
    }

    const under = typeof input.under === 'string' && input.under.trim() ? hostDocOfUnder(store, input.under) : null
    if (under && 'error' in under) return { error: under.error }
    const host = under && 'docId' in under ? nodeById(store, under.docId) : null
    if (under && !host) return { error: 'under 里给的文档已经不在了' }

    if (kind === 'outline') {
      // 大纲与文档一一对应：under 给了 = 给那份文档补一份空大纲；没给 = 连同宿主文档一起配对成形
      if (host) {
        if (host.outline) return { error: '「' + host.title + '」已经有一份大纲了（o:' + host.id + '），没有另建' }
        const next = ensureOutline(store, host.id)
        this.deps.set(next)
        return { ok: true, uuid: outlineUuid(host.id), title: host.title + ' · 大纲', created: true, note: '已为「' + host.title + '」建了一份空大纲；目标项用 editContent({ intro, children }) 写' }
      }
      const docTitle = title || '新文档'
      const node = freeNode(store, goalId, docTitle)
      const next = ensureOutline({ ...store, nodes: [...store.nodes, node.record] }, node.record.id)
      this.deps.set(next)
      return {
        ok: true,
        uuid: outlineUuid(node.record.id),
        title: docTitle + ' · 大纲',
        created: true,
        note: '已建文档「' + docTitle + '」连同它的空大纲（两者同时成形）；目标项用大纲的 editContent 写，文档正文用文档的 editContent 写',
      }
    }

    if (kind === 'doc') {
      const docTitle = title || '新文档'
      if (host) {
        // 点目标项建文档时带上那条目标项的 key = 创建即认领（与 connect 的 portKey 同一口径）
        const portKey = typeof input.portKey === 'string' ? input.portKey.trim() : ''
        const children = host.outline?.children ?? []
        if (portKey && !children.some((c) => c.key === portKey)) {
          return {
            error: children.length
              ? '「' + host.title + '」的大纲没有目标项 key「' + portKey + '」。可认领的：' + children.map((c) => c.key + '（' + c.title + '）').join('、')
              : '「' + host.title + '」还没有大纲（没有可认领的接口）',
          }
        }
        const r = createNodeUnder(store, host.id, {
          title: docTitle,
          ...(typeof input.description === 'string' ? { description: input.description } : {}),
          ...(portKey ? { portKey } : {}),
        })
        if (r.node.id === host.id) {
          return { error: '本目标里已经有「' + docTitle + '」这个文档（' + r.node.id + '），没有另建一份' }
        }
        this.deps.set(r.store)
        const claimed = portKey ? '，认领了目标项「' + (children.find((c) => c.key === portKey)?.title ?? portKey) + '」' : ''
        return {
          ok: true,
          uuid: r.node.id,
          title: r.node.title,
          created: r.created,
          note: r.created
            ? '已建文档「' + r.node.title + '」并挂到「' + host.title + '」的大纲之下' + claimed + '；教学正文用 editContent 写'
            : '本目标里已有同名文档「' + r.node.title + '」，直接复用（没有另建）',
        }
      }
      // 没给 under = 独立文档：无父无纲，落在画布空白处（树连接以后随时拖线建立）
      const node = freeNode(store, goalId, docTitle, typeof input.description === 'string' ? input.description : '')
      this.deps.set(node.store)
      return {
        ok: true,
        uuid: node.record.id,
        title: node.record.title,
        created: true,
        note: '已建独立文档「' + node.record.title + '」（还没有挂在任何层下）；教学正文用 editContent 写，要挂进哪一层就拖线到大纲上',
      }
    }

    if (kind === 'note') {
      if (host) {
        const r = createNote(store, host.id, title || undefined)
        if (!r.name) return { error: '笔记没有建成（文档可能刚被删除）' }
        const note = notesOf(nodeById(r.store, host.id) ?? host).find((n) => n.name === r.name)
        this.deps.set(r.store)
        return {
          ok: true,
          uuid: note?.id ?? '',
          title: r.name,
          created: true,
          note: '已在「' + host.title + '」下建笔记「' + r.name + '」；正文用 editContent({ text }) 写',
        }
      }
      // 游离笔记：进当前目标的池子（绑到哪份文档以后拖线决定）
      const id = crypto.randomUUID()
      const pool = detachedPoolOf(store, goalId)
      const name = uniqueNoteName(pool.notes, title || NOTE_DEFAULT_NAME)
      const note: NoteFile = { id, name, content: '', createdAt: Date.now(), updatedAt: Date.now() }
      this.deps.set(withDetached(store, goalId, { ...pool, notes: [...pool.notes, note] }))
      return { ok: true, uuid: id, title: name, created: true, note: '已建独立笔记「' + name + '」（游离：还没绑到文档上）；正文用 editContent({ text }) 写，要挂就拖线到文档上' }
    }

    if (kind === 'superdoc') {
      const name = title || SUPERDOC_DEFAULT_NAME
      if (host) {
        const next = writeSuperDoc(store, host.id, name, '')
        if (!next) return { error: '超级文档没有建成（文档可能刚被删除）' }
        const created = superDocsOf(nodeById(next, host.id) ?? host).find((d) => d.name === name)
        this.deps.set(next)
        return {
          ok: true,
          uuid: created?.id ?? '',
          title: name,
          created: true,
          note: '已在「' + host.title + '」下建空超级文档「' + name + '」；完整 HTML 用 editContent({ html }) 写入',
        }
      }
      const id = crypto.randomUUID()
      const pool = detachedPoolOf(store, goalId)
      let finalName = name
      let i = 2
      while (pool.superdocs.some((d) => d.name === finalName)) finalName = name + ' ' + i++
      const doc: SuperDocFile = { id, name: finalName, html: '', createdAt: Date.now(), updatedAt: Date.now() }
      this.deps.set(withDetached(store, goalId, { ...pool, superdocs: [...pool.superdocs, doc] }))
      return { ok: true, uuid: id, title: finalName, created: true, note: '已建独立超级文档「' + finalName + '」（游离）；完整 HTML 用 editContent({ html }) 写，要挂就拖线到文档上' }
    }

    if (kind === 'exam') {
      // 空壳吸收：绑定的遇到宿主下的空卷直接复用；游离的遇到当前目标的空卷也复用（不无限堆壳）
      const orphanShell = store.exams.find(
        (e) => e.goalId === goalId && (!e.nodeId || !nodeById(store, e.nodeId)) && e.questions.length === 0 && e.attempts.length === 0,
      )
      if (!host && orphanShell) {
        return {
          ok: true,
          uuid: orphanShell.id,
          title: orphanShell.title,
          created: false,
          note: '已经有一份游离的空卷（' + orphanShell.id + '），直接对它 editContent 出题，不要另建',
        }
      }
      if (!host) {
        const exam: Exam = {
          id: crypto.randomUUID(),
          nodeId: '',
          goalId,
          title: title || '待出题',
          kind: 'quiz',
          level: 'easy',
          minutes: 0,
          questions: [],
          attempts: [],
          createdAt: Date.now(),
        }
        this.deps.set(upsertExam(store, exam))
        return { ok: true, uuid: exam.id, title: exam.title, created: true, note: '已建一份独立的空试卷；用 editContent({ questions }) 出题，绑到哪份文档拖线决定' }
      }
      // 空壳吸收：画布上拖出的空试卷卡是一份真实实体，出题沿用它的 id 原地变实
      const shell = shellExamOf(store, host.id)
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
        nodeId: host.id,
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

    return { error: 'kind 只能是 doc / outline / note / exam / superdoc（entry 由目标生成）' }
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
      // 游离挂件（剪了线 / 没绑过的）：独立实体，也在导航图上——get(uuid) 照样取、editContent 照样写
      detached: {
        notes: (store.detached?.[goalId]?.notes ?? []).map((n) => ({ uuid: n.id, title: n.name, chars: n.content.length })),
        superdocs: (store.detached?.[goalId]?.superdocs ?? []).map((d) => ({ uuid: d.id, title: d.name, chars: d.html.length })),
        exams: store.exams
          .filter((e) => e.goalId === goalId && !nodeById(store, e.nodeId))
          .map((e) => ({ uuid: e.id, title: e.title, questions: e.questions.length, attempts: e.attempts.length })),
      },
      note: '要动哪个就 const n = await api.node.get(uuid) 取对象；动手前 await n.help() 看它自己怎么说。游离的挂件在 detached 里，拖线 / connect 绑到文档之下。',
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
          '它名下的笔记与超级文档解除绑定、成为独立节点留在画布上，试卷原地悬空（都可以拖线绑到别的文档，或单独删除）',
      }
    }

    if (loc.kind === 'note') {
      // 绑定态走宿主的删除；游离态直接从池子里删（同一个实体，两种住处）
      const found = findNoteEntity(store, loc.noteId)
      if (!found) return { error: '这份笔记已经不在了' }
      if (found.hostId) {
        this.deps.set(deleteNote(store, found.hostId, found.note.name))
      } else {
        const pool = detachedPoolOf(store, found.goalId)
        this.deps.set(withDetached(store, found.goalId, { ...pool, notes: pool.notes.filter((n) => n.id !== loc.noteId) }))
      }
      return { ok: true, note: '已删除笔记「' + found.note.name + '」（开着它的页签会一并关掉）' }
    }

    const sdocFound = findSuperDocEntity(store, loc.sdocId)
    if (!sdocFound) return { error: '这份超级文档已经不在了' }
    if (sdocFound.hostId) {
      this.deps.set(removeSuperDoc(store, sdocFound.hostId, sdocFound.doc.name))
    } else {
      const pool = detachedPoolOf(store, sdocFound.goalId)
      this.deps.set(withDetached(store, sdocFound.goalId, { ...pool, superdocs: pool.superdocs.filter((d) => d.id !== loc.sdocId) }))
    }
    return { ok: true, note: '已删除超级文档「' + sdocFound.doc.name + '」（开着它的页签会一并失效）' }
  }
}
