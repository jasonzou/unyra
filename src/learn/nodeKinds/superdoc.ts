/**
 * 超级文档节点：一整份可交互 HTML（讲义、演示、小工具）。叶子，上游恒为归属文档。
 *
 * uuid 是 SuperDocFile.id（持久 id；名字是显示与页签身份，不随 uuid 变）。
 * write 语义：整份覆盖、空内容拒绝、超长拒绝。
 */
import { nodeById } from '../graph'
import { SUPERDOC_MAX_CHARS, writeSuperDoc } from '../superdocs'
import { superDocsOf, type KnowledgeNode, type SuperDocFile } from '../types'
import { GNode, type NodeCtx, type NodeHelp, type NodeRelation, type NodeResult } from './base'

export class SuperdocGNode extends GNode {
  private readonly ownerDocId: string

  constructor(ctx: NodeCtx, uuid: string, ownerDocId: string) {
    super(ctx, uuid)
    this.ownerDocId = ownerDocId
  }

  get kind(): 'superdoc' {
    return 'superdoc'
  }

  protected get kindLabel(): string {
    return '超级文档'
  }

  private locate(): { node: KnowledgeNode; doc: SuperDocFile } | null {
    const node = nodeById(this.ctx.store(), this.ownerDocId)
    if (!node) return null
    const doc = superDocsOf(node).find((d) => d.id === this.uuid)
    return doc ? { node, doc } : null
  }

  get title(): string {
    return this.locate()?.doc.name ?? this.uuid
  }

  exists(): boolean {
    return !!this.locate()
  }

  get relations(): NodeRelation[] {
    return this.exists() ? [{ id: this.ownerDocId, type: 'up' }] : []
  }

  get content(): unknown {
    const found = this.locate()
    if (!found) return { error: '这份超级文档已经不在了（可能刚被删除）' }
    return { title: found.doc.name, html: found.doc.html }
  }

  editContent(next: unknown): NodeResult {
    const found = this.locate()
    if (!found) return { error: '这份超级文档已经不在了（可能刚被删除）' }
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return { error: '超级文档内容是 { html } 对象（一份完整的自包含 HTML）' }
    }
    const o = next as Record<string, unknown>
    if (typeof o.title === 'string' && o.title.trim() && o.title.trim() !== found.doc.name) {
      return { error: '超级文档不支持改名（名字是页签与身份的一半）；要新名字就 create 一份新的，把内容搬过去' }
    }
    if (typeof o.html !== 'string') return { error: 'html 必给：一份完整的 HTML（按钮、样式、脚本都在里面）' }
    if (!o.html.trim()) return { error: '内容为空：editContent 需要一份完整的 HTML' }
    if (o.html.length > SUPERDOC_MAX_CHARS) {
      return { error: '超级文档最长 ' + SUPERDOC_MAX_CHARS + ' 字符（收到 ' + o.html.length + '）；拆成几份或把重逻辑挪进 method 函数' }
    }
    const nextStore = writeSuperDoc(this.ctx.store(), this.ownerDocId, found.doc.name, o.html)
    if (!nextStore) return { error: '写入失败：归属的文档节点已经不在了' }
    this.ctx.commit(nextStore)
    return {
      ok: true,
      note:
        '已覆盖更新「' + found.doc.name + '」（' + o.html.length + ' 字符）。打开给用户：api.ui.superdoc("' +
        this.ownerDocId + '", "' + found.doc.name + '")',
    }
  }

  help(): NodeHelp {
    const found = this.locate()
    return {
      description:
        '超级文档节点——「' + (found?.doc.name ?? '？') + '」，挂在文档「' + (found?.node.title ?? '？') + '」下。' +
        (found ? (found.doc.html.trim() ? '现有 ' + found.doc.html.length + ' 字符。' : '还是空的（一份壳）。') : ''),
      edit: [
        'await n.content 读源码 → 改 → await n.editContent({ html }) 整份覆盖（自包含单页：结构、<style>、<script> 都在这一份里）。',
        '主题变量自适应深浅色：var(--color-bg) / --color-sunken / --color-surface、--color-ink / --ink-strong / --ink-soft、--color-seal / --line / --warn / --success。',
        '富文本用 <moji-markdown>…</moji-markdown>（宿主解析 Markdown 与 LaTeX）；页面里的按钮调 window.api.method.call("函数名", ...args) 执行持久化函数（先 api.method.create 存好）。',
        '内置跳转协议：静态资源 moji:static/{uuid}、超级文档互跳 moji:super/{name}、节点跳转 moji:node/{nodeId}。',
        '上限 ' + SUPERDOC_MAX_CHARS + ' 字符；写完用 api.ui.superdoc 打开给用户看。',
      ].join('\n'),
      connection: '上游恒为归属文档（创建那一刻定下，不能改挂）；超级文档是叶子，没有下游。',
    }
  }
}
