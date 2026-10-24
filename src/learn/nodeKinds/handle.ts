/**
 * 节点对象的行为层：基类 + 文本能力中间层。
 *
 * ## 为什么要有这层
 *
 * 以前「往一份内容里写东西」的知识散在沙箱 api 层的四个组里（doc / outline /
 * sdoc / content），各组自己解析 part、自己分发到存储原语——每加一种内容形态，
 * api 层就要再抄一遍「认地址 → 分发 → 组回执」。现在**读写行为收进类型本身**：
 * 每个内容类型一个子类（doc / note / outline / superdoc，与各自的登记项同文件），
 * api 层只剩一件事：解析地址 → 实例化节点对象 → 调成员方法。多态由类层次表达——
 * 正文与笔记是同一套文本方法（TextHandle），大纲与超级文档各自覆写 write 的语义。
 *
 * ## 与存储的边界
 *
 * 这里只做**分发与语义**（一份内容该怎么读、怎么写、哪些操作对它无意义），
 * 校验与落盘全在存储原语（HandleContext.doc / outline / superdocs）里——
 * 与沙箱装配层（agent/sandbox）注入的 ops 是同一批函数。下面的接口按**结构**
 * 声明最小面，不 import agent 侧的任何东西：nodeKinds 保持只依赖自己。
 */

/** 正文与笔记的存储原语（ receipts 由实现层产出，这里只分发） */
export interface HandleDocOps {
  read: (nodeId: string, kind: 'teaching' | 'note', note?: string) => string
  write: (nodeId: string, kind: 'teaching' | 'note', note: string | undefined, content: string) => unknown
  append: (nodeId: string, kind: 'teaching' | 'note', note: string | undefined, content: string) => unknown
  replace: (
    nodeId: string,
    kind: 'teaching' | 'note',
    note: string | undefined,
    range: { start?: number; end?: number; content: string; expected?: string },
  ) => unknown
}

/** 实例化一个节点对象需要的全部宿主能力（沙箱装配层按 opts 现取现给） */
export interface HandleContext {
  doc: HandleDocOps
  outline?: { read: (nodeId: string) => unknown; write: (nodeId: string, input: { intro?: unknown; children?: unknown }) => unknown }
  superdocs?: {
    list: (nodeId: string) => unknown
    read: (nodeId: string, name: string) => unknown
    write: (nodeId: string, name: string | undefined, html: string) => unknown
    remove: (nodeId: string, name: string) => unknown
  }
}

/** 节点对象基类：身份（kind / 地址）由子类给，行为按类型多态 */
export abstract class NodeHandle {
  protected ctx: HandleContext
  protected nodeId: string
  protected baseLabel: string
  constructor(ctx: HandleContext, nodeId: string, baseLabel: string) {
    this.ctx = ctx
    this.nodeId = nodeId
    this.baseLabel = baseLabel
  }
  /** 类型登记表的键（doc / note / outline / superdoc） */
  abstract get kind(): string
  /** 这份内容的可读地址（如 '微积分/极限' 或 '微积分/极限/笔记/错题本'） */
  abstract get label(): string
  get id(): string {
    return this.nodeId
  }
  /** 这份内容的名字（笔记名 / 超级文档名）；没名字的形态回 undefined——通道层据此组 manifest */
  get contentName(): string | undefined {
    return undefined
  }
}

/**
 * 正文与笔记共用的文本读写：同一套方法（api 层曾经的 doc.* 六件套原样搬进来），
 * 差异只有 docKind 与笔记名。回执形状保持与旧 api 一致——api 层的旧组
 * （doc.* / content.*）现在是这层之上的薄适配，行为不该有任何漂移。
 */
export abstract class TextHandle extends NodeHandle {
  protected docKind: 'teaching' | 'note'
  protected noteName: string | undefined
  constructor(ctx: HandleContext, nodeId: string, baseLabel: string, docKind: 'teaching' | 'note', noteName: string | undefined) {
    super(ctx, nodeId, baseLabel)
    this.docKind = docKind
    this.noteName = noteName
  }

  /**
   * 这份内容的可读地址（与 docPathOf 同一口径：正文是「路径/教学」，笔记是「路径/笔记/名字」）。
   * 回执里的 path 用它——模型据此知道刚才动的是哪一份。
   */
  get label(): string {
    return this.docKind === 'note'
      ? this.baseLabel + '/笔记' + (this.noteName ? '/' + this.noteName : '')
      : this.baseLabel + '/教学'
  }

  get contentName(): string | undefined {
    return this.docKind === 'note' ? this.noteName : undefined
  }

  read(): { path: string; chars: number; content: string } {
    const content = this.ctx.doc.read(this.nodeId, this.docKind, this.noteName)
    return { path: this.label, chars: content.length, content }
  }

  readRange(start = 0, end?: number): { path: string; text: string; start: number; end: number; total: number } {
    const content = this.ctx.doc.read(this.nodeId, this.docKind, this.noteName)
    const from = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0
    const to = end === undefined ? Math.min(content.length, from + 1500) : Math.min(Math.max(from, Math.floor(end)), content.length)
    return { path: this.label, text: content.slice(from, to), start: from, end: to, total: content.length }
  }

  find(needle: string, opt?: { from?: number; limit?: number }): unknown {
    if (!needle) return { error: '要找的内容为空' }
    const content = this.ctx.doc.read(this.nodeId, this.docKind, this.noteName)
    const from = opt?.from ?? 0
    const limit = Math.min(opt?.limit ?? 10, 50)
    const hits: Array<{ start: number; end: number; around: string }> = []
    let idx = content.indexOf(needle, from)
    while (idx >= 0 && hits.length < limit) {
      hits.push({
        start: idx,
        end: idx + needle.length,
        around: content.slice(Math.max(0, idx - 40), Math.min(content.length, idx + needle.length + 40)),
      })
      idx = content.indexOf(needle, idx + Math.max(1, needle.length))
    }
    return { path: this.label, query: needle, total: content.length, matches: hits.length, hits }
  }

  write(body: string): unknown {
    return this.ctx.doc.write(this.nodeId, this.docKind, this.noteName, typeof body === 'string' ? body : String(body ?? ''))
  }

  append(body: string): unknown {
    return this.ctx.doc.append(this.nodeId, this.docKind, this.noteName, typeof body === 'string' ? body : String(body ?? ''))
  }

  replace(range: { start?: number; end?: number; content: string; expected?: string }): unknown {
    return this.ctx.doc.replace(this.nodeId, this.docKind, this.noteName, {
      start: range?.start,
      end: range?.end,
      content: typeof range?.content === 'string' ? range.content : String(range?.content ?? ''),
      expected: typeof range?.expected === 'string' ? range.expected : undefined,
    })
  }
}
