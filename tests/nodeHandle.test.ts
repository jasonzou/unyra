/**
 * 节点对象架构的对账测试：**声明的方法必须真的存在，存在的行为必须如声明**。
 *
 * 这一层架构的三方契约（见 learn/nodeKinds 的说明）：
 * 1. 类型登记表（NodeKindSpec.methods）声明「这类节点能被调什么」；
 * 2. 行为类（NodeHandle 子类）实现它；
 * 3. 沙箱通道（agent/sandbox/nodeObject）按声明校验方法名再分发。
 *
 * 任何一方漂移都是静默故障：声明了没实现 → agent 调用报「宿主的 bug」；
 * 实现了没声明 → 通道直接拒绝，等于死代码。这里把两个方向都钉死。
 */
import { describe, expect, it } from 'vitest'
import {
  NODE_HANDLES,
  NODE_KINDS,
  GRAPH_KINDS,
  methodDocOf,
  renderKindMethodsTable,
  type HandleContext,
  type GraphKind,
} from '../src/learn/nodeKinds'

/** 记录调用的假存储原语：断言「分发到了谁、带着什么」就靠它 */
function stubCtx(log: string[]): HandleContext {
  return {
    doc: {
      read: (id, kind, note) => {
        log.push(`read:${id}:${kind}:${note ?? ''}`)
        return '正文内容'
      },
      write: (id, kind, note, content) => {
        log.push(`write:${id}:${kind}:${note ?? ''}:${content}`)
        return { ok: true }
      },
      append: (id, kind, note, content) => {
        log.push(`append:${id}:${kind}:${note ?? ''}:${content}`)
        return { ok: true }
      },
      replace: (id, kind, note, range) => {
        log.push(`replace:${id}:${kind}:${note ?? ''}:${range.start ?? ''}-${range.end ?? ''}`)
        return { ok: true }
      },
    },
    outline: {
      read: (id) => {
        log.push(`outline.read:${id}`)
        return { intro: '路线', children: [] }
      },
      write: (id, input) => {
        log.push(`outline.write:${id}`)
        return { ok: true, input }
      },
    },
    superdocs: {
      list: (id) => {
        log.push(`sdoc.list:${id}`)
        return { items: [] }
      },
      read: (id, name) => {
        log.push(`sdoc.read:${id}:${name}`)
        return { ok: true, html: '<html></html>' }
      },
      write: (id, name, html) => {
        log.push(`sdoc.write:${id}:${name}`)
        return { ok: true, name, html }
      },
      remove: (id, name) => {
        log.push(`sdoc.remove:${id}:${name}`)
        return { ok: true }
      },
    },
  }
}

describe('节点对象：声明与实现对账', () => {
  it('声明了 methods 的类型必须有行为类；行为类的键集合与声明完全对齐', () => {
    const withMethods = GRAPH_KINDS.filter((k) => (NODE_KINDS[k].methods?.length ?? 0) > 0)
    expect(withMethods.sort()).toEqual(Object.keys(NODE_HANDLES).sort())
    // 入口与试卷不是内容载体：不声明方法、也没有行为类
    expect(NODE_KINDS.entry.methods).toBeUndefined()
    expect(NODE_KINDS.exam.methods).toBeUndefined()
  })

  it('每条声明的成员方法在行为类实例上真的是函数（漏实现 = 宿主 bug）', () => {
    const log: string[] = []
    const ctx = stubCtx(log)
    for (const [kind, ctor] of Object.entries(NODE_HANDLES)) {
      const h = new ctor(ctx, 'n1', '微积分/极限', '错题本')
      for (const doc of NODE_KINDS[kind as GraphKind].methods ?? []) {
        expect(typeof (h as unknown as Record<string, unknown>)[doc.name], `${kind}.${doc.name}`).toBe('function')
      }
      expect(h.kind).toBe(kind)
    }
  })

  it('多态写入：正文与笔记走同一套文本方法，分发到不同的存储形态', () => {
    const log: string[] = []
    const ctx = stubCtx(log)
    const doc = new NODE_HANDLES.doc(ctx, 'n2', '微积分/极限')
    doc.write('# 讲义')
    doc.append('补一段')
    doc.replace({ expected: '旧句', content: '新句' })
    const note = new NODE_HANDLES.note(ctx, 'n2', '微积分/极限', '错题本')
    note.write('第一题')
    expect(log).toEqual([
      'write:n2:teaching::# 讲义',
      'append:n2:teaching::补一段',
      'replace:n2:teaching::-',
      'write:n2:note:错题本:第一题',
    ])
    expect(doc.label).toBe('微积分/极限/教学')
    expect(note.label).toBe('微积分/极限/笔记/错题本')
  })

  it('大纲对象：write 收对象或合法 JSON 字符串，形状不对给出可改的报错', () => {
    const log: string[] = []
    const ctx = stubCtx(log)
    const o = new NODE_HANDLES.outline(ctx, 'n2', '微积分/极限')
    expect(o.write({ intro: 'i', children: [{ title: 't' }] })).toEqual({
      ok: true,
      input: { intro: 'i', children: [{ title: 't' }] },
    })
    o.write('{"intro":"j","children":[]}')
    expect((o.write('不是 JSON') as { error: string }).error).toContain('大纲要写成对象')
    expect((o.write(42) as { error: string }).error).toContain('大纲要写成对象')
    expect(o.read()).toEqual({ intro: '路线', children: [] })
    expect(log.filter((x) => x.startsWith('outline.write')).length).toBe(2)
  })

  it('超级文档对象：没名字就拒绝动（名字是身份，通道层之外也要守住）', () => {
    const log: string[] = []
    const ctx = stubCtx(log)
    const lab = new NODE_HANDLES.superdoc(ctx, 'n2', '微积分/极限')
    expect((lab.write('<p/>') as { error: string }).error).toContain('要带名字')
    const named = new NODE_HANDLES.superdoc(ctx, 'n2', '微积分/极限', '实验')
    expect((named.write('<p/>') as { ok: boolean }).ok).toBe(true)
    expect(named.label).toBe('微积分/极限/超级文档/实验')
  })

  it('聚合取法：文档节点能取到笔记 / 大纲 / 超级文档对象，能力未注入时给出可读原因', async () => {
    const log: string[] = []
    const ctx = stubCtx(log)
    const doc = new NODE_HANDLES.doc(ctx, 'n2', '微积分/极限')
    const note = await doc.note('错题本')
    expect(note.kind).toBe('note')
    const outline = await doc.outline()
    expect('error' in outline ? 'unexpected' : outline.kind).toBe('outline')
    const lab = await doc.superdoc('实验')
    expect('error' in lab ? 'unexpected' : lab.kind).toBe('superdoc')
    // 大纲能力未注入：不是抛异常，是结构化失败（与其余 api 同一条纪律）
    const bare: HandleContext = { doc: stubCtx([]).doc }
    const bareDoc = new NODE_HANDLES.doc(bare, 'n2', '微积分/极限')
    const noOutline = await bareDoc.outline()
    expect('error' in noOutline ? noOutline.error : 'unexpected').toContain('没有大纲能力')
  })

  it('方法查表与 help 总览都从同一份声明派生', () => {
    expect(methodDocOf('doc', 'write')?.name).toBe('write')
    expect(methodDocOf('doc', '不存在')).toBeNull()
    expect(methodDocOf('exam', 'write')).toBeNull()
    const table = renderKindMethodsTable()
    expect(table).toContain('文档（api.node(路径)）')
    expect(table).toContain('大纲（api.node(路径).outline()）')
    expect(table).toContain('write')
    expect(table).toContain('note(')
    // 入口 / 试卷不是内容载体，不进方法总览
    expect(table).not.toContain('入口')
    expect(table).not.toContain('试卷')
  })
})
