/**
 * 资源归纳节点（终端节点）：
 * 类似于大纲节点可以有列表项，但不能有下游连接，点击列表项打开相应的资源。
 * 例如在视频大纲场景下，大纲的终端节点为资源归纳节点，用来跳转相应的视频选集。
 */
import { removeEdge } from '../graph'
import type { ResourceNodeEntity } from '../types'
import {
  GNode,
  idOfResourceUuid,
  type ConnectFilter,
  type NodeCtx,
  type NodeHelp,
  type NodePort,
  type NodeRelation,
  type NodeResult,
} from './base'

export class ResourceGNode extends GNode {
  constructor(ctx: NodeCtx, uuid: string) {
    super(ctx, uuid)
  }

  get kind(): 'resource' {
    return 'resource'
  }

  protected get kindLabel(): string {
    return '资源归纳'
  }

  get entityId(): string {
    return idOfResourceUuid(this.uuid)
  }

  /** 身后的记录（store.resourceNodes 表里的一项） */
  private get entity(): ResourceNodeEntity | undefined {
    return this.ctx.store().resourceNodes?.find((r) => r.id === this.entityId)
  }

  get title(): string {
    const e = this.entity
    if (!e) return '资源归纳 · 已不在'
    return e.title ? `${e.title} · 资源归纳` : '资源归纳'
  }

  exists(): boolean {
    return !!this.entity
  }

  get relations(): NodeRelation[] {
    const s = this.ctx.store()
    const rels: NodeRelation[] = []
    // 上游：连向本资源归纳节点的大纲边
    for (const e of s.edges) {
      if (e.to === this.uuid) {
        const upId = e.from.startsWith('o:') ? e.from : 'o:' + e.from
        rels.push({ id: upId, type: 'up', ...(e.portKey ? { portKey: e.portKey } : {}) })
      }
    }
    // 下游：终端节点，恒为空
    return rels
  }

  /** 固定接口：每个列表项对应一个接口 */
  get ports(): NodePort[] {
    const e = this.entity
    const items = e?.items ?? []
    return items.map((it) => ({
      key: it.key,
      label: it.title,
      data: { kind: it.kind, target: it.target, ...(it.data ?? {}) },
    }))
  }

  get content(): unknown {
    const e = this.entity
    if (!e) return null
    return {
      id: e.id,
      goalId: e.goalId,
      title: e.title,
      intro: e.intro,
      items: e.items,
      updatedAt: e.updatedAt,
    }
  }

  editContent(next: unknown): NodeResult {
    const e = this.entity
    if (!e) return { error: '这个资源归纳节点已经不在了' }
    let p = next
    if (typeof next === 'string') {
      try {
        p = JSON.parse(next)
      } catch {
        return { error: '资源归纳节点的内容需为合法 JSON 对象' }
      }
    }
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return { error: '资源归纳节点的内容格式应为 { title?, intro?, items: [...] }' }
    }
    const input = p as Record<string, unknown>
    const nextTitle = typeof input.title === 'string' ? input.title.trim() : e.title
    const nextIntro = typeof input.intro === 'string' ? input.intro.trim() : e.intro

    let nextItems = e.items
    if (Array.isArray(input.items)) {
      nextItems = (input.items as unknown[]).map((raw, idx) => {
        if (typeof raw === 'string') {
          return { key: `item-${idx + 1}`, title: raw.trim(), kind: 'video' }
        }
        const itemObj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
        const title = typeof itemObj.title === 'string' ? itemObj.title.trim() : `选集 ${idx + 1}`
        const key = typeof itemObj.key === 'string' && itemObj.key ? itemObj.key : `k-${idx + 1}`
        const kind = (itemObj.kind === 'doc' || itemObj.kind === 'link' || itemObj.kind === 'video' ? itemObj.kind : 'video') as 'video' | 'doc' | 'link'
        const target = typeof itemObj.target === 'string' ? itemObj.target : undefined
        const data = itemObj.data && typeof itemObj.data === 'object' ? (itemObj.data as Record<string, unknown>) : undefined
        return { key, title, kind, target, data }
      })
    }

    const nextEntity: ResourceNodeEntity = {
      ...e,
      title: nextTitle || e.title,
      intro: nextIntro,
      items: nextItems,
      updatedAt: Date.now(),
    }

    const s = this.ctx.store()
    const resourceNodes = (s.resourceNodes ?? []).map((r) => (r.id === e.id ? nextEntity : r))
    this.ctx.commit({ ...s, resourceNodes })
    return { ok: true, note: `已更新资源归纳节点「${nextEntity.title}」（含 ${nextItems.length} 个资源项）` }
  }

  help(): NodeHelp {
    const e = this.entity
    return {
      description: `资源归纳节点——归纳聚合具体资源项（如视频选集），作为大纲树的终端节点，支持点击跳转对应资源。${e ? `现有 ${e.items.length} 个资源项。` : ''}`,
      edit: '内容形状：{ title?, intro?, items: [{ key?, title, kind?: "video", target?: videoId, data?: { source, page } }] }。\nawait n.editContent(...) 可整份修改标题与条目列表。',
      connection: '只能作为大纲节点的下游挂载（上游必须为大纲节点）；不能有任何下游（终端节点，连接下游一律拒绝）。',
    }
  }

  onUpstream(node: GNode): ConnectFilter {
    if (node.kind === 'outline') return true
    return '资源归纳节点的上游必须是大纲节点'
  }

  onDownstream(_node: GNode): ConnectFilter {
    return '资源归纳节点是终端节点，不能有下游连接'
  }

  protected link(_down: GNode, _portKey?: string): NodeResult {
    return { error: '资源归纳节点是终端节点，不能连接下游' }
  }

  protected unlink(target: GNode): NodeResult {
    // 拆掉来自上游大纲的树边
    const s = this.ctx.store()
    const edge = s.edges.find((e) => e.to === this.uuid && (e.from === target.uuid || e.from === target.uuid.replace(/^o:/, '')))
    if (edge) {
      this.ctx.commit(removeEdge(s, edge.from, this.uuid))
      return { ok: true, note: `已从「${target.title}」摘下资源归纳节点「${this.title}」` }
    }
    return { error: '没有连着这个上游' }
  }

  deleteSelf(): NodeResult {
    const e = this.entity
    if (!e) return { error: '这个资源归纳节点已经不在了' }
    const s = this.ctx.store()
    // 摘掉所有连向它的边
    const nextEdges = s.edges.filter((edge) => edge.to !== this.uuid)
    const nextResourceNodes = (s.resourceNodes ?? []).filter((r) => r.id !== e.id)
    this.ctx.commit({ ...s, edges: nextEdges, resourceNodes: nextResourceNodes })
    return { ok: true, note: `已删除资源归纳节点「${e.title}」` }
  }
}
