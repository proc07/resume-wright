// ============================================================
// tests/unit/dsl/visibility-filter.test.ts
// 可见性过滤功能单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveLocator, parseLocator } from '../../../src/dsl/locator-resolver.js';
import { chromium, type Page, expect as pwExpect } from '@playwright/test';

describe('默认可见性过滤', () => {
  let page: Page;
  let browser: any;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    page = await context.newPage();
  });

  afterEach(async () => {
    await browser.close();
  });

  it('should filter out invisible elements by default', async () => {
    await page.setContent(`
      <html><body>
        <div id="visible" style="display:block">Visible Button</div>
        <div id="invisible" style="display:none">Invisible Button</div>
      </body></html>
    `);

    const locator1 = resolveLocator(page, parseLocator('Visible Button'));
    const locator2 = resolveLocator(page, parseLocator('Invisible Button'));

    // 可见元素可定位
    await pwExpect(locator1).toBeVisible();
    // 不可见元素由于默认过滤，count 应为 0
    const count = await locator2.count();
    expect(count).toBe(0);
  });

  it('works with different locator types', async () => {
    await page.setContent(`
      <html><body>
        <input id="visible-input" placeholder="Visible Placeholder" style="display:block">
        <input id="invisible-input" placeholder="Invisible Placeholder" style="display:none">

        <label for="visible-label" style="display:block">Visible Label</label>
        <input id="visible-label" style="display:block">

        <label for="invisible-label" style="display:none">Invisible Label</label>
        <input id="invisible-label" style="display:none">
      </body></html>
    `);

    // 占位符定位
    const visiblePlaceholderLocator = resolveLocator(page, parseLocator('placeholder:Visible Placeholder'));
    const invisiblePlaceholderLocator = resolveLocator(page, parseLocator('placeholder:Invisible Placeholder'));

    // Label 定位
    const visibleLabelLocator = resolveLocator(page, parseLocator('label:Visible Label'));
    const invisibleLabelLocator = resolveLocator(page, parseLocator('label:Invisible Label'));

    await pwExpect(visiblePlaceholderLocator).toBeVisible();
    const countPlaceholder = await invisiblePlaceholderLocator.count();
    expect(countPlaceholder).toBe(0);

    await pwExpect(visibleLabelLocator).toBeVisible();
    const countLabel = await invisibleLabelLocator.count();
    expect(countLabel).toBe(0);
  });

  it('resolveInputLocator filters invisible elements', async () => {
    await page.setContent(`
      <html><body>
        <input placeholder="Username" style="display:none">
        <input placeholder="Username">
      </body></html>
    `);

    const { resolveInputLocator } = await import('../../../src/dsl/locator-resolver.js');
    const locator = resolveInputLocator(page, 'Username');

    // 只返回 visible 的那个
    await pwExpect(locator).toBeVisible();
    const count = await locator.count();
    expect(count).toBe(1);
  });
});
