/**
 * 大纲：一个节点的一份结构化计划（intro + 直接目标项一层 children）。
 *
 * 只连文档——「大纲的父子节点只能是文档」（2026-10-21 用户定的拓扑）。
 */
import type { NodeKindSpec } from './base'
import { NodeHandle, type HandleContext } from './handle'

export const outlineKind: NodeKindSpec = {
  type: 'outline',
  label: '大纲',
  rank: 0,
  targets: ['doc'],
  format: 'json',
  singleton: true,
  facet: { label: '大纲' },
  methods: [
    { name: 'read', signature: 'read()', summary: '读大纲对象（{ intro, children }；还没写过回 null，那不是错误）', example: 'const plan = await o.read()' },
    {
      name: 'write',
      signature: 'write({ intro, children })',
      summary: '整份写大纲（也收合法 JSON 字符串）',
      usage: 'children 每项 { title, summary }，key 由标题自动生成，不要自己编；最多 24 条，只写直接子层级一层。',
      example: "await o.write({ intro: '先补前置，再进极限。', children: [{ title: '极限', summary: '从数列到函数极限' }] })",
    },
  ],
}

/** 大纲节点：结构化计划，不是 Markdown——read 回对象、write 整份覆盖，没有追加与区间改 */
export class OutlineHandle extends NodeHandle {
  constructor(ctx: HandleContext, nodeId: string, baseLabel: string) {
    super(ctx, nodeId, baseLabel)
  }
  get kind(): string {
    return 'outline'
  }
  get label(): string {
    return this.baseLabel + '/大纲'
  }
  read(): unknown {
    return this.ctx.outline?.read(this.nodeId) ?? null
  }
  write(payload: unknown): unknown {
    if (!this.ctx.outline) return { error: '这一轮没有大纲能力（宿主未注入 outline）' }
    let p = payload
    if (typeof payload === 'string') {
      try {
        p = JSON.parse(payload)
      } catch {
        return { error: '大纲要写成对象：{ intro, children: [{ title, summary }] }（传字符串时必须是合法 JSON）' }
      }
    }
    if (!p || typeof p !== 'object') {
      return { error: '大纲要写成对象：{ intro, children: [{ title, summary }] }' }
    }
    const a = p as Record<string, unknown>
    return this.ctx.outline.write(this.nodeId, { intro: a.intro, children: a.children })
  }
}
