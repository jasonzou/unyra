/**
 * 专注模式（learn/focus）的单元用例。
 *
 * 这一版的语义变了两处，都值得钉住：
 * - **没有倒计时**：会话上不再有 focusMinutes / groups / phase，暂停只是一个标记，
 *   墙上过多久都不影响会话本身；
 * - **守卫是准入条件**：一路监控都没开就开不起来；旧版数据读回来时，正在跑的那一场
 *   直接丢掉（守卫上下文不跨重启），但历史 log 要按 minutes 折算成毫秒留下来。
 */
import { describe, expect, it } from 'vitest'

import {
  MAX_LOG,
  MIN_RECORD_MS,
  emptyFocus,
  focusDays,
  focusStatus,
  hasMonitor,
  normalizeFocus,
  pauseFocus,
  resumeFocus,
  sessionMsOf,
  startFocus,
  stopFocus,
} from '../src/learn/focus'
import { studyDayOf } from '../src/learn/reading'

/** 中午：离学习日边界（凌晨 4 点）够远，任何时区都不会翻页 */
const NOON = new Date(2026, 9, 19, 12, 0, 0).getTime()
const MIN = 60_000

describe('startFocus', () => {
  it('至少开一路守卫才开得起来', () => {
    expect(startFocus(emptyFocus(), { screen: false, camera: false }, NOON)).toBeNull()
    expect(startFocus(emptyFocus(), { screen: true, camera: false }, NOON)?.session.monitors).toEqual({
      screen: true,
      camera: false,
    })
    expect(startFocus(emptyFocus(), { screen: false, camera: true }, NOON)?.session.monitors).toEqual({
      screen: false,
      camera: true,
    })
  })

  it('开始会顶掉上一场（不记账）', () => {
    const first = startFocus(emptyFocus(), { screen: true, camera: false }, NOON)!.store
    const second = startFocus(first, { screen: false, camera: true }, NOON + 5 * MIN)!.store
    expect(second.log).toEqual([])
    expect(second.current?.startedAt).toBe(NOON + 5 * MIN)
  })

  it('hasMonitor 只认真的开了的那一路', () => {
    expect(hasMonitor(null)).toBe(false)
    expect(hasMonitor({ screen: false, camera: false })).toBe(false)
    expect(hasMonitor({ screen: true, camera: false })).toBe(true)
  })
})

describe('stopFocus', () => {
  it('够一分钟才落记录，记录排在最前', () => {
    const started = startFocus(emptyFocus(), { screen: true, camera: false }, NOON)!.store
    const first = stopFocus(started, NOON + 10 * MIN)
    expect(first.record).toEqual({ at: NOON + 10 * MIN, ms: 10 * MIN })

    const again = startFocus(first.store, { screen: true, camera: false }, NOON + 20 * MIN)!.store
    const second = stopFocus(again, NOON + 25 * MIN)
    expect(second.store.log.map((r) => r.ms)).toEqual([5 * MIN, 10 * MIN])
  })

  it('不到一分钟当作误触：什么都不写，会话照样结束', () => {
    const started = startFocus(emptyFocus(), { screen: true, camera: false }, NOON)!.store
    const out = stopFocus(started, NOON + MIN_RECORD_MS - 1)
    expect(out.record).toBeNull()
    expect(out.store.log).toEqual([])
    expect(out.store.current).toBeNull()
  })

  it('没有会话时原样返回同一个 store（调用方据此不写盘）', () => {
    const empty = emptyFocus()
    expect(stopFocus(empty, NOON).store).toBe(empty)
  })

  it('log 有上限：只留最近 MAX_LOG 条', () => {
    let store = emptyFocus()
    for (let i = 0; i < MAX_LOG + 5; i++) {
      const t0 = NOON + i * 10 * MIN
      store = stopFocus(startFocus(store, { screen: true, camera: false }, t0)!.store, t0 + 5 * MIN).store
    }
    expect(store.log).toHaveLength(MAX_LOG)
    // 新的在前
    expect(store.log[0].at).toBe(NOON + (MAX_LOG + 4) * 10 * MIN + 5 * MIN)
  })
})

describe('pause / resume', () => {
  it('暂停只是标记，不影响时长；恢复清标记', () => {
    const started = startFocus(emptyFocus(), { screen: true, camera: false }, NOON)!.store
    const paused = pauseFocus(started, NOON + 10 * MIN)
    expect(paused.current?.pausedAt).toBe(NOON + 10 * MIN)
    expect(sessionMsOf(paused.current, NOON + 30 * MIN)).toBe(30 * MIN)
    expect(resumeFocus(paused).current?.pausedAt ?? null).toBeNull()
  })

  it('重复暂停、没暂停就恢复、没有会话时暂停，都是空操作（对象身份不变）', () => {
    const started = startFocus(emptyFocus(), { screen: true, camera: false }, NOON)!.store
    const paused = pauseFocus(started, NOON)
    expect(pauseFocus(paused, NOON + MIN)).toBe(paused)
    expect(resumeFocus(started)).toBe(started)
    const empty = emptyFocus()
    expect(pauseFocus(empty, NOON)).toBe(empty)
  })
})

describe('focusStatus / focusDays', () => {
  it('今天的场次与分钟只算今天的记录', () => {
    const yesterday = NOON - 24 * 60 * MIN
    let store = emptyFocus()
    store = stopFocus(startFocus(store, { screen: true, camera: false }, yesterday)!.store, yesterday + 20 * MIN).store
    store = stopFocus(startFocus(store, { screen: true, camera: false }, NOON)!.store, NOON + 15 * MIN).store
    const st = focusStatus({ focus: store }, NOON + 60 * MIN)
    expect(st.todaySessions).toBe(1)
    expect(st.todayMs).toBe(15 * MIN)
    expect(st.paused).toBe(false)
    expect(st.session).toBeNull()
  })

  it('正在跑的一场也回在 status 里（暂停标记跟着走）', () => {
    const store = startFocus(emptyFocus(), { screen: true, camera: false }, NOON)!.store
    const st = focusStatus({ focus: pauseFocus(store, NOON + MIN) }, NOON + 30 * MIN)
    expect(st.session?.startedAt).toBe(NOON)
    expect(st.paused).toBe(true)
    expect(st.sessionMs).toBe(30 * MIN)
  })

  it('最近七天：新 → 旧，缺的那天补 0', () => {
    const store = stopFocus(startFocus(emptyFocus(), { screen: true, camera: false }, NOON)!.store, NOON + 30 * MIN).store
    const days = focusDays({ focus: store }, NOON + 60 * MIN, 7)
    expect(days).toHaveLength(7)
    expect(days[0].day).toBe(studyDayOf(NOON))
    expect(days[0]).toMatchObject({ sessions: 1, minutes: 30 })
    expect(days[1]).toMatchObject({ sessions: 0, minutes: 0 })
  })
})

describe('normalizeFocus', () => {
  it('读盘丢掉正在跑的那一场（守卫不跨重启），记录留着', () => {
    const running = pauseFocus(startFocus(emptyFocus(), { screen: true, camera: false }, NOON)!.store, NOON + 5 * MIN)
    expect(normalizeFocus(JSON.parse(JSON.stringify(running))).current).toBeNull()
    const stopped = stopFocus(startFocus(emptyFocus(), { screen: true, camera: false }, NOON)!.store, NOON + 5 * MIN).store
    const back = normalizeFocus(JSON.parse(JSON.stringify(stopped)))
    expect(back.current).toBeNull()
    expect(back.log).toEqual([{ at: NOON + 5 * MIN, ms: 5 * MIN }])
  })

  it('旧版 pomodoro：正在跑的那一场丢掉，log 的 minutes 折算成毫秒', () => {
    const back = normalizeFocus({
      version: 2,
      current: { startedAt: NOON, focusMinutes: 25, groups: 3, index: 1, phase: 'focus', phaseStartedAt: NOON },
      log: [
        { at: NOON, minutes: 25, index: 1, groups: 3 },
        { at: NOON - 30 * MIN, minutes: 10, index: 2, groups: 3 },
      ],
    })
    expect(back.current).toBeNull()
    expect(back.log).toEqual([
      { at: NOON, ms: 25 * MIN },
      { at: NOON - 30 * MIN, ms: 10 * MIN },
    ])
  })

  it('坏数据逐条丢掉：没有 at / 时长算不出来的记录不认', () => {
    const back = normalizeFocus({ version: 3, log: [{ at: 0, ms: MIN }, { at: NOON }, { at: NOON, ms: 0 }, 'x'] })
    expect(back.log).toEqual([])
    expect(normalizeFocus(null).log).toEqual([])
  })
})
