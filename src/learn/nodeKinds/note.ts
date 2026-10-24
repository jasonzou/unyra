/**
 * 笔记节点：学习者与导师都能写的一份 markdown，一节点可挂多份。
 *
 * uuid 是 NoteFile.id（持久 id，改名不变——页签、坐标、agent 句柄都靠它稳住）。
 * 上游恒为归属它的文档（创建那一刻定下，不能改挂）；叶子，没有下游。
 */
import { nodeById, renameNoteFile, writeNote } from '../graph'
import { notesOf } from '../notes'
import type { KnowledgeNode, NoteFile } from '../types'
import { GNode, type ConnectFilter, type NodeCtx, type NodeHelp, type NodeRelation, type NodeResult } from './base'

export class NoteGNode extends GNode {
  private readonly ownerDocId: string

  constructor(ctx: NodeCtx, uuid: string, ownerDocId: string) {
    super(ctx, uuid)
    this.ownerDocId = ownerDocId
  }

  get kind(): 'note' {
    return 'note'
  }

  protected get kindLabel(): string {
    return '笔记'
  }

  private locate(): { node: KnowledgeNode; note: NoteFile } | null {
    const node = nodeById(this.ctx.store(), this.ownerDocId)
    if (!node) return null
    const note = notesOf(node).find((n) => n.id === this.uuid)
    return note ? { node, note } : null
  }

  get title(): string {
    return this.locate()?.note.name ?? this.uuid
  }

  exists(): boolean {
    return !!this.locate()
  }

  get relations(): NodeRelation[] {
    return this.exists() ? [{ id: this.ownerDocId, type: 'up' }] : []
  }

  get content(): unknown {
    const found = this.locate()
    if (!found) return { error: '这份笔记已经不在了（可能刚被删除）' }
    return { title: found.note.name, text: found.note.content }
  }

  editContent(next: unknown): NodeResult {
    const found = this.locate()
    if (!found) return { error: '这份笔记已经不在了（可能刚被删除）' }
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return { error: '笔记内容是 { title?, text } 对象；text 是整份 markdown 正文' }
    }
    const o = next as Record<string, unknown>
    if (typeof o.text !== 'string') return { error: 'text 必给（整份正文，没有内容就给空串 ""）' }
    let s = this.ctx.store()
    let name = found.note.name
    if (typeof o.title === 'string' && o.title.trim() && o.title.trim() !== name) {
      const r = renameNoteFile(s, this.ownerDocId, name, o.title.trim())
      if (!r.name) return { error: '改名没有成功（这个名字可能不合法）' }
      s = r.store
      name = r.name
    }
    this.ctx.commit(writeNote(s, this.ownerDocId, name, o.text))
    return { ok: true, note: '已写入笔记「' + name + '」：' + o.text.length + ' 字' }
  }

  help(): NodeHelp {
    const found = this.locate()
    return {
      description:
        '笔记节点——「' + (found?.note.name ?? '？') + '」，挂在文档「' + (found?.node.title ?? '？') + '」下。' +
        (found ? (found.note.content.trim() ? '现有 ' + found.note.content.length + ' 字。' : '还是空的。') : ''),
      edit: [
        '笔记是**学习者的东西**：动笔前 await n.content 读一遍，再 editContent({ text }) 整份写回，严禁覆盖学习者已有的内容；整理类任务以合并、追加为主。',
        'title 可选（改名要谨慎——那是学习者起的名字）；text 必给，是整份 markdown。',
      ].join('\n'),
      connection: '上游恒为归属文档（创建那一刻定下，不能改挂）；笔记是叶子，没有下游。',
    }
  }

  onUpstream(_node: GNode): ConnectFilter {
    return '笔记归属创建它的文档节点，不能改挂；要在别的文档下建笔记，用 api.node.create({ kind: "note", under: 那个文档的 uuid })'
  }
}
