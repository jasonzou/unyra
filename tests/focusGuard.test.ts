/**
 * 严格专注（守卫 agent + 专注报告）的单元用例：
 *
 * - 判定解析（parseVerdict）：约定 JSON、裹着话的 JSON、坏回复、缺字段的口径；
 * - 策略决策（decideGuardAction）：熔断 > 暂停 > 警告的优先级，与「按勾选的监控调整」
 *   ——只开摄像头不评判内容、只开屏幕用交互旧程度当「人不在」的代理；
 * - 专注会话的暂停/恢复与记录（learn/focus）：暂停只是标记、恢复清标记、
 *   停止按分钟阈值落记录、读盘会丢掉正在跑的那一场（守卫不跨重启）；
 * - 页签（learn/tabs + normalizeTab）：守卫页签不落盘（读回来就丢）、报告页签持久；
 * - 报告往返（buildFocusReport / normalizeFocusReport）：形状收口、坏文件不认。
 */
import { describe, expect, it } from 'vitest'

import {
  AWAY_INPUT_MS,
  buildFocusReport,
  decideGuardAction,
  guardSystemPrompt,
  normalizeFocusReport,
  parseVerdict,
  reportSpanLabel,
  type GuardMonitors,
} from '../src/learn/focusGuard'
import { emptyFocus, focusStatus, normalizeFocus, pauseFocus, resumeFocus, startFocus, stopFocus } from '../src/learn/focus'
import { tabKey, tabNodeId, tabTitle, tabTrail } from '../src/learn/tabs'
import { normalizeTab } from '../src/learn/store/normalize/tabs'

/* ---------- parseVerdict ---------- */

describe('parseVerdict', () => {
  it('解析约定的 JSON', () => {
    const v = parseVerdict('{"present":true,"on_task":false,"privacy":false,"reason":"在看视频"}')
    expect(v).toEqual({ present: true, onTask: false, privacy: false, reason: '在看视频' })
  })

  it('裹着说明文字与代码块标记也挖得出来', () => {
    const v = parseVerdict('好的，这是我的判断：\n```json\n{"present":true,"on_task":true,"privacy":false,"reason":"做题"}\n```')
    expect(v?.onTask).toBe(true)
    expect(v?.reason).toBe('做题')
  })

  it('解析不动回 null（调用方记成「没看懂」，绝不瞎动作）', () => {
    expect(parseVerdict('他看起来在学习')).toBeNull()
    expect(parseVerdict('{"present":')).toBeNull()
  })

  it('缺字段按好的一边算：沉默不定罪', () => {
    expect(parseVerdict('{}')).toEqual({ present: true, onTask: true, privacy: false, reason: '' })
    const privacy = parseVerdict('{"privacy":true}')
    expect(privacy?.privacy).toBe(true)
    // 字符串布尔也认（个别模型会把布尔写成字符串）
    expect(parseVerdict('{"present":"false"}')?.present).toBe(false)
  })
})

/* ---------- decideGuardAction ---------- */

describe('decideGuardAction', () => {
  const verdict = (over: Partial<Parameters<typeof decideGuardAction>[0]> = {}) => ({
    present: true,
    onTask: true,
    privacy: false,
    reason: '',
    ...over,
  })

  it('隐私风险一律熔断——其他字段说了什么都不算', () => {
    expect(decideGuardAction(verdict({ privacy: true }), { screen: true, camera: true }, 0)).toBe('fuse')
    expect(decideGuardAction(verdict({ privacy: true, present: false }), { screen: false, camera: true }, 100)).toBe('fuse')
  })

  it('有摄像头：人不在就暂停（内容好坏无所谓）', () => {
    expect(decideGuardAction(verdict({ present: false }), { screen: true, camera: true }, 0)).toBe('pause')
    expect(decideGuardAction(verdict({ present: false, onTask: false }), { screen: false, camera: true }, 0)).toBe('pause')
  })

  it('只有屏幕：用交互旧程度当「人不在」的代理，超过阈值暂停', () => {
    expect(decideGuardAction(verdict(), { screen: true, camera: false }, AWAY_INPUT_MS + 1)).toBe('pause')
    expect(decideGuardAction(verdict(), { screen: true, camera: false }, null)).toBe('pause')
  })

  it('人在学：都开也不动作', () => {
    expect(decideGuardAction(verdict(), { screen: true, camera: true }, 100)).toBe('none')
  })

  it('人在但分心：只有看得到屏幕才警告', () => {
    expect(decideGuardAction(verdict({ onTask: false }), { screen: true, camera: true }, 100)).toBe('warn')
    expect(decideGuardAction(verdict({ onTask: false }), { screen: true, camera: false }, 100)).toBe('warn')
    // 只开摄像头时模型被提示词要求恒真，这里再兜一道：看不到屏幕就没有发言权
    expect(decideGuardAction(verdict({ onTask: false }), { screen: false, camera: true }, 100)).toBe('none')
  })
})

/* ---------- 系统提示词 ---------- */

describe('guardSystemPrompt', () => {
  it('按勾选的监控现算：只开摄像头时不许评判内容', () => {
    const cameraOnly = guardSystemPrompt({ screen: false, camera: true })
    expect(cameraOnly).toContain('不要对「是否在学习」下任何结论')
    expect(cameraOnly).toContain('摄像头画面')
    // 注意力判定（手机/掌机）只在屏幕监控同开时才交代——只开摄像头时 warn 永远不会发
    expect(cameraOnly).not.toContain('掌上游戏机')
    const both = guardSystemPrompt({ screen: true, camera: true })
    expect(both).toContain('屏幕截图')
    expect(both).toContain('privacy')
    expect(both).toContain('掌上游戏机')
  })
})

/* ---------- 专注会话 ---------- */

describe('focus session', () => {
  const t0 = 1_700_000_000_000
  const screen = { screen: true, camera: false }

  it('没开任何守卫就开不起来（专注模式 = 守卫模式）', () => {
    expect(startFocus(emptyFocus(), { screen: false, camera: false }, t0)).toBeNull()
  })

  it('暂停只是标记、不改时长；恢复清掉标记，没暂停时是空操作', () => {
    const started = startFocus(emptyFocus(), screen, t0)!.store
    const paused = pauseFocus(started, t0 + 10 * 60_000)
    expect(paused.current?.pausedAt).toBe(t0 + 10 * 60_000)
    // 专注模式不计时：墙上过多久，会话本身都不变
    expect(focusStatus({ focus: paused }, t0 + 20 * 60_000).paused).toBe(true)
    expect(focusStatus({ focus: paused }, t0 + 20 * 60_000).sessionMs).toBe(20 * 60_000)
    const resumed = resumeFocus(paused)
    expect(resumed.current?.pausedAt ?? null).toBeNull()
    expect(resumeFocus(started)).toBe(started)
    expect(pauseFocus(started, t0).current?.pausedAt).toBe(t0)
    const empty = emptyFocus()
    expect(pauseFocus(empty, t0)).toBe(empty)
  })

  it('停止落一条记录；不到一分钟的当作误触，不记', () => {
    const short = stopFocus(startFocus(emptyFocus(), screen, t0)!.store, t0 + 30_000)
    expect(short.record).toBeNull()
    expect(short.store.log).toEqual([])
    const long = stopFocus(startFocus(emptyFocus(), screen, t0)!.store, t0 + 5 * 60_000)
    expect(long.record).toEqual({ at: t0 + 5 * 60_000, ms: 5 * 60_000 })
    expect(long.store.log).toHaveLength(1)
    expect(long.store.current).toBeNull()
  })

  it('读盘丢掉正在跑的那一场：守卫上下文不跨重启，别留一个停不掉的空壳', () => {
    const paused = pauseFocus(startFocus(emptyFocus(), screen, t0)!.store, t0 + 60_000)
    const round = normalizeFocus(JSON.parse(JSON.stringify(paused)))
    expect(round.current).toBeNull()
    expect(focusStatus({ focus: round }, t0 + 120_000).session).toBeNull()
    // 记录不受影响
    const stopped = stopFocus(startFocus(emptyFocus(), screen, t0)!.store, t0 + 5 * 60_000).store
    expect(normalizeFocus(JSON.parse(JSON.stringify(stopped))).log).toEqual([{ at: t0 + 5 * 60_000, ms: 5 * 60_000 }])
  })
})

/* ---------- 页签 ---------- */

describe('guard / report tabs', () => {
  it('身份与标题：守卫全局一份，报告按 id 一签', () => {
    expect(tabKey({ kind: 'guard' })).toBe('g:guard')
    expect(tabKey({ kind: 'report', reportId: 'f1abc' })).toBe('r:f1abc')
    expect(tabTitle({ kind: 'guard' }, () => undefined)).toBe('守卫 Agent')
    expect(tabTitle({ kind: 'report', reportId: 'f1abc' }, () => undefined)).toBe('专注报告')
  })

  it('都不挂节点、也没有路径后缀', () => {
    expect(tabNodeId({ kind: 'guard' })).toBeNull()
    expect(tabNodeId({ kind: 'report', reportId: 'f1' })).toBeNull()
    expect(tabTrail({ kind: 'report', reportId: 'f1' }, () => 'x')).toBe('')
  })

  it('落盘往返：报告页签持久，守卫页签读回来就丢（上下文不跨重启活着）', () => {
    const byId = new Map()
    const report = normalizeTab({ id: 'r:f1', ref: { kind: 'report', reportId: 'f1' }, createdAt: 1 }, byId)
    expect(report?.ref).toEqual({ kind: 'report', reportId: 'f1' })
    expect(normalizeTab({ id: 'g:guard', ref: { kind: 'guard' }, createdAt: 1 }, byId)).toBeNull()
  })
})

/* ---------- 报告 ---------- */

describe('focus report', () => {
  const input = {
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_000_000 + 25 * 60_000,
    monitors: { screen: true, camera: false } as GuardMonitors,
    outcome: 'stopped' as const,
    pausedMs: 60_000,
    pauseCount: 1,
    pauseSpans: [{ at: 1_700_000_060_000, resumedAt: 1_700_000_120_000 }],
    warnings: [{ at: 1_700_000_300_000, reason: '在看视频' }],
    rounds: [
      { at: 1_700_000_060_000, screen: true, camera: false, verdict: { present: true, onTask: false, privacy: false, reason: '在看视频' }, action: 'warn' as const, reason: '在看视频' },
    ],
  }

  it('构建 → 落盘往返字段不丢', () => {
    const report = buildFocusReport(input)
    expect(report.id).toMatch(/^f[0-9a-z]+$/)
    const back = normalizeFocusReport(JSON.parse(JSON.stringify(report)))
    expect(back).not.toBeNull()
    expect(back!.startedAt).toBe(input.startedAt)
    expect(back!.outcome).toBe('stopped')
    expect(back!.pauseSpans).toEqual(input.pauseSpans)
    expect(back!.warnings).toEqual(input.warnings)
    expect(back!.rounds[0]?.verdict?.reason).toBe('在看视频')
  })

  it('坏文件不认：id 缺了 / 起止倒挂都回 null', () => {
    expect(normalizeFocusReport({})).toBeNull()
    expect(normalizeFocusReport({ ...input, id: 'not-valid' })).toBeNull()
    expect(normalizeFocusReport({ ...input, id: 'f1', endedAt: 1 })).toBeNull()
  })

  it('时段标签用于侧栏与页签', () => {
    expect(reportSpanLabel(1_700_000_000_000, 1_700_000_000_000)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2} – \d{2}-\d{2} \d{2}:\d{2}$/)
  })
})
