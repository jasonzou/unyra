/** 超级文档：一整份可交互 HTML（讲义、演示、小工具）。叶子，不再往下连。 */
import type { NodeKindSpec } from './base'
import { NodeHandle, type HandleContext } from './handle'

export const superdocKind: NodeKindSpec = {
  type: 'superdoc',
  label: '超级文档',
  rank: 2,
  targets: [],
  format: 'html',
  facet: { label: '超级文档' },
  methods: [
    { name: 'read', signature: 'read()', summary: '读这份超级文档的源码（完整 HTML）', example: 'const html = await lab.read()' },
    { name: 'write', signature: 'write(html)', summary: '整份写入（自包含单页 HTML；同名覆盖）', example: "await lab.write('<!doctype html><html>…</html>')" },
    { name: 'remove', signature: 'remove()', summary: '删这一份（不可逆）', example: 'await lab.remove()' },
  ],
}

/** 超级文档节点：read 回源码、write 整份覆盖、remove 可删——没有文本追加与区间改 */
export class SuperdocHandle extends NodeHandle {
  protected name: string | undefined
  constructor(ctx: HandleContext, nodeId: string, baseLabel: string, name?: string) {
    super(ctx, nodeId, baseLabel)
    this.name = typeof name === 'string' && name.trim() ? name.trim() : undefined
  }
  get kind(): string {
    return 'superdoc'
  }
  get label(): string {
    return this.baseLabel + '/超级文档/' + (this.name ?? '')
  }
  get contentName(): string | undefined {
    return this.name
  }
  read(): unknown {
    if (!this.name) return { error: '超级文档要带名字：api.node(路径).superdoc("实验名")' }
    return this.ctx.superdocs?.read(this.nodeId, this.name)
  }
  write(html: string): unknown {
    if (!this.name) return { error: '超级文档要带名字：api.node(路径).superdoc("实验名")' }
    return this.ctx.superdocs?.write(this.nodeId, this.name, typeof html === 'string' ? html : String(html ?? ''))
  }
  remove(): unknown {
    if (!this.name) return { error: '超级文档要带名字：api.node(路径).superdoc("实验名")' }
    return this.ctx.superdocs?.remove(this.nodeId, this.name)
  }
}
