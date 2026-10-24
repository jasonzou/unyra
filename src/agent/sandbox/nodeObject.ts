/**
 * 节点对象通道：`api.node(地址)` 取「节点对象」，对象上的成员方法按类型多态分发。
 *
 * ## 分层
 *
 * - 行为在类型里（learn/nodeKinds 的 NodeHandle 子类：doc / note / outline / superdoc）；
 * - 这里只做三件事：**解析地址**（字符串沿用 path 语法，对象显式给 node+part）、
 *   **出清单**（node.get → manifest：身份 + 该类型的方法表，来自登记表声明）、
 *   **代调用**（node.invoke → 实例化节点对象、按声明校验方法名、调它）；
 * - 传输就这两条 api。沙箱两侧各有一层门面把 manifest 包成真的 JS 对象
 *   （真沙箱在 sandboxRuntime.js，进程内直调在 buildApi 末尾调 attachNodeFacade），
 *   模型看到与写到的就是 `const n = await api.node('极限'); await n.write(…)`。
 *
 * manifest 的 target 按**节点 id**（#id）回带：编排中途改了名也不失效。
 */
import {
  NODE_HANDLES,
  kindSpec,
  methodDocOf,
  type GraphKind,
  type HandleContext,
  type HandleKind,
  type NodeHandle,
  type NodeMethodDoc,
} from '../../learn/nodeKinds'
import { NodeHandle as NodeHandleBase } from '../../learn/nodeKinds/handle'
import { asRecord } from './refs'
import type { SandboxOptions } from './types'
import { wrapApi } from './wrap'

/** 一份内容的位置：node.get / node.invoke 与旧 content.* 共用的解析结果 */
export interface ContentTarget {
  nodeId: string
  /** teaching / note / outline / superdoc */
  part: string
  /** 笔记或超级文档的名字 */
  name?: string
  /** 知识节点的路径标签（receipts 与 manifest 里的地址基准） */
  baseLabel: string
}

/**
 * 认地址（原 api.ts 的 partTarget 原样搬来）：字符串沿用 path 语法
 * （'极限/笔记/错题本'），对象显式给 node + part。api.node() 省略 = 当前节点的正文。
 */
export function contentTarget(
  opts: Pick<SandboxOptions, 'resolveDoc' | 'resolveNode'>,
  arg: unknown,
): { ok: true; t: ContentTarget } | { ok: false; error: string } {
  if (arg === undefined || typeof arg === 'string') {
    const r = opts.resolveDoc(arg ?? '')
    if (!r.ok) return { ok: false, error: r.message }
    if (r.ref.kind === 'note') {
      return {
        ok: true,
        t: { nodeId: r.ref.id, baseLabel: r.ref.label, part: 'note', ...(r.ref.note ? { name: r.ref.note } : {}) },
      }
    }
    return { ok: true, t: { nodeId: r.ref.id, baseLabel: r.ref.label, part: 'teaching' } }
  }
  const o = asRecord(arg)
  const path = typeof o.node === 'string' ? o.node : typeof o.path === 'string' ? o.path : ''
  const r = opts.resolveNode(path)
  if (!r.ok) return { ok: false, error: r.message }
  const raw = typeof o.part === 'string' && o.part.trim() ? o.part.trim() : 'teaching'
  const cut = raw.indexOf(':')
  const part = cut < 0 ? raw : raw.slice(0, cut)
  const fromSuffix = cut < 0 ? undefined : raw.slice(cut + 1).trim() || undefined
  const name = fromSuffix ?? (typeof o.name === 'string' && o.name.trim() ? o.name.trim() : undefined)
  return { ok: true, t: { nodeId: r.ref.id, baseLabel: r.ref.label, part, ...(name ? { name } : {}) } }
}

const KIND_OF_PART: Record<string, HandleKind> = {
  teaching: 'doc',
  note: 'note',
  outline: 'outline',
  superdoc: 'superdoc',
}

/** 实例化节点对象：part → 类型 → 行为类（大纲 / 超级文档先查能力注入） */
export function handleFor(ctx: HandleContext, t: ContentTarget): NodeHandle | { error: string } {
  const kind = KIND_OF_PART[t.part]
  if (t.part === 'exam') {
    return { error: '试卷用 exam.*（出卷 exam.create / 读卷 exam.read / 判分 exam.grade）；content.* 与节点对象不管试卷' }
  }
  if (!kind) {
    return { error: `不认识的 part：「${t.part}」。可用：正文（省略）/ note:<名字> / outline / superdoc:<名字>` }
  }
  if (kind === 'outline' && !ctx.outline) return { error: '这一轮没有大纲能力（宿主未注入 outline）' }
  if (kind === 'superdoc') {
    if (!ctx.superdocs) return { error: '这一轮没有超级文档能力（宿主未注入 superdocs）' }
    if (!t.name) return { error: '超级文档要带名字：part 写 "superdoc:讲义"（或 api.node(路径).superdoc("讲义")）' }
  }
  const ctor = NODE_HANDLES[kind]
  return new ctor(ctx, t.nodeId, t.baseLabel, t.name)
}

/** 节点对象的清单（node.get 的回执；manifest 自身也是聚合方法回给门面的标记形状） */
export interface NodeManifest {
  ok: true
  /** 这是另一个节点对象（沙箱门面据此再包一层，见各 returnsNode 的方法声明） */
  object: true
  kind: HandleKind
  id: string
  label: string
  part: string
  name?: string
  /** 之后 node.invoke 原样带回的地址（按 #id 寻址，改名不失效） */
  target: { node: string; part: string; name?: string }
  methods: NodeMethodDoc[]
}

export function isManifest(v: unknown): v is NodeManifest {
  return !!v && typeof v === 'object' && (v as { object?: unknown }).object === true && Array.isArray((v as { methods?: unknown }).methods)
}

function manifestOf(t: ContentTarget, h: NodeHandle): NodeManifest {
  const methods = kindSpec(h.kind as GraphKind).methods ?? []
  return {
    ok: true,
    object: true,
    kind: h.kind as HandleKind,
    id: t.nodeId,
    label: h.label,
    part: t.part,
    ...(t.name ? { name: t.name } : {}),
    target: { node: '#' + t.nodeId, part: t.part, ...(t.name ? { name: t.name } : {}) },
    methods: [...methods],
  }
}

/**
 * 注册 node.get / node.invoke 并挂上门面。ctx 的存储原语按调用现取（不持有快照），
 * 与 api.ts 其余各组同一条纪律。
 */
export function registerNodeObjectApi(
  api: Record<string, unknown>,
  opts: Pick<SandboxOptions, 'resolveDoc' | 'resolveNode' | 'docOps' | 'outline' | 'superdocs'>,
  log: Parameters<typeof wrapApi>[3],
  handleCtx: () => HandleContext,
): void {
  wrapApi(api, 'node.get', (args) => {
    const r = contentTarget(opts, args[0])
    if (!r.ok) return { error: r.error }
    const h = handleFor(handleCtx(), r.t)
    if ('error' in h) return { error: h.error }
    return manifestOf(r.t, h)
  }, log)

  wrapApi(api, 'node.invoke', async (args) => {
    const [targetArg, methodRaw, rest] = args
    const r = contentTarget(opts, targetArg)
    if (!r.ok) return { error: r.error }
    const h = handleFor(handleCtx(), r.t)
    if ('error' in h) return { error: h.error }
    const method = typeof methodRaw === 'string' ? methodRaw.trim() : ''
    const doc = methodDocOf(h.kind as GraphKind, method)
    if (!doc || method === 'help') {
      const names = (kindSpec(h.kind as GraphKind).methods ?? []).map((m) => m.name).join(' / ')
      return {
        error: `「${h.label}」这种节点没有 ${method || '(空)'} 这个方法。它可用：${names || '（这个类型没有开放方法）'}——对象上 n.help() 也能看。`,
      }
    }
    const fn = (h as unknown as Record<string, unknown>)[method]
    if (typeof fn !== 'function') return { error: `「${h.label}」的 ${method} 没有实现（登记了但行为类缺方法），这是宿主的 bug` }
    // 聚合方法（note / outline / superdoc）回的是另一个节点对象 → 转成 manifest，由门面再包。
    // 必须以成员访问的形式调（h.method(...)）：把方法摘下来裸调会丢 this，读到 undefined.ctx
    const value = await (h as unknown as Record<string, (...a: unknown[]) => unknown>)[method](
      ...(Array.isArray(rest) ? rest : []),
    )
    if (value instanceof NodeHandleBase) {
      const sub: ContentTarget = {
        nodeId: value.id,
        baseLabel: '',
        part: value.kind === 'doc' ? 'teaching' : value.kind,
        ...(value.contentName ? { name: value.contentName } : {}),
      }
      return manifestOf(sub, value)
    }
    return value
  }, log)
}

/** 节点对象上的 help() 正文：manifest 的方法表排版（同步返回，不花宿主往返） */
export function renderObjectHelp(m: NodeManifest): string {
  const lines = ['「' + m.label + '」（' + kindSpec(m.kind as GraphKind).label + '）的成员方法：']
  for (const d of m.methods) {
    lines.push('- ' + d.signature + ' — ' + d.summary + (d.example ? '\n  示例：' + d.example : ''))
  }
  lines.push('', '地址：api.node(\'' + m.label + '\')；换一份内容从文档节点出发（n.note / n.outline / n.superdoc）。')
  return lines.join('\n')
}

/**
 * 进程内门面（测试探针 / 超级文档桥那条直调通道）：把 manifest 包成真对象，
 * 方法调用走 node.invoke（保持记账与失败清单）。真沙箱的门面在 sandboxRuntime.js，
 * 两边行为必须一致。
 */
export function attachNodeFacade(api: Record<string, unknown>): void {
  const ns = api.node as
    | { get: (t: unknown) => Promise<unknown>; invoke: (t: unknown, m: string, a: unknown[]) => Promise<unknown>; __help?: () => string }
    | undefined
  if (!ns || typeof ns.get !== 'function') return
  const wrapManifest = (m: NodeManifest): Record<string, unknown> => {
    const obj: Record<string, unknown> = { kind: m.kind, id: m.id, label: m.label }
    for (const d of m.methods) {
      obj[d.name] = (...callArgs: unknown[]) =>
        Promise.resolve(ns.invoke(m.target, d.name, callArgs)).then((v) => (isManifest(v) ? wrapManifest(v) : v))
    }
    obj.help = () => renderObjectHelp(m)
    return obj
  }
  const factory = async (target?: unknown, part?: unknown): Promise<unknown> => {
    const arg =
      target && typeof target === 'object'
        ? target
        : { node: target ?? '', ...(part !== undefined ? { part: String(part) } : {}) }
    const m = await ns.get(arg)
    return isManifest(m) ? wrapManifest(m) : m
  }
  Object.assign(factory, ns)
  api.node = factory
}
