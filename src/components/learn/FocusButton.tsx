import { Camera, Loader2, Monitor, Pause, Play, Square } from 'lucide-react'
import type { ReactNode } from 'react'
import { useHoverMenu } from '../../lib/hoverMenu'
import type { FocusMonitors } from '../../learn/focus'
import FocusIcon from './FocusIcon'
import { t } from '../../i18n'

/**
 * 顶栏的「专注模式」入口。
 *
 * 它只有一种形态：**守卫模式**。没有时长、没有组数、没有倒计时——开始之前唯一要定的
 * 是「让守卫看哪几路」（屏幕 / 摄像头），而且**至少开一路才允许开始**：守卫是这个功能
 * 的全部内容，没有守卫的空会话不该存在（见 learn/focus 的文件头）。
 *
 * 组件是**纯展示**的：勾选状态、守卫预览、状态行与回调全部由 props 传入；
 * 它不读 store、不碰媒体流、也不持有任何时钟——媒体流与判定都在 agent/guardRuntime。
 */

export interface FocusButtonProps {
  /** 正在跑的那一场（没在跑就是 null） */
  running: { paused: boolean } | null
  /** 下一场要开哪几路守卫（跑起来之后锁住，以会话里的为准） */
  monitors: FocusMonitors
  /** 勾 / 去一路守卫；媒体流的起停由父组件管 */
  onMonitorToggle: (kind: 'screen' | 'camera') => void
  /** 点「开始专注」：父组件先起守卫，拿到画面才算真的开始 */
  onStart: () => void
  /** 结束这一场（守卫一并收摊） */
  onStop: () => void
  /** 正在申请媒体流（开始按钮转圈，防连点） */
  starting: boolean
  /** 勾选后出现的实时画面（屏幕 / 摄像头各一块，只为对齐角度、防隐私） */
  previews: ReactNode | null
  /** 守卫运行中的状态行 + 「查看守卫」入口 */
  guardStatus: ReactNode | null
  /** 勾了守卫但开不起来的提示（模型不支持看图之类）；null = 没问题 */
  strictHint: string | null
}

/** 指针离开后延后这么久再收：按钮与面板之间有一道 pt-1.5 的缝 */
const HOVER_CLOSE_MS = 90
/** 退场时长，与 index.css 的 .moji-wipe-corner-out 对齐 */
const PANEL_EXIT_MS = 160

export default function FocusButton({
  running,
  monitors,
  onMonitorToggle,
  onStart,
  onStop,
  starting,
  previews,
  guardStatus,
  strictHint,
}: FocusButtonProps) {
  const { open, mounted, wrapProps, buttonProps, panelProps } = useHoverMenu({
    closeMs: HOVER_CLOSE_MS,
    exitMs: PANEL_EXIT_MS,
    buttonOpens: true,
  })

  /** 至少一路守卫才允许开始——这是这个功能的准入条件，不是可选项 */
  const armed = monitors.screen || monitors.camera
  const paused = !!running?.paused
  const locked = running !== null
  const chip = running ? (paused ? t('已暂停') : t('守卫当值')) : t('就绪')

  return (
    <div className="no-drag relative shrink-0" {...wrapProps}>
      <button
        type="button"
        title={
          running
            ? paused
              ? t('专注模式：守卫暂停中——回到应用一交互就继续')
              : t('专注模式：守卫正在当值')
            : armed
              ? t('专注模式：开始一场有守卫盯着的学习')
              : t('专注模式：先开启屏幕或摄像头守卫')
        }
        {...buttonProps}
        aria-expanded={open}
        className={`group relative flex h-8 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[12px] font-medium transition-all duration-150 ${
          running ? 'text-ink' : open ? 'text-ink' : 'text-ink-soft hover:text-ink'
        }`}
      >
        <div
          className={`relative flex items-center justify-center ${
            running
              ? paused
                ? 'text-warn-deep'
                : 'text-seal'
              : open
                ? 'text-ink'
                : 'text-ink-faint group-hover:text-ink'
          }`}
        >
          <FocusIcon size={15} />
          {running && !paused && (
            <span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-seal opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-seal" />
            </span>
          )}
        </div>
        {running ? (
          <>
            {paused && <Pause size={12} className="shrink-0 text-warn-deep animate-pulse" />}
            <span className="shrink-0 text-[12px] font-medium text-ink">{paused ? t('已暂停') : t('专注中')}</span>
          </>
        ) : (
          <span className="shrink-0 text-[12px]">{t('专注')}</span>
        )}
      </button>

      {mounted && (
        <div className="absolute right-0 top-full z-30 pt-1.5">
          <div
            className={`w-[312px] rounded-2xl border border-line-strong/70 bg-card/95 p-3.5 shadow-2xl backdrop-blur-md ${panelProps.className}`}
          >
            {/* 标题与状态 */}
            <div className="flex items-center justify-between gap-2 px-0.5">
              <div className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-seal/10 text-seal">
                  <FocusIcon size={13} />
                </span>
                <span className="text-[13px] font-semibold text-ink-strong">{t('专注模式')}</span>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                  running
                    ? paused
                      ? 'bg-warn/15 text-warn-deep'
                      : 'bg-seal/12 text-seal-deep'
                    : 'bg-line/50 text-ink-faint'
                }`}
              >
                {chip}
              </span>
            </div>

            <p className="mt-2 px-0.5 text-[11px] leading-relaxed text-ink-faint">
              {t('开启一路守卫后开始。守卫每分钟看一次画面，分心会提醒，涉及隐私立即熔断。')}
            </p>

            {/* 守卫：唯一要定的事 */}
            <div className="mt-2.5 rounded-xl border border-line/50 bg-paper/40 p-2.5 dark:bg-paper/20">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-medium text-ink-strong">{t('守卫')}</span>
                <span className="text-[10.5px] text-ink-faint">
                  {armed ? t('至少一路 · 每分钟巡检') : t('至少开启一路')}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-all ${
                    monitors.screen
                      ? 'border-seal/40 bg-seal/10 text-seal-deep font-medium'
                      : 'border-line/60 bg-card/40 text-ink-soft hover:bg-card hover:text-ink'
                  } ${locked ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={monitors.screen}
                    disabled={locked}
                    onChange={() => onMonitorToggle('screen')}
                    className="accent-[var(--color-seal)] rounded"
                  />
                  <Monitor size={12} className="shrink-0" />
                  <span>{t('监控屏幕')}</span>
                </label>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-all ${
                    monitors.camera
                      ? 'border-seal/40 bg-seal/10 text-seal-deep font-medium'
                      : 'border-line/60 bg-card/40 text-ink-soft hover:bg-card hover:text-ink'
                  } ${locked ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={monitors.camera}
                    disabled={locked}
                    onChange={() => onMonitorToggle('camera')}
                    className="accent-[var(--color-seal)] rounded"
                  />
                  <Camera size={12} className="shrink-0" />
                  <span>{t('监控摄像头')}</span>
                </label>
              </div>
              {!running && !armed && (
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-warn-deep">
                  {t('至少开启一项守卫功能才能开始专注模式。')}
                </p>
              )}
              {strictHint && <p className="mt-1.5 text-[10.5px] leading-relaxed text-warn-deep">{strictHint}</p>}
              {previews}
              <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
                {t('画面仅用于实时状态判定，不落盘；若检测到隐私内容将熔断停止。')}
              </p>
            </div>

            {/* 守卫当值时的状态行 */}
            {guardStatus}

            {/* 暂停提示 */}
            {running && paused && (
              <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-[11px] leading-relaxed text-warn-deep">
                <Pause size={13} className="shrink-0 mt-0.5" />
                <span>{t('守卫发现你不在屏幕前，值守已暂停——回到应用随便点一下或敲个键就继续')}</span>
              </div>
            )}

            {/* 开始 / 结束 */}
            {running ? (
              <button
                type="button"
                onClick={onStop}
                className="mt-3 flex h-8.5 w-full items-center justify-center gap-1.5 rounded-lg border border-warn/40 bg-warn/5 text-[12.5px] font-medium text-warn-deep transition-all hover:bg-warn/15 hover:border-warn active:scale-[0.99]"
              >
                <Square size={12} /> {t('结束专注')}
              </button>
            ) : (
              <button
                type="button"
                onClick={onStart}
                disabled={!armed || starting}
                className="mt-3 flex h-8.5 w-full items-center justify-center gap-1.5 rounded-lg bg-seal text-[12.5px] font-medium text-white shadow-sm transition-all hover:bg-seal-deep active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {starting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} className="fill-current" />}
                {starting ? t('正在开启守卫…') : t('开始专注')}
              </button>
            )}

            <div className="mt-2.5 border-t border-line/40 pt-2 text-[10px] leading-relaxed text-ink-faint">
              {t('专注没有时限，随时结束；结束三分钟以上的场次会生成专注报告。')}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
