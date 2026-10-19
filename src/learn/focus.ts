/**
 * 专注模式（focus）：**只有守卫，没有倒计时**。
 *
 * 与上一版（番茄钟）的分别（需求定的）：上一版是个自己会走的计时器——设一段多长、
 * 做几组，专注与休息交替。现在这些统统没了：专注模式就是「开一场有人盯着的学习」，
 * 什么时候结束由用户按停止决定。唯一的前置条件是**至少开一路守卫**（屏幕 / 摄像头），
 * 否则根本开不起来——这个功能存在的意义就是守卫，没有守卫的空会话不该被创建。
 *
 * 四条定死的规则，改这个文件之前先读一遍：
 *
 * 1. **没有任何时钟**。不存 duration / groups / phase，也不做「到点收尾」。
 *    会话上只有 startedAt（报告与统计要算时长）和 pausedAt（守卫判离开时记一笔，
 *    只为界面显示与报告，不冻结任何倒计时）。
 * 2. **暂停只属于守卫**。用户手里只有「停止」：判定人不在屏幕前时，运行时调
 *    pauseFocus（监控也停，见 agent/guardRuntime），回来一交互自动 resumeFocus。
 * 3. **停止才落一条记录**：一场专注结束（用户停止 / 隐私熔断）时，把「什么时候结束、
 *    持续了多久」记进 log。不到一分钟的当作误触，不记。
 * 4. **agent 只能读**（api.focus.status）：开始与停止是用户按的按钮说了算。
 *
 * 落盘：整块进 state.json（与上一版同一条路，见 learn/files/state）。读盘时
 * **正在跑的那一场一律丢掉**（守卫上下文不跨重启）；旧版 pomodoro 的 log 里每一段
 * 按 minutes 折算成毫秒记录——历史统计不断档。
 */

import { studyDayOf } from './reading'
import { clamp, num } from '../lib/num'

/** 记录留多少条（够 agent 回溯最近这些天，又不至于让 state.json 无限长） */
export const MAX_LOG = 120
/**
 * 多短的专注不算一条记录：按错了、点开看一眼就停，都不该进统计。
 * 比报告门槛（3 分钟，见 focusGuard 的 REPORT_MIN_MS）宽一档——记录是统计口径，
 * 报告是回看凭证，前者可以细一点。
 */
export const MIN_RECORD_MS = 60_000

/** 这一场开了哪几路守卫（至少一路为真，否则不该有会话） */
export interface FocusMonitors {
  screen: boolean
  camera: boolean
}

/** 正在跑（或守卫判离开而暂停）的那一场专注 */
export interface FocusSession {
  startedAt: number
  monitors: FocusMonitors
  /**
   * 守卫判离开而暂停的那一刻（null / 缺省 = 正在当值）。
   * 它不冻结任何计时——专注模式没有倒计时；只用于界面状态与报告的暂停统计。
   */
  pausedAt?: number | null
}

/**
 * 一条已完成的专注记录。
 *
 * 为什么记 at（结束时刻）而不是开始时刻：学习日是按**结束**那一刻归属的——
 * 23:50 开始、00:15 结束的那一场算第二天，与阅读记录的归属口径一致（见 learn/reading）。
 * ms 是墙上时长（含中间被暂停的时间）：专注模式不计时，这里只是「这一场坐了多久」。
 */
export interface FocusRecord {
  at: number
  ms: number
}

export interface FocusStore {
  version: number
  current: FocusSession | null
  log: FocusRecord[]
}

export function emptyFocus(): FocusStore {
  return { version: 3, current: null, log: [] }
}

/* ---------- 纯计算 ---------- */

/** 这一场到此刻持续了多久（毫秒）：报告、统计、界面要显示「专注了多久」时用它 */
export function sessionMsOf(session: FocusSession | null, now = Date.now()): number {
  if (!session) return 0
  return Math.max(0, now - session.startedAt)
}

/** 至少开了一路守卫吗——专注模式的准入门槛 */
export function hasMonitor(monitors: FocusMonitors | null | undefined): boolean {
  return !!(monitors && (monitors.screen || monitors.camera))
}

/* ---------- 用户按下的那两个按钮 ---------- */

/**
 * 开始一场专注。**没开任何守卫就返回 null**（调用方据此不创建会话）：
 * 专注模式 = 守卫模式，没有守卫的空会话不是这个功能的一部分。
 *
 * 已经在跑的那一场会被直接顶掉（不记账）——「先停再开」不是一次新的专注统计，
 * 顶掉意味着上一次作废，与旧版「重新开始」的语义一致。
 */
export function startFocus(
  store: FocusStore,
  monitors: FocusMonitors,
  now = Date.now(),
): { store: FocusStore; session: FocusSession } | null {
  if (!hasMonitor(monitors)) return null
  const session: FocusSession = {
    startedAt: now,
    monitors: { screen: monitors.screen, camera: monitors.camera },
  }
  return { store: { ...store, current: session }, session }
}

export interface FocusStop {
  store: FocusStore
  /** 这一场够长、值得记账时给出的记录；太短（< MIN_RECORD_MS）为 null */
  record: FocusRecord | null
}

/**
 * 停止：结束当前会话，够长就记一条。
 *
 * 没有会话时原样返回同一个 store（调用方据此不写盘）。
 */
export function stopFocus(store: FocusStore, now = Date.now()): FocusStop {
  const current = store.current
  if (!current) return { store, record: null }
  const ms = Math.max(0, now - current.startedAt)
  const record: FocusRecord | null = ms >= MIN_RECORD_MS ? { at: now, ms } : null
  return {
    store: {
      ...store,
      current: null,
      // 新记录排在最前：log 一律「新 → 旧」，与阅读会话的顺序口径一致
      log: record ? [record, ...store.log].slice(0, MAX_LOG) : store.log,
    },
    record,
  }
}

/**
 * 暂停：守卫判「人不在」时由运行时调（界面没有暂停按钮，见文件头规则 2）。
 * 没在跑、或已经在暂停里，原样返回同一个 store。
 */
export function pauseFocus(store: FocusStore, now = Date.now()): FocusStore {
  const current = store.current
  if (!current || current.pausedAt) return store
  return { ...store, current: { ...current, pausedAt: now } }
}

/** 恢复：把暂停标记清掉（不影响任何计时——本来就没有计时）。没在暂停里就是空操作 */
export function resumeFocus(store: FocusStore): FocusStore {
  const current = store.current
  if (!current?.pausedAt) return store
  return { ...store, current: { ...current, pausedAt: null } }
}

/* ---------- 读数：给界面，也给 agent ---------- */

export interface FocusStatus {
  session: FocusSession | null
  /** 守卫判离开、暂停中 */
  paused: boolean
  /** 这一场已经持续了多久（没在跑就是 0） */
  sessionMs: number
  /** 今天完成了几场专注、共多少分钟 */
  todaySessions: number
  todayMs: number
}

export function focusStatus(store: { focus?: FocusStore }, now = Date.now()): FocusStatus {
  const f = store.focus ?? emptyFocus()
  const day = studyDayOf(now)
  const today = f.log.filter((r) => studyDayOf(r.at) === day)
  return {
    session: f.current,
    paused: !!f.current?.pausedAt,
    sessionMs: sessionMsOf(f.current, now),
    todaySessions: today.length,
    todayMs: today.reduce((n, r) => n + r.ms, 0),
  }
}

/** 最近 n 天的汇总（含今天，新 → 旧）：agent 回答「我最近专注得怎么样」用它 */
export function focusDays(
  store: { focus?: FocusStore },
  now = Date.now(),
  days = 7,
): Array<{ day: string; sessions: number; minutes: number }> {
  const f = store.focus ?? emptyFocus()
  const byDay = new Map<string, { sessions: number; ms: number }>()
  for (const r of f.log) {
    const day = studyDayOf(r.at)
    const cur = byDay.get(day) ?? { sessions: 0, ms: 0 }
    cur.sessions += 1
    cur.ms += r.ms
    byDay.set(day, cur)
  }
  const out: Array<{ day: string; sessions: number; minutes: number }> = []
  // 学习日的边界是凌晨 4 点（见 learn/reading），所以「往前一天」不能拿现在硬减 86_400_000：
  // 从**今天中午**往回退 n 天，那一刻必然落在前 n 个学习日里（中午离两头的边界都够远）。
  const noon = new Date(now)
  noon.setHours(12, 0, 0, 0)
  for (let i = 0; i < Math.max(1, days); i++) {
    const day = studyDayOf(noon.getTime() - i * 86_400_000)
    const hit = byDay.get(day) ?? { sessions: 0, ms: 0 }
    out.push({ day, sessions: hit.sessions, minutes: Math.round(hit.ms / 60_000) })
  }
  return out
}

/* ---------- 落盘数据的校验 ---------- */

/**
 * 从磁盘读回专注数据。
 *
 * **正在跑的那一场一律丢掉**：守卫上下文只活在内存里（agent/guardRuntime），
 * 应用重启 / 渲染层刷新之后没有人在值守——保留一个「专注中」的会话，用户面对的是
 * 一场停不掉的空壳，收场时还会写出一份没有守卫事实的报告。要专注就重新开一场。
 *
 * **旧结构（番茄钟那一版）的 log 折算成新形状**：一条 `{ at, minutes, index, groups }`
 * 读成 `{ at, ms }`（按分钟计），历史统计不断档；新形状的 `ms` 原样收。
 */
export function normalizeFocus(raw: unknown): FocusStore {
  const out = emptyFocus()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  if (Array.isArray(r.log)) {
    for (const item of r.log.slice(0, MAX_LOG)) {
      const rec = normalizeRecord(item)
      if (rec) out.log.push(rec)
    }
  }
  return out
}

function normalizeRecord(raw: unknown): FocusRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const at = num(r.at)
  if (at <= 0) return null
  // 新形状直接给 ms；旧形状只有 minutes（番茄钟的「一段专注多长」），折算成毫秒
  const legacyMinutes = num(r.minutes)
  const ms =
    typeof r.ms === 'number' && Number.isFinite(r.ms) && r.ms >= 0
      ? Math.round(r.ms)
      : legacyMinutes > 0
        ? Math.round(clamp(legacyMinutes, 0, 24 * 60) * 60_000)
        : 0
  if (ms <= 0) return null
  return { at, ms }
}
