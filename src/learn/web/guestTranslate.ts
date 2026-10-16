/**
 * 网页 guest 进程内的沉浸式双语翻译与选区浮窗 DOM 注入脚本构造器。
 * 纯字符串代码模板，由宿主调用 webview.executeJavaScript 执行。
 */

/** 提取网页中符合条件的未翻译段落块 */
export function buildExtractBlocksScript(targetLang = 'zh-CN'): string {
  const safeLang = JSON.stringify(targetLang || 'zh-CN')
  return `(() => {
    try {
      const targetLang = ${safeLang}.toLowerCase();
      const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd, figcaption';
      const IGNORED = 'pre, code, kbd, samp, svg, math, .katex, .MathJax, input, textarea, select, button, [contenteditable], [translate="no"], .notranslate, #unyra-selection-trans-card, .unyra-trans-block';
      
      const elements = Array.from(document.querySelectorAll(BLOCKS));
      const candidates = [];
      let idCounter = 1;

      for (const el of elements) {
        if (el.closest(IGNORED)) continue;
        if (el.getAttribute('data-unyra-translated') === 'true') continue;
        if (el.getAttribute('data-unyra-translating') === 'true') continue;
        if (el.offsetParent === null) continue;

        const text = el.innerText ? el.innerText.trim() : '';
        if (text.length < 3 || text.length > 5000) continue;

        // 根据目标语言智能过滤：如果原文已经属于目标语言，则跳过
        if (targetLang.startsWith('zh')) {
          // 目标语言是中文：中文字符数占全文本比重超 35% 说明原本就是中文
          const chineseMatches = text.match(/[\\u4e00-\\u9fa5]/g);
          const chineseCount = chineseMatches ? chineseMatches.length : 0;
          if (chineseCount / text.length > 0.35) continue;
          // 必须含有外文词汇
          if (!/[a-zA-Z]{2,}|[\\u3040-\\u30ff]|[\\uac00-\\ud7af]/.test(text)) continue;
        } else if (targetLang.startsWith('en')) {
          // 目标语言是英文：如果纯 ASCII/英文且不含非英文字符，则原本就是英文
          const nonAsciiMatches = text.match(/[^\\x00-\\x7F]/g);
          const nonAsciiCount = nonAsciiMatches ? nonAsciiMatches.length : 0;
          if (nonAsciiCount / text.length < 0.15 && /[a-zA-Z]{2,}/.test(text)) continue;
        }

        // 避免父子嵌套块重复提取（如 li 内套 p 时只翻 p）
        if (el.querySelector(BLOCKS)) continue;

        let uid = el.getAttribute('data-unyra-id');
        if (!uid) {
          uid = 'ut-' + Date.now().toString(36) + '-' + (idCounter++);
          el.setAttribute('data-unyra-id', uid);
        }

        // 立即标记为正在派发翻译中，使得后续 DOM 变动与滚动扫描能立刻独立跳过它，彻底摆脱串行锁
        el.setAttribute('data-unyra-translating', 'true');

        candidates.push({ id: uid, text });
      }

      return { ok: true, candidates };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })()`
}

/** 注入段落译文 */
export function buildInsertTranslationsScript(items: Array<{ id: string; translation: string }>): string {
  const json = JSON.stringify(items)
  return `(() => {
    try {
      const items = ${json};
      for (const item of items) {
        const el = document.querySelector('[data-unyra-id="' + item.id + '"]');
        if (!el || !el.parentNode) continue;

        const isTranslated =
          el.getAttribute('data-unyra-translated') === 'true' ||
          !!document.querySelector('[data-unyra-for="' + item.id + '"]');
        if (isTranslated) {
          el.removeAttribute('data-unyra-translating');
          continue;
        }

        el.setAttribute('data-unyra-translated', 'true');
        el.removeAttribute('data-unyra-translating');

        // 克隆原元素（浅克隆，保留原标签、类名、行内样式、字体与排版特征）
        const transEl = el.cloneNode(false);
        transEl.removeAttribute('id');
        transEl.removeAttribute('data-unyra-id');
        transEl.removeAttribute('data-unyra-translating');
        transEl.setAttribute('data-unyra-for', item.id);
        transEl.setAttribute('data-unyra-trans', 'true');
        transEl.classList.add('unyra-trans-block');

        // 若原元素是 li 列表项，去除重复项目符号/序号，保持为原生 li 紧随排版
        if (el.tagName.toLowerCase() === 'li') {
          transEl.style.listStyleType = 'none';
          transEl.style.listStyle = 'none';
        }

        // 微调间距与沉浸感对比度（保持原字号、原色调、原字体，仅留舒适的对比透明度）
        transEl.style.marginTop = '4px';
        transEl.style.opacity = '0.88';
        transEl.style.transition = 'opacity 0.2s ease';

        transEl.textContent = item.translation;

        if (el.nextSibling) {
          el.parentNode.insertBefore(transEl, el.nextSibling);
        } else {
          el.parentNode.appendChild(transEl);
        }
      }
      return { ok: true, count: items.length };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })()`
}

/** 切换双语译文的显示与隐藏 */
export function buildToggleTranslationsScript(): string {
  return `(() => {
    let style = document.getElementById('unyra-trans-toggle-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'unyra-trans-toggle-style';
      document.head.appendChild(style);
    }
    if (style.textContent.includes('none')) {
      style.textContent = '';
      return 'visible';
    } else {
      style.textContent = '.unyra-trans-block { display: none !important; }';
      return 'hidden';
    }
  })()`
}

/** 当翻译请求失败或译文无效时，解除待翻译元素的 data-unyra-translating 锁定，允许后续重试 */
export function buildUnmarkTranslatingScript(ids: string[]): string {
  const json = JSON.stringify(ids)
  return `(() => {
    try {
      const ids = ${json};
      for (const id of ids) {
        const el = document.querySelector('[data-unyra-id="' + id + '"]');
        if (el) {
          el.removeAttribute('data-unyra-translating');
        }
      }
    } catch {}
  })()`
}

/** 清除页面中所有已注入的双语译文并停止动态监听 */
export function buildClearTranslationsScript(): string {
  return `(() => {
    if (window.__unyraObserver) {
      window.__unyraObserver.disconnect();
      window.__unyraObserver = null;
    }
    if (window.__unyraObserverTimer) {
      clearTimeout(window.__unyraObserverTimer);
      window.__unyraObserverTimer = null;
    }
    const blocks = document.querySelectorAll('.unyra-trans-block');
    blocks.forEach((b) => b.remove());
    const originEls = document.querySelectorAll('[data-unyra-translated], [data-unyra-translating]');
    originEls.forEach((el) => {
      el.removeAttribute('data-unyra-translated');
      el.removeAttribute('data-unyra-translating');
      el.removeAttribute('data-unyra-id');
    });
    const style = document.getElementById('unyra-trans-toggle-style');
    if (style) style.remove();
    return blocks.length;
  })()`
}

/** 启动页面 DOM 动态变化监听（SPA / 滚动加载 / 异步注入内容时自动通知宿主继续翻译） */
export function buildStartDomObserverScript(): string {
  return `(() => {
    try {
      if (window.__unyraObserver) {
        window.__unyraObserver.disconnect();
        window.__unyraObserver = null;
      }
      if (window.__unyraObserverTimer) {
        clearTimeout(window.__unyraObserverTimer);
        window.__unyraObserverTimer = null;
      }

      const observer = new MutationObserver((mutations) => {
        let hasRelevant = false;
        for (const m of mutations) {
          if (m.addedNodes && m.addedNodes.length > 0) {
            for (let i = 0; i < m.addedNodes.length; i++) {
              const node = m.addedNodes[i];
              if (node.nodeType === 1) {
                const el = node;
                if (el.classList && el.classList.contains('unyra-trans-block')) continue;
                if (el.getAttribute && el.getAttribute('data-unyra-trans')) continue;
                if (el.id === 'unyra-trans-toggle-style' || el.id === 'unyra-selection-trans-card') continue;
                hasRelevant = true;
                break;
              }
            }
          }
          if (hasRelevant) break;
        }

        if (!hasRelevant) return;

        if (window.__unyraObserverTimer) {
          clearTimeout(window.__unyraObserverTimer);
        }
        window.__unyraObserverTimer = setTimeout(() => {
          console.log('__UNYRA_PAGE_MUTATION__');
        }, 400);
      });

      observer.observe(document.body, { childList: true, subtree: true });
      window.__unyraObserver = observer;
      return { ok: true, observing: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })()`
}

/** 停止页面 DOM 动态变化监听 */
export function buildStopDomObserverScript(): string {
  return `(() => {
    try {
      if (window.__unyraObserverTimer) {
        clearTimeout(window.__unyraObserverTimer);
        window.__unyraObserverTimer = null;
      }
      if (window.__unyraObserver) {
        window.__unyraObserver.disconnect();
        window.__unyraObserver = null;
        return { ok: true, stopped: true };
      }
      return { ok: true, stopped: false };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })()`
}

/** 弹出选中文本的翻译卡片浮层 */
export function buildSelectionPopupScript(payload: {
  original: string
  translation: string
  engine: 'fast' | 'ai'
  x: number
  y: number
}): string {
  const safeTranslation = payload.translation
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const safePayload = {
    ...payload,
    translation: safeTranslation,
  }
  const json = JSON.stringify(safePayload)
  return `(() => {
    const p = ${json};
    const old = document.getElementById('unyra-selection-trans-card');
    if (old) old.remove();

    const card = document.createElement('div');
    card.id = 'unyra-selection-trans-card';
    const posX = Math.min(Math.max(16, p.x), window.innerWidth - 360);
    const posY = Math.min(Math.max(16, p.y + 12), window.innerHeight - 240);

    card.style.cssText = [
      'position: fixed',
      'z-index: 2147483647',
      'left: ' + posX + 'px',
      'top: ' + posY + 'px',
      'width: 340px',
      'max-width: calc(100vw - 32px)',
      'background: #ffffff',
      'color: #0f172a',
      'border: 1px solid rgba(148, 163, 184, 0.4)',
      'box-shadow: 0 12px 28px -4px rgba(0, 0, 0, 0.18), 0 8px 12px -6px rgba(0, 0, 0, 0.12)',
      'border-radius: 12px',
      'padding: 12px 14px',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'font-size: 13px',
      'line-height: 1.55',
      'box-sizing: border-box',
    ].join(';');

    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) {
      card.style.background = '#1e293b';
      card.style.color = '#f1f5f9';
      card.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      card.style.boxShadow = '0 12px 28px -4px rgba(0, 0, 0, 0.6)';
    }

    const engineLabel = p.engine === 'ai' ? '🤖 AI 深度翻译' : '⚡ 极速翻译';
    card.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(148,163,184,0.2);">',
      '  <span style="font-size:11px;font-weight:600;color:#6366f1;background:rgba(99,102,241,0.1);padding:2px 6px;border-radius:4px;">' + engineLabel + '</span>',
      '  <button id="unyra-trans-close-btn" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;padding:0 4px;">&times;</button>',
      '</div>',
      '<div id="unyra-trans-text-box" style="max-height:160px;overflow-y:auto;margin-bottom:10px;font-size:13px;line-height:1.6;word-break:break-word;user-select:text;">',
      '  ' + p.translation,
      '</div>',
      '<div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;">',
      '  <button id="unyra-trans-copy-btn" style="background:rgba(148,163,184,0.15);border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;color:inherit;">复制译文</button>',
      '</div>',
    ].join('');

    card.querySelector('#unyra-trans-close-btn').onclick = () => card.remove();
    card.querySelector('#unyra-trans-copy-btn').onclick = (e) => {
      const btn = e.currentTarget;
      navigator.clipboard.writeText(p.translation).then(() => {
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = '复制译文'; }, 1500);
      });
    };

    document.body.appendChild(card);

    const onDown = (e) => {
      if (!card.contains(e.target)) {
        card.remove();
        document.removeEventListener('mousedown', onDown);
      }
    };
    setTimeout(() => {
      document.addEventListener('mousedown', onDown);
    }, 100);
  })()`
}
