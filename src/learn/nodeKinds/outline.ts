/**
 * 大纲节点：一份结构化计划（intro + 直接子目标一层 children）。
 *
 * uuid 是 `o:{宿主文档id}`，与文档一对一、同时创建。它只和文档相连：
 * 上游恒为宿主文档（自动），下游是落地目标项的子文档——**这是全图上唯一可手工
 * 建立的连接**（link 落成一条 store.edges 树边），断开即拆掉那条父线。
 */
import { addEdge, nodeById, prereqIds, removeEdge } from '../graph'
import { writeOutline } from '../outline'
import { docIdOfOutlineUuid, GNode, type ConnectFilter, type NodeCtx, type NodeHelp, type NodeRelation, type NodeResult } from './base'

export class OutlineGNode extends GNode {
  constructor(ctx: NodeCtx, uuid: string) {
    super(ctx, uuid)
  }

  get kind(): 'outline' {
    return 'outline'
  }

  protected get kindLabel(): string {
    return '大纲'
  }

  private get docId(): string {
    return docIdOfOutlineUuid(this.uuid) ?? ''
  }

  private get record() {
    return this.docId ? nodeById(this.ctx.store(), this.docId) : undefined
  }

  get title(): string {
    return (this.record?.title ?? '节点') + ' · 大纲'
  }

  exists(): boolean {
    return !!this.record
  }

  get relations(): NodeRelation[] {
    const s = this.ctx.store()
    if (!this.record) return []
    return [
      { id: this.docId, type: 'up' },
      ...prereqIds(s, this.docId).map((id): NodeRelation => ({ id, type: 'down' })),
    ]
  }

  get content(): unknown {
    return this.record?.outline ?? null
  }

  editContent(next: unknown): NodeResult {
    const node = this.record
    if (!node) return { error: '这份大纲的宿主文档已经不在了' }
    let p = next
    if (typeof next === 'string') {
      try {
        p = JSON.parse(next)
      } catch {
        return { error: '大纲内容是 { intro, children } 对象（传字符串时必须是合法 JSON）' }
      }
    }
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return { error: '大纲内容是 { intro, children } 对象：children 每项 { title, summary }' }
    }
    const r = writeOutline(this.ctx.store(), this.docId, p as Record<string, unknown>, Date.now())
    if (!r.ok) return { error: r.error }
    this.ctx.commit(r.store)
    return {
      ok: true,
      note: '已写入「' + node.title + '」的大纲：' + r.outline.children.length + ' 条目标项（intro ' + r.outline.intro.length + ' 字）',
    }
  }

  help(): NodeHelp {
    const doc = this.record
    const children = doc?.outline?.children ?? []
    return {
      description:
        '大纲节点——「这一层往下怎么学」的计划文件，宿主是文档「' + (doc?.title ?? '？') + '」。' +
        (children.length ? '现有 ' + children.length + ' 条目标项。' : '还没有写过目标项。'),
      edit: [
        '内容形状：{ intro, children }；children 每项 { title, summary }，key 由标题自动生成，不要自己编；最多 24 条。',
        '只写**直接子层级**，一层为止——「爷爷知道儿子的存在，但不知道孙子的存在」；孙辈由子目标自己的大纲负责。',
        '大纲是计划，不是落地：目标项长成文档由学习者在画布上驱动（点目标项挂文档）。写大纲的这一轮不建文档节点。',
        'await n.content 读现状（null = 还没写过）；await n.editContent({ intro, children }) 整份覆盖，有旧的就整份重写，不要追加。',
      ].join('\n'),
      connection: [
        '上游恒为宿主文档（自动，不能手工连）。',
        '下游是文档：await 大纲.connect(文档对象, "down") 把一份文档挂到这一层（它就是那条树边）；disconnect 拆掉。别的东西（笔记 / 试卷 / 超级文档 / 大纲）挂不进来。',
      ].join('\n'),
    }
  }

  onUpstream(_node: GNode): ConnectFilter {
    return '大纲的上游恒为宿主文档（自动连着），不能再挂别的上游'
  }

  onDownstream(node: GNode): ConnectFilter {
    if (node.kind !== 'doc') return '大纲的下游只能是文档（目标项由文档落地）'
    return true
  }

  protected link(down: GNode): NodeResult {
    const r = addEdge(this.ctx.store(), this.docId, down.uuid)
    if (!r.added) {
      return { error: '这条边没能挂上：会成环（「' + down.title + '」已经在「' + this.title + '」的上游里）' }
    }
    this.ctx.commit(r.store)
    return { ok: true, note: '已把文档「' + down.title + '」挂到「' + this.title + '」之下' }
  }

  protected unlink(target: GNode): NodeResult {
    this.ctx.commit(removeEdge(this.ctx.store(), this.docId, target.uuid))
    return { ok: true, note: '已把文档「' + target.title + '」从「' + this.title + '」之下摘出来（它变成了没有上游的游离文档）' }
  }
}
