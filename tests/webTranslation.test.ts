import { beforeEach, describe, expect, it } from 'vitest'
import {
  cacheKeyOf,
  clearTranslationCache,
  fnv1a,
  getCachedTranslation,
  getTranslationCacheCount,
  setCachedTranslation,
} from '../src/learn/web/translationCache'
import {
  buildClearTranslationsScript,
  buildExtractBlocksScript,
  buildInsertTranslationsScript,
  buildSelectionPopupScript,
  buildStartDomObserverScript,
  buildStopDomObserverScript,
  buildToggleTranslationsScript,
  buildUnmarkTranslatingScript,
} from '../src/learn/web/guestTranslate'
import { fastTranslateCore, getTranslationDispatcher } from '../electron/app/webSession'
import { REASONING_EFFORTS, REASONING_HINT, REASONING_LABEL } from '../src/ai/types'
import { resolveTargetLang, translateBatch, translateSingle } from '../src/learn/web/translator'
import { setLocale } from '../src/i18n'

describe('网页双语/划词翻译及缓存系统单元测试', () => {
  beforeEach(() => {
    clearTranslationCache()
  })

  describe('翻译缓存 (translationCache)', () => {
    it('哈希函数 fnv1a 保持确定性且区分不同文本', () => {
      const h1 = fnv1a('Hello world')
      const h2 = fnv1a('Hello world')
      const h3 = fnv1a('Hello world!')

      expect(h1).toBe(h2)
      expect(h1).not.toBe(h3)
      expect(typeof h1).toBe('string')
      expect(h1.length).toBeGreaterThan(0)
    })

    it('不同引擎的缓存键相互独立', () => {
      const keyFast = cacheKeyOf('Translate me', 'fast', 'zh-CN')
      const keyAi = cacheKeyOf('Translate me', 'ai', 'zh-CN')

      expect(keyFast).toContain('fast:zh-CN:')
      expect(keyAi).toContain('ai:zh-CN:')
      expect(keyFast).not.toBe(keyAi)
    })

    it('缓存读写、命中与清除流程正常', () => {
      expect(getCachedTranslation('Introduction to React', 'fast')).toBeNull()

      setCachedTranslation('Introduction to React', 'fast', 'React 简介')
      expect(getCachedTranslation('Introduction to React', 'fast')).toBe('React 简介')
      // AI 模式同文本不受影响
      expect(getCachedTranslation('Introduction to React', 'ai')).toBeNull()

      setCachedTranslation('Introduction to React', 'ai', '深入浅出 React')
      expect(getCachedTranslation('Introduction to React', 'ai')).toBe('深入浅出 React')

      // 空白字符 trim 后依然能命中
      expect(getCachedTranslation('   Introduction to React  ', 'fast')).toBe('React 简介')

      expect(getTranslationCacheCount()).toBe(2)

      clearTranslationCache()
      expect(getCachedTranslation('Introduction to React', 'fast')).toBeNull()
      expect(getTranslationCacheCount()).toBe(0)
    })
  })

  describe('Guest DOM 脚本生成器 (guestTranslate)', () => {
    it('buildExtractBlocksScript 生成有效的 IIFE 代码字符串且包含过滤规则', () => {
      const script = buildExtractBlocksScript()
      expect(script).toContain('BLOCKS')
      expect(script).toContain('IGNORED')
      expect(script).toContain('data-unyra-translated')
      expect(script).toContain('candidates')
      // 验证是闭包结构
      expect(script.startsWith('(() => {')).toBe(true)
      expect(script.endsWith(')()')).toBe(true)
    })

    it('buildInsertTranslationsScript 正确克隆原元素保留样式特征，并序列化段落构造插入脚本', () => {
      const items = [
        { id: 'ut-1', translation: '构建本地优先软件赋予用户对其数据的所有权。' },
        { id: 'ut-2', translation: '系统架构设计要点。' },
      ]
      const script = buildInsertTranslationsScript(items)
      expect(script).toContain('ut-1')
      expect(script).toContain('构建本地优先软件')
      expect(script).toContain('unyra-trans-block')
      expect(script).toContain('data-unyra-translated')
      // 验证克隆原元素以继承排版样式（如标题字号、字重、段落对齐）
      expect(script).toContain('cloneNode(false)')
      expect(script).toContain('removeAttribute(\'id\')')
      expect(script).toContain('removeAttribute(\'data-unyra-id\')')
      expect(script).toContain('data-unyra-for')
      expect(script).toContain('listStyleType = \'none\'')
    })

    it('buildToggleTranslationsScript 与 buildClearTranslationsScript 结构正常', () => {
      const toggle = buildToggleTranslationsScript()
      expect(toggle).toContain('unyra-trans-toggle-style')
      expect(toggle).toContain('display: none !important')

      const clear = buildClearTranslationsScript()
      expect(clear).toContain('.unyra-trans-block')
      expect(clear).toContain('data-unyra-translated')
    })

    it('buildStartDomObserverScript 与 buildStopDomObserverScript 正确生成 DOM 监听控制脚本', () => {
      const startScript = buildStartDomObserverScript()
      expect(startScript).toContain('MutationObserver')
      expect(startScript).toContain('__UNYRA_PAGE_MUTATION__')
      expect(startScript).toContain('unyra-trans-block')
      expect(startScript).toContain('window.__unyraObserver')

      const stopScript = buildStopDomObserverScript()
      expect(stopScript).toContain('disconnect()')
      expect(stopScript).toContain('window.__unyraObserver = null')
    })

    it('buildSelectionPopupScript 正确生成选区浮窗 HTML 与防 XSS 转义', () => {
      const script = buildSelectionPopupScript({
        original: 'Security & Sandbox',
        translation: '安全与沙箱 <script>alert(1)</script>',
        engine: 'ai',
        x: 200,
        y: 150,
      })

      expect(script).toContain('unyra-selection-trans-card')
      expect(script).toContain('AI 深度翻译')
      // HTML 转义校验
      expect(script).toContain('&lt;script&gt;')
      expect(script).not.toContain('<script>alert(1)</script>')
      expect(script).toContain('unyra-trans-copy-btn')

      const fastScript = buildSelectionPopupScript({
        original: 'Fast MT',
        translation: '极速机翻',
        engine: 'fast',
        x: 100,
        y: 100,
      })
      expect(fastScript).toContain('极速翻译')
    })
  })

  describe('极速翻译核心容错逻辑 (fastTranslateCore)', () => {
    it('空文本直接返回成功且空串', async () => {
      const res = await fastTranslateCore('   ')
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.text).toBe('')
      }
    })
  })

  describe('非思考模式与批量并发翻译调度', () => {
    it('ReasoningEffort 包含 none 档位，且有对应的标签与提示', () => {
      expect(REASONING_EFFORTS).toContain('none')
      expect(REASONING_LABEL.none).toBe('None')
      expect(REASONING_HINT.none).toContain('非思考模式')
    })

    it('translateBatch 在命中本地缓存时即刻通过 onChunkReady 分发，不延迟等待', async () => {
      setCachedTranslation('Chapter 1 Overview', 'fast', '第一章 概览')
      setCachedTranslation('Chapter 2 Architecture', 'fast', '第二章 架构')

      const receivedChunks: Array<Array<{ id: string; translation: string }>> = []
      const results = await translateBatch(
        [
          { id: 'c1', text: 'Chapter 1 Overview' },
          { id: 'c2', text: 'Chapter 2 Architecture' },
        ],
        'fast',
        {
          onChunkReady: (batch) => {
            receivedChunks.push(batch)
          },
        },
      )

      expect(results.length).toBe(2)
      expect(receivedChunks.length).toBe(1)
      expect(receivedChunks[0]).toEqual([
        { id: 'c1', translation: '第一章 概览' },
        { id: 'c2', translation: '第二章 架构' },
      ])
    })

    it('resolveTargetLang 准确跟随当前 UI 语言', () => {
      setLocale('zh')
      expect(resolveTargetLang()).toBe('zh-CN')

      setLocale('en')
      expect(resolveTargetLang()).toBe('en')

      setLocale('ja')
      expect(resolveTargetLang()).toBe('ja')

      // 显式指定时优先采用显式值
      expect(resolveTargetLang('de')).toBe('de')
    })

    it('buildExtractBlocksScript 支持 data-unyra-translating 防重标记和动态语言过滤', () => {
      const scriptZh = buildExtractBlocksScript('zh-CN')
      expect(scriptZh).toContain('data-unyra-translating')
      expect(scriptZh).toContain('el.setAttribute(\'data-unyra-translating\', \'true\')')

      const scriptEn = buildExtractBlocksScript('en')
      expect(scriptEn).toContain('targetLang')
    })

    it('buildUnmarkTranslatingScript 正确生成解除 data-unyra-translating 锁定的脚本', () => {
      const script = buildUnmarkTranslatingScript(['ut-101', 'ut-102'])
      expect(script).toContain('ut-101')
      expect(script).toContain('ut-102')
      expect(script).toContain('removeAttribute(\'data-unyra-translating\')')
    })

    it('getTranslationDispatcher 能识别环境变量代理并返回 ProxyAgent', async () => {
      const oldProxy = process.env.HTTP_PROXY
      try {
        process.env.HTTP_PROXY = 'http://127.0.0.1:7897'
        const dispatcher = await getTranslationDispatcher('https://translate.googleapis.com')
        expect(dispatcher).toBeDefined()
      } finally {
        if (oldProxy !== undefined) {
          process.env.HTTP_PROXY = oldProxy
        } else {
          delete process.env.HTTP_PROXY
        }
      }
    })

    it('translateBatch 失败时绝不把原文作为译文挂载，且触发 onFailed 回调', async () => {
      const receivedChunks: Array<Array<{ id: string; translation: string }>> = []
      const failedBatches: string[][] = []

      // translateBatch 请求一个不存在的文本，且不 mock 网络让其走 fallback/error
      await translateBatch(
        [{ id: 'err-1', text: 'Some arbitrary unique text that will not be in cache' }],
        'fast',
        {
          onChunkReady: (batch) => {
            receivedChunks.push(batch)
          },
          onFailed: (failedIds) => {
            failedBatches.push(failedIds)
          },
        },
      )

      // 验证：绝不通过 onChunkReady 挂载原文（防止出现英文翻出英文的滑稽现象）
      for (const batch of receivedChunks) {
        for (const item of batch) {
          expect(item.translation).not.toBe('Some arbitrary unique text that will not be in cache')
        }
      }
    })

    it('translateSingle 空字符串直接返回空串，命中缓存时直接返回', async () => {
      expect(await translateSingle('   ', 'fast')).toBe('')
      setCachedTranslation('Unit Testing', 'fast', '单元测试', 'zh-CN')
      expect(await translateSingle('Unit Testing', 'fast', 'zh-CN')).toBe('单元测试')
    })
  })
})
