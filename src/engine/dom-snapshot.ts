// ============================================================
// dom-snapshot.ts — 页面快照与状态恢复
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import type { Page, BrowserContext } from '@playwright/test';
import type { DomSnapshot } from '../types/engine.types.js';

/**
 * DomSnapshotManager — 保存和恢复页面状态
 *
 * 快照内容：url + storageState + pageState（title / data-state）
 */
export class DomSnapshotManager {
  constructor(private readonly snapshotsDir: string) {}

  // ── 保存快照 ──────────────────────────────────────────────

  /**
   * 保存当前页面快照到磁盘
   * @param id     快照标识（通常为 subStepId）
   * @param page   Playwright Page
   * @param context BrowserContext（用于获取 storageState）
   */
  async save(id: string, page: Page, context: BrowserContext): Promise<string> {
    const url = page.url();
    const timestamp = Date.now();

    let storageState: DomSnapshot['storageState'] = { cookies: [], origins: [] };
    try {
      storageState = await context.storageState() as DomSnapshot['storageState'];
    } catch (err) {
      console.warn(`[dom-snapshot] Failed to get storageState: ${String(err)}`);
    }

    let title = '';
    let stateIndicator: string | undefined;
    try {
      title = await page.title();
      const stateLoc = page.locator('[data-state]').first();
      if (await stateLoc.count() > 0) {
        stateIndicator = await stateLoc
          .getAttribute('data-state', { timeout: 1000 })
          .catch(() => undefined) ?? undefined;
      }
    } catch { /* ignore */ }

    let formState: any[] = [];
    try {
      if (url && url !== 'about:blank') {
        formState = await page.evaluate(() => {
          const inputs: any[] = [];
          document.querySelectorAll('input, textarea, select').forEach((el: any, index) => {
            if (el.type === 'file') return;
            
            let selector = '';
            if (el.id) {
              selector = `#${el.id}`;
            } else if (el.name) {
              selector = `${el.tagName.toLowerCase()}[name="${el.name}"]`;
            } else {
              selector = `${el.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
            }

            inputs.push({
              selector,
              tagName: el.tagName.toLowerCase(),
              type: el.type,
              value: el.value,
              checked: el.checked,
              index,
            });
          });
          return inputs;
        });
      }
    } catch (err) {
      console.warn(`[dom-snapshot] Failed to get formState: ${String(err)}`);
    }

    const snapshot: DomSnapshot = {
      id,
      url,
      timestamp,
      storageState,
      pageState: { title, stateIndicator },
      formState,
    };

    const filePath = this.getSnapshotPath(id);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

    console.log(`[dom-snapshot] 📸 Saved snapshot: ${id} @ ${url}`);
    return filePath;
  }

  // ── 恢复快照 ──────────────────────────────────────────────

  /**
   * 从快照恢复页面状态
   * 1. 重置 Cookie / Storage
   * 2. page.goto(snapshot.url)
   * 3. 等待页面加载
   */
  async restore(id: string, page: Page, context: BrowserContext): Promise<void> {
    const snapshot = this.load(id);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${id}`);
    }

    console.log(`[dom-snapshot] 🔄 Restoring snapshot: ${id} @ ${snapshot.url}`);

    // 清除当前 cookies
    await context.clearCookies();

    // 恢复 cookies
    if (snapshot.storageState.cookies.length > 0) {
      await context.addCookies(
        snapshot.storageState.cookies as unknown as Parameters<typeof context.addCookies>[0]
      );
    }

    // 恢复 localStorage（通过注入 JS）
    for (const origin of snapshot.storageState.origins) {
      if (origin.localStorage.length > 0) {
        try {
          await page.goto(origin.origin, { waitUntil: 'domcontentloaded' });
          await page.evaluate((items: Array<{ name: string; value: string }>) => {
            for (const { name, value } of items) {
              window.localStorage.setItem(name, value);
            }
          }, origin.localStorage);
        } catch { /* ignore */ }
      }
    }

    // 导航回快照 URL
    await page.goto(snapshot.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // 恢复表单值
    const formState = (snapshot as any).formState;
    if (formState && formState.length > 0) {
      try {
        await page.evaluate((inputs) => {
          inputs.forEach((item: any) => {
            const el = document.querySelectorAll('input, textarea, select')[item.index] 
              || document.querySelector(item.selector);
            if (!el) return;
            if (item.type === 'checkbox' || item.type === 'radio') {
              (el as any).checked = item.checked;
            } else {
              (el as any).value = item.value;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }, formState);
      } catch (err) {
        console.warn(`[dom-snapshot] Failed to restore formState: ${String(err)}`);
      }
    }

    console.log(`[dom-snapshot] ✓ Restored to: ${snapshot.url}`);
  }

  // ── 加载 / 检查 ───────────────────────────────────────────

  load(id: string): DomSnapshot | null {
    const filePath = this.getSnapshotPath(id);
    if (!fs.existsSync(filePath)) return null;

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DomSnapshot;
    } catch {
      return null;
    }
  }

  exists(id: string): boolean {
    return fs.existsSync(this.getSnapshotPath(id));
  }

  // ── 路径工具 ──────────────────────────────────────────────

  private getSnapshotPath(id: string): string {
    const safe = id.replace(/[^\w-]/g, '_');
    return path.join(this.snapshotsDir, `${safe}.json`);
  }

  getSnapshotsDir(): string {
    return this.snapshotsDir;
  }
}
