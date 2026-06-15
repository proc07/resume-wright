// ============================================================
// tests/unit/dsl/rw-debugger.test.ts
// $$rw 浏览器端调试工具单元测试 (RPC 桥接版)
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDebuggerScript } from '../../../src/dsl/rw-debugger.js';
import { parseLocator, resolveLocator, resolveInputLocator, stripQuotes } from '../../../src/dsl/locator-resolver.js';
import { getDefaultRegistry } from '../../../src/adapters/elements-csv.js';

import { chromium, type Page } from '@playwright/test';

describe('$$rw Browser Debugger Tool', () => {
  let browser: any;
  let page: Page;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    // 内存中模拟别名注册，防止文件读取失败
    const registry = getDefaultRegistry();
    (registry as any).aliases.set('my-btn', 'testid:submit-btn');
    (registry as any).aliases.set('user-field', 'placeholder:Enter username');
    (registry as any).loaded = true;

    // 注入含有别名定义的 $$rw 脚本
    const aliases = {
      'my-btn': 'testid:submit-btn',
      'user-field': 'placeholder:Enter username',
    };
    const script = getDebuggerScript(aliases);

    // 绑定 Node.js 端的真实解析与标记逻辑
    await context.exposeBinding('$$rw_node', async ({ page }, locatorStr: string) => {

      try {
        const parsed = parseLocator(locatorStr);
        let locator = resolveLocator(page, parsed);
        let count = await locator.count();
        let matchedType = 'standard';

        const isPlain = !/^(label:|placeholder:|testid:|title:|alt:|role:|\.|#|\/\/|@|\*.*\*|.*\|)/.test(stripQuotes(locatorStr));
        if (count === 0 && isPlain) {
          const inputLoc = resolveInputLocator(page, locatorStr);
          const inputCount = await inputLoc.count();
          if (inputCount > 0) {
            locator = inputLoc;
            count = inputCount;
            matchedType = 'input';
          }
        }

        if (count > 0) {
          const rwId = 'rw-' + Math.random().toString(36).slice(2);
          await locator.evaluateAll((elements, id) => {
            for (const el of elements) {
              el.setAttribute('data-rw-temp-id', id);
            }
          }, rwId);
          return { rwId, parsed, matchedType };
        }

        return { rwId: null, parsed, matchedType };
      } catch (err) {
        console.error('Error in $$rw_node:', err);
        throw err;
      }
    });

    page = await context.newPage();
    await page.setContent(`
      <html><body>
        <button id="submit-btn" data-testid="submit-btn">Submit Form</button>
        <button id="cancel-btn">Cancel</button>
        
        <input id="username-input" placeholder="Enter username">
        <label for="pwd-input">Password</label>
        <input id="pwd-input" type="password">
        
        <div id="tip" title="Help tip">Help Info</div>
        <img id="avatar" alt="Avatar image" src="avatar.png">

        <table>
          <tr id="row-1">
            <td>User A</td>
            <td><button id="edit-1">Edit</button></td>
          </tr>
        </table>
      </body></html>
    `);

    // 直接在页面上执行注入
    await page.evaluate(script);

    page.on('pageerror', err => {
      console.error('PAGE ERROR:', err.message, err.stack);
    });
    page.on('console', msg => {
      console.log('CONSOLE:', msg.text());
    });
  });

  afterEach(async () => {
    await browser.close();
  });

  it('should resolve diverse locator types accurately in browser console via RPC bridge', async () => {
    // 1. 精确文本匹配
    const resText = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('Submit Form');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resText).toBe('submit-btn');

    // 2. 模糊/通配符文本匹配
    const resWildcard = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('*Submit*');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resWildcard).toBe('submit-btn');

    // 3. OR 文本匹配
    const resOr = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('Submit|Cancel');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resOr).toBe('submit-btn');

    // 4. CSS 选择器
    const resCss = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('#cancel-btn');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resCss).toBe('cancel-btn');

    // 5. XPath
    const resXpath = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('//button[@id="cancel-btn"]');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resXpath).toBe('cancel-btn');

    // 6. Label 定位
    const resLabel = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('label:Password');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resLabel).toBe('pwd-input');

    // 7. Placeholder 定位
    const resPlaceholder = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('placeholder:Enter username');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resPlaceholder).toBe('username-input');

    // 8. TestId 定位
    const resTestId = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('testid:submit-btn');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resTestId).toBe('submit-btn');

    // 9. Title 定位
    const resTitle = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('title:Help tip');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resTitle).toBe('tip');

    // 10. Alt 定位
    const resAlt = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('alt:Avatar image');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resAlt).toBe('avatar');

    // 11. Role + 名字定位
    const resRoleName = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('role:button[Submit Form]');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resRoleName).toBe('submit-btn');

    // 12. 索引修饰符 (/0, /-1)
    const resIndex0 = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('role:button/0');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resIndex0).toBe('submit-btn');

    const resIndexLast = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('role:button/-1');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resIndexLast).toBe('edit-1');

    // 13. 父级 DOM 标签修饰符 (/tr)
    const resParentTag = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('User A/tr');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resParentTag).toBe('row-1');

    // 14. 别名定位 (支持递归)
    const resAlias = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('@my-btn');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resAlias).toBe('submit-btn');

    const resAliasInput = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('@user-field');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resAliasInput).toBe('username-input');

    // 15. 无前缀的 input 候选 fallback 匹配 (输入时的 placeholder/label 模糊匹配)
    const resFallback = await page.evaluate(async () => {
      const elements = await (window as any).$$rw('Enter username');
      const el = elements[0];
      return el ? el.id : null;
    });
    expect(resFallback).toBe('username-input');
  });
});
