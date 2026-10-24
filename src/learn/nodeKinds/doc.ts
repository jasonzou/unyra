/**
 * 文档：教学正文，同时是**把子树接上去的连接件**。
 *
 * 它能连四种东西：自己的大纲（先文档再大纲）、笔记、试卷、超级文档。
 * 这一条 `targets` 就是原来 `GRAPH_EDGE_RULES.doc` 的全部内容。
 *
 * 节点对象（api.node(path)）默认取到的就是它（教学面）：一套文本读写，
 * 外加三个聚合取法——note / outline / superdoc 都从文档节点出发。
 */
import { textMethods, type NodeKindSpec } from './base'
import { TextHandle, type HandleContext } from './handle'
import { NoteHandle } from './note'
import { OutlineHandle } from './outline'
import { SuperdocHandle } from './superdoc'

export const docKind: NodeKindSpec = {
  type: 'doc',
  label: '文档',
  rank: 1,
  targets: ['outline', 'note', 'exam', 'superdoc'],
  format: 'markdown',
  singleton: true,
  anchor: true,
  facet: { label: '文档' },
  methods: [
    ...textMethods('教学文档'),
    {
      name: 'note',
      signature: 'note(名字?)',
      summary: '取一份笔记的节点对象（省略名字 = 第一份；写一份不存在的笔记时 write 会新建）',
      returnsNode: true,
      example: "const note = await n.note('错题本'); await note.write('第一道错题')",
    },
    {
      name: 'outline',
      signature: 'outline()',
      summary: '取大纲节点对象（write 收 { intro, children }，整份覆盖、只写直接子层级一层）',
      returnsNode: true,
      example: "const o = await n.outline(); await o.write({ intro: '先补前置', children: [{ title: '夹逼定理', summary: '两个边界函数' }] })",
    },
    {
      name: 'superdoc',
      signature: 'superdoc(名字)',
      summary: '取一份超级文档的节点对象（write 收完整自包含 HTML，同名覆盖）',
      returnsNode: true,
      example: "const lab = await n.superdoc('夹逼实验'); await lab.write('<!doctype html>…')",
    },
  ],
}

/** 文档节点（知识节点的教学面）：文本读写 + 聚合取该节点的其它内容对象 */
export class DocHandle extends TextHandle {
  constructor(ctx: HandleContext, nodeId: string, baseLabel: string) {
    super(ctx, nodeId, baseLabel, 'teaching', undefined)
  }
  get kind(): string {
    return 'doc'
  }
  /** 一份笔记；名字省略 = 第一份（与 path 寻址的「极限/笔记」同一语义） */
  async note(name?: string): Promise<NoteHandle> {
    return new NoteHandle(this.ctx, this.nodeId, this.baseLabel, typeof name === 'string' && name.trim() ? name.trim() : undefined)
  }
  async outline(): Promise<OutlineHandle | { error: string }> {
    if (!this.ctx.outline) return { error: '这一轮没有大纲能力（宿主未注入 outline）' }
    return new OutlineHandle(this.ctx, this.nodeId, this.baseLabel)
  }
  async superdoc(name: string): Promise<SuperdocHandle | { error: string }> {
    if (!this.ctx.superdocs) return { error: '这一轮没有超级文档能力（宿主未注入 superdocs）' }
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) return { error: '超级文档要带名字：superdoc("实验名")' }
    return new SuperdocHandle(this.ctx, this.nodeId, this.baseLabel, trimmed)
  }
}
