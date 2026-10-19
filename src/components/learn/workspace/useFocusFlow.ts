/*
 * 这个文件负责：专注模式的几个动作——开始、结束、暂停、恢复。
 *
 * 没有 tick、没有时钟：专注模式不倒计时（见 learn/focus 的文件头）。这里只在
 * 「用户按下开始/停止」「守卫判离开/回来了」这几个时机碰 store。暂停只属于守卫——
 * 界面上没有暂停按钮。
 */

import { useCallback } from 'react'
import type { LearnStore } from '../../../learn/types'
import {
  emptyFocus,
  pauseFocus,
  resumeFocus,
  startFocus,
  stopFocus,
  type FocusMonitors,
  type FocusRecord,
} from '../../../learn/focus'

/** 专注动作需要的宿主能力 */
export interface FocusFlowDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
}

/** 专注模式的全部动作：顶栏的 FocusDock、守卫运行时与快捷键各取所需。 */
export function useFocusFlow({ getLatest, set }: FocusFlowDeps) {
  /**
   * 开始一场专注。**只有用户点得动它**，而且必须先开一路守卫（见 learn/focus 的
   * startFocus：没守卫返回 null，这里什么都不写）。agent 那边只有只读的 focus.status。
   */
  const startFocusMode = useCallback(
    (monitors: FocusMonitors): boolean => {
      const s = getLatest()
      const started = startFocus(s.focus ?? emptyFocus(), monitors)
      if (!started) return false
      set({ ...s, focus: started.store })
      return true
    },
    [getLatest, set],
  )

  /** 结束：落一条记录（不到一分钟不记），返回它供调用方写报告 */
  const stopFocusMode = useCallback((): FocusRecord | null => {
    const s = getLatest()
    const out = stopFocus(s.focus ?? emptyFocus())
    if (out.store !== s.focus) set({ ...s, focus: out.store })
    return out.record
  }, [getLatest, set])

  /** 守卫判「人不在」：标记暂停（不冻结任何计时，只为状态与报告） */
  const pauseFocusMode = useCallback(() => {
    const s = getLatest()
    set({ ...s, focus: pauseFocus(s.focus ?? emptyFocus()) })
  }, [getLatest, set])

  /** 回到屏幕前（守卫收到交互）：清掉暂停标记 */
  const resumeFocusMode = useCallback(() => {
    const s = getLatest()
    set({ ...s, focus: resumeFocus(s.focus ?? emptyFocus()) })
  }, [getLatest, set])

  return { startFocusMode, stopFocusMode, pauseFocusMode, resumeFocusMode }
}
