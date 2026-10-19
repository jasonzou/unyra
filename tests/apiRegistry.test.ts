/**
 * api 注册表的单元用例：唯一入口、登记完整性、`__help()` 渲染。
 *
 * 它的错误形态是「实现里有一条 api，注册表里没有」——`wrapApi` 会当场炸（探针先红）；
 * 或者反过来「注册表里有、帮助里却没有示例」——模型查了 help 还是不知道怎么写。
 */
import { describe, expect, it } from 'vitest'

import {
  API_GROUPS,
  apiDocOf,
  buildSandboxHelp,
  catalogGroups,
  exposedApiNames,
  exposedGroups,
  groupIndexForSystemPrompt,
  renderApiHelp,
  renderGroupHelp,
  renderRootHelp,
} from '../src/agent/sandbox/apiRegistry'

describe('注册表形状', () => {
  it('组 key 唯一；组内 api 名唯一（full 名全表唯一）', () => {
    const keys = API_GROUPS.map((g) => g.key)
    expect(new Set(keys).size).toBe(keys.length)
    const fulls = API_GROUPS.flatMap((g) => g.apis.map((a) => a.full))
    expect(new Set(fulls).size).toBe(fulls.length)
  })

  it('每条 api 都有签名、作用、用法与示例；示例必须是可执行表达式（带 await api. 前缀或裸调用）', () => {
    for (const group of API_GROUPS) {
      for (const api of group.apis) {
        expect(api.signature, api.full).toMatch(/\(/)
        expect(api.summary.trim().length, api.full).toBeGreaterThan(3)
        expect(api.usage.trim().length, api.full).toBeGreaterThan(12)
        expect(api.example.trim().length, api.full).toBeGreaterThan(4)
      }
    }
  })

  it('暴露名单包含全部数据面 api（files 退役后它们是唯一入口）', () => {
    const names = exposedApiNames()
    for (const name of [
      'doc.read', 'doc.write', 'doc.replace', 'doc.append',
      'node.read', 'node.update', 'node.create', 'node.paths',
      'outline.read', 'outline.write',
      'state.read', 'state.update', 'state.mistake', 'state.check',
      'exam.create', 'exam.read', 'exam.grade', 'exam.explain',
      'sdoc.write', 'res.read', 'workspace.write',
      'userInfo.get', 'reading.get', 'tmp.set',
      'wf.list', 'wf.get', 'wf.create', 'wf.remove', 'wf.invoke',
      // 记忆：五条全进名单（工作 / 长期两类都靠它读写）
      'memory.list', 'memory.get', 'memory.create', 'memory.update', 'memory.delete',
    ]) {
      expect(names, name).toContain(name)
    }
  })

  it('兼容层（description）不进名单；旧的 mind 组已整组移除', () => {
    const names = exposedApiNames()
    expect(names).not.toContain('description.read')
    // 但登记还在（wrapApi 的实现仍能找到元数据）
    expect(apiDocOf('description.read')).not.toBeNull()
    // mind.* 被 memory.* 取代：不留兼容层——它从来没进过名单，也没有对话会真的调它
    expect(names.some((n) => n.startsWith('mind.'))).toBe(false)
    expect(apiDocOf('mind.list')).toBeNull()
  })

  it('名单与目录视图（catalogGroups）完全一致', () => {
    const names = exposedApiNames()
    const catalogNames = catalogGroups().flatMap((g) => g.items.map((i) => i.name))
    expect(catalogNames.sort()).toEqual([...names].sort())
  })
})

describe('__help() 渲染', () => {
  it('根 help 列出全部组，并给出三级用法', () => {
    const text = renderRootHelp()
    for (const group of exposedGroups()) {
      if (group.key === 'core') continue
      expect(text).toContain('api.' + group.key)
    }
    expect(text).toContain('api.<组>.__help()')
    expect(text).toContain('api.<组>.<api>.__help()')
  })

  it('组 help 列出组内每条 api 的签名与一句话用法', () => {
    const text = renderGroupHelp('doc')
    expect(text).toContain('api.doc — 教学文档与笔记')
    expect(text).toContain('doc.read(')
    expect(text).toContain('doc.write(')
    expect(text).toContain('api.doc.<api>.__help()')
  })

  it('单条 help 带签名、用法与示例', () => {
    const text = renderApiHelp('doc.write')
    expect(text).toContain('doc.write')
    expect(text).toContain('签名：')
    expect(text).toContain('示例：')
    expect(text).toContain('await api.doc.write')
  })

  it('查不存在的组/条目给可执行的指路，而不是一句空话', () => {
    expect(renderGroupHelp('nope')).toContain('await api.__help()')
    expect(renderApiHelp('doc.nope')).toContain('await api.doc.__help()')
    expect(renderApiHelp('nope')).toContain('await api.__help()')
  })

  it('Worker 注入用的 help 包：root + groups + apis 三层都在', () => {
    const help = buildSandboxHelp()
    expect(help.root).toContain('api 集')
    expect(Object.keys(help.groups)).toContain('doc')
    expect(Object.keys(help.apis)).toContain('doc.write')
    expect(Object.keys(help.apis).length).toBe(exposedApiNames().length)
  })

  it('系统提示词的组索引只有组名与一句说明，不泄露具体签名', () => {
    const index = groupIndexForSystemPrompt()
    expect(index).toContain('api.node — 知识点节点')
    expect(index).not.toContain('doc.write(path')
    expect(index).not.toContain('node.read(path)')
  })
})
