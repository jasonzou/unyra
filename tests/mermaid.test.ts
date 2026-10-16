import { describe, expect, it } from 'vitest'
import {
  computeMermaidSvgMaxWidth,
  MERMAID_LANG,
  mermaidBlock,
  mermaidFallback,
} from '../src/lib/mermaid'
import type { PluginRenderContext } from '../src/lib/renderPlugins'

const mockCtx: PluginRenderContext = {
  escape: (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
  attr: (s: string) => encodeURIComponent(s),
}

describe('Mermaid 图表渲染与尺寸自适应', () => {
  it('MERMAID_LANG 常量正确为 mermaid', () => {
    expect(MERMAID_LANG).toBe('mermaid')
  })

  describe('mermaidBlock 与 fallback', () => {
    it('空图表内容生成错误提示块', () => {
      const html = mermaidBlock('   ', mockCtx)
      expect(html).toContain('moji-mermaid-error')
      expect(html).toContain('图表内容为空')
    })

    it('有效图表代码生成占位容器并对属性编码', () => {
      const code = 'graph TD\nA-->B'
      const html = mermaidBlock(code, mockCtx)
      expect(html).toContain('class="moji-mermaid"')
      expect(html).toContain('data-mermaid="' + encodeURIComponent(code) + '"')
      expect(html).toContain('class="moji-mermaid-stage"')
    })

    it('mermaidFallback 正确转义错误信息与源代码', () => {
      const html = mermaidFallback('错误 <script>', '<svg>', mockCtx)
      expect(html).toContain('错误 &lt;script&gt;')
      expect(html).toContain('&lt;svg&gt;')
      expect(html).not.toContain('<script>')
    })
  })

  describe('computeMermaidSvgMaxWidth 尺寸控制', () => {
    it('当 Mermaid 输出了精确的 style.maxWidth 像素值时，优先采用并保持 min(100%, Xpx)', () => {
      expect(computeMermaidSvgMaxWidth('246px')).toBe('min(100%, 246px)')
      expect(computeMermaidSvgMaxWidth('312.8px')).toBe('min(100%, 313px)')
    })

    it('当 style 未定义像素值时，能从 viewBox 解析自然设计宽度', () => {
      expect(computeMermaidSvgMaxWidth('', '0 0 280 160')).toBe('min(100%, 280px)')
      expect(computeMermaidSvgMaxWidth(null, '-10 -10 450.4 300')).toBe('min(100%, 450px)')
    })

    it('当 style 与 viewBox 均未提供时，能从 width 属性中解析', () => {
      expect(computeMermaidSvgMaxWidth(null, null, '360')).toBe('min(100%, 360px)')
      expect(computeMermaidSvgMaxWidth(null, null, '360px')).toBe('min(100%, 360px)')
    })

    it('无法识别任何自然宽度时安全回退至 100%', () => {
      expect(computeMermaidSvgMaxWidth()).toBe('100%')
      expect(computeMermaidSvgMaxWidth('100%', 'invalid', '100%')).toBe('100%')
    })
  })
})
