// ============================================================
// rw-debugger.ts — 浏览器端 DOM 调试注入脚本 (RPC 桥接版)
// ============================================================

/**
 * 生成要在浏览器端初始化的 $$rw 脚本。
 * 此时 $$rw 仅作为传话筒，通过 Playwright 的 exposeBinding 调用 Node.js 端的真实逻辑。
 */
export function getDebuggerScript(aliases: Record<string, string>): string {
  return `
(function() {
  const ALIASES = ${JSON.stringify(aliases)};

  function blinkElements(elements) {
    if (!elements || elements.length === 0) return;
    
    const originalStyles = elements.map(el => {
      return {
        el,
        outline: el.style.outline,
        outlineOffset: el.style.outlineOffset
      };
    });
    
    let count = 0;
    const interval = setInterval(() => {
      count++;
      for (const item of originalStyles) {
        if (count % 2 === 1) {
          item.el.style.outline = '3px solid red';
          item.el.style.outlineOffset = '-3px';
        } else {
          item.el.style.outline = item.outline;
        }
      }
      if (count >= 10) {
        clearInterval(interval);
        for (const item of originalStyles) {
          item.el.style.outline = item.outline;
          item.el.style.outlineOffset = item.outlineOffset;
        }
      }
    }, 300);
  }

  // 挂载到 window.$$rw (异步桥接函数)
  window.$$rw = async function(locatorStr) {
    if (typeof locatorStr !== 'string') {
      console.error('[ResumeWright] Input must be a string.');
      return [];
    }
    console.log("%c[ResumeWright] Analyzing DSL Locator (RPC): \\"" + locatorStr + "\\"", 'color: #3b82f6; font-weight: bold; font-size: 12px;');
    
    if (typeof window.$$rw_node !== 'function') {
      console.error('[ResumeWright] $$rw_node is not exposed. Please ensure you are running in headed/debug mode.');
      return [];
    }

    let result;
    try {
      result = await window.$$rw_node(locatorStr);
    } catch (e) {
      console.error('[ResumeWright] Error calling Node.js resolver:', e);
      return [];
    }

    if (!result || !result.rwId) {
      console.warn("%c[ResumeWright] No visible element found for: \\"" + locatorStr + "\\"", 'color: #f59e0b; font-weight: bold;');
      return [];
    }

    // 根据唯一的 rwId 查找被标记的真实 DOM 元素引用
    const elements = Array.from(document.querySelectorAll('[data-rw-temp-id="' + result.rwId + '"]'));
    
    // 移除标记以还原 DOM
    for (const el of elements) {
      el.removeAttribute('data-rw-temp-id');
    }

    console.log('%cParsed Metadata:', 'color: #6b7280; font-weight: bold;', result.parsed);

    if (elements.length > 0) {
      const label = result.matchedType === 'input' ? 'Input-only match (e.g. input)' : 'Standard match (e.g. tap)';
      const color = result.matchedType === 'input' ? 'color: #8b5cf6; font-weight: bold;' : 'color: #10b981; font-weight: bold;';
      console.log("%c[ResumeWright] " + label + " found " + elements.length + " element(s):", color, elements);
      blinkElements(elements);
    } else {
      console.warn("%c[ResumeWright] Node.js reported matches but no matching DOM elements were found on page (stale/hidden?): \\"" + locatorStr + "\\"", 'color: #f59e0b; font-weight: bold;');
    }

    return elements;
  };
})();
`;
}
