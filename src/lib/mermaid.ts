/**
 * Mermaid 图表渲染。
 *
 * marked 把 ```mermaid 围栏渲染成占位容器（见 lib/builtinPlugins.ts），
 * 这里在 DOM 提交后把容器变成真正的 SVG 图表。分两步的原因：
 * - renderNote 是同步纯函数，只产出 HTML 字符串，产不出图；
 * - 绘图库（mermaid 解包 ~2MB）按需动态加载，
 *   文档里没有图表时完全不会加载它。
 */
import { t } from '../i18n'
import type { PluginRenderContext } from './renderPlugins'

export const MERMAID_LANG = 'mermaid'

type MermaidApi = typeof import('mermaid').default

let cached: MermaidApi | null = null
let pending: Promise<MermaidApi | null> | null = null
let lastError = ''

function resolveMermaid(m: unknown): MermaidApi | null {
  const candidate = (m as { default?: unknown })?.default ?? m
  if (candidate && typeof (candidate as { render?: unknown }).render === 'function') {
    return candidate as MermaidApi
  }
  return null
}

export function loadMermaid(): Promise<MermaidApi | null> {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = import('mermaid')
      .then((m) => {
        const api = resolveMermaid(m)
        if (api) {
          cached = api
        } else {
          lastError = t('Mermaid 绘图库导出异常')
        }
        return api
      })
      .catch((err) => {
        lastError = err instanceof Error ? err.message : String(err)
        return null
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}

export function mermaidFallback(message: string, source: string, ctx: PluginRenderContext): string {
  return (
    `<div class="moji-mermaid moji-mermaid-error">` +
    `<div class="moji-mermaid-msg">${ctx.escape(message)}</div>` +
    `<pre><code>${ctx.escape(source.trim())}</code></pre>` +
    `</div>`
  )
}

export function mermaidBlock(source: string, ctx: PluginRenderContext): string {
  const raw = source.trim()
  if (!raw) return mermaidFallback(t('图表内容为空'), source, ctx)
  return (
    `<div class="moji-mermaid" data-mermaid="${ctx.attr(raw)}">` +
    `<div class="moji-mermaid-stage"></div>` +
    `<div class="moji-mermaid-hint">${t('正在绘制图表…')}</div>` +
    `</div>`
  )
}

let mermaidIdSeed = 0

function fail(el: HTMLElement, stage: HTMLElement, message: string, source: string): void {
  el.classList.add('moji-mermaid-error')
  el.querySelector('.moji-mermaid-hint')?.remove()
  const box = document.createElement('div')
  box.className = 'moji-mermaid-msg'
  box.textContent = message
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = source
  pre.appendChild(code)
  stage.replaceChildren(box, pre)
}

function isDarkModeActive(): boolean {
  if (typeof document === 'undefined') return false
  const root = document.documentElement
  const dataTheme = root.getAttribute('data-theme')
  if (dataTheme === 'dark' || dataTheme === 'graphite' || dataTheme === 'navy' || dataTheme === 'contrast' || dataTheme === 'black') {
    return true
  }
  if (root.classList.contains('dark')) return true
  if (dataTheme === 'system' || !dataTheme) {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return false
}

function hydrateOne(el: HTMLElement): (() => void) | null {
  const stage = el.querySelector<HTMLElement>('.moji-mermaid-stage')
  if (!stage) return null

  const raw = el.dataset.mermaid ? decodeURIComponent(el.dataset.mermaid) : ''
  if (!raw.trim()) {
    fail(el, stage, t('图表内容为空'), raw)
    return null
  }

  let disposed = false

  const render = async () => {
    if (disposed) return
    const mermaid = await loadMermaid()
    if (disposed) return
    if (!mermaid) {
      fail(el, stage, lastError || t('无法载入 Mermaid 绘图库'), raw)
      return
    }

    const id = `moji-mermaid-${Date.now().toString(36)}-${(++mermaidIdSeed).toString(36)}`
    const isDark = isDarkModeActive()

    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'loose',
        fontFamily: 'inherit',
      })
      const { svg, bindFunctions } = await mermaid.render(id, raw)
      if (disposed) return

      el.querySelector('.moji-mermaid-hint')?.remove()
      el.classList.remove('moji-mermaid-error')
      stage.innerHTML = svg
      const svgEl = stage.querySelector('svg')
      if (svgEl) {
        svgEl.style.maxWidth = '100%'
        svgEl.style.height = 'auto'
        svgEl.style.display = 'inline-block'
      }
      bindFunctions?.(stage)
    } catch (err) {
      if (disposed) return
      // 清理 mermaid.render 失败时可能残留在 body 上的临时节点
      const dangling = document.getElementById(id) ?? document.getElementById(`d${id}`)
      dangling?.remove()
      const msg = err instanceof Error ? err.message : String(err)
      fail(el, stage, t('图表语法错误：{0}', msg), raw)
    }
  }

  void render()

  return () => {
    disposed = true
  }
}

/**
 * 挂载 root 内所有 mermaid 占位容器；返回清理函数。
 */
export function hydrateMermaid(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = []
  for (const el of root.querySelectorAll<HTMLElement>('.moji-mermaid[data-mermaid]')) {
    const cleanup = hydrateOne(el)
    if (cleanup) cleanups.push(cleanup)
  }
  return () => {
    for (const fn of cleanups) fn()
  }
}

/**
 * 教学 Agent 的 Mermaid 语法指引（用于系统提示词与指引）。
 */
export const MERMAID_SYNTAX_GUIDE = `图表与流程图：用三个反引号 + mermaid 插入图表（如 \`\`\`mermaid\nflowchart TD\n    A[开始] --> B[处理]\n\`\`\`）。
- 支持流程图 (flowchart / graph)、序列图 (sequenceDiagram)、状态图 (stateDiagram-v2)、类图 (classDiagram)、实体关系图 (erDiagram)、甘特图 (gantt)、饼图 (pie) 等标准 Mermaid 语法。
- 适合在讲解概念流转、状态变迁、架构关系、执行时序时使用。`
