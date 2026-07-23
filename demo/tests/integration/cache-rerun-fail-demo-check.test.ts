// demo/tests/integration/cache-rerun-fail-demo-check.test.ts
//
// 端到端校验 cache-rerun-fail-demo 用例的完整流程与数据隔离性
// 
// 策略：
//   1. 先通过 CLI 执行 baseline / cache-rerun 运行（直接子进程调用 run.ts）
//   2. 启动 Dashboard 后在浏览器里校验 UI 状态的正确性
//
// 这样避免了 vitest 进程内启动 Dashboard 后通过 process.argv[1] 构建子进程命令
// 导致执行失败的问题。
import { describe, it, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium, expect as pwExpect, type Browser, type Page } from '@playwright/test';
import { startDashboardServer } from '../../../src/dashboard/server.js';
import { spawn } from 'node:child_process';

const DEMO_DIR = path.resolve(import.meta.dirname, '../../');
let demoServerProc: any;
let dashboardPort: number = 3190;
let dashboardUrl: string = '';
let browser: Browser;
let page: Page;

function runCli(args: string) {
  return execSync(`npx tsx ${path.resolve(DEMO_DIR, '../run.ts')} ${args}`, {
    cwd: DEMO_DIR,
    stdio: 'pipe',
    timeout: 30000,
  }).toString();
}

beforeAll(async () => {
  // 1. 启动 Demo Mock Server (61775)
  demoServerProc = spawn('npx', ['tsx', 'server.ts'], {
    cwd: DEMO_DIR,
    stdio: 'ignore',
  });
  await new Promise(resolve => setTimeout(resolve, 2500));

  // 2. 先确保重置所有用例状态
  runCli('reset --all');

  // 3. 启动 Dashboard Server
  dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
  process.chdir(DEMO_DIR);
  startDashboardServer(dashboardPort);
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 4. 启动 Playwright 浏览器
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

afterAll(async () => {
  if (browser) await browser.close();
  if (demoServerProc) demoServerProc.kill();
});

describe('cache-rerun-fail-demo Case 端到端验证与数据隔离检查', () => {
  it('完成全流程操作与多项断言校验', async () => {
    // ==========================================
    // 阶段一：验证清除后的干净状态
    // ==========================================
    console.log('[Test] 阶段一：验证清除后的干净状态');
    await page.goto(dashboardUrl);
    await page.waitForLoadState('networkidle');

    // 选中 cache-rerun-fail-demo 用例
    const caseItem = page.locator('.case-item', { hasText: 'cache-rerun-fail-demo' });
    await pwExpect(caseItem).toBeVisible({ timeout: 10000 });
    await caseItem.click();
    await pwExpect(page.locator('.case-header h2')).toHaveText('cache-rerun-fail-demo', { timeout: 5000 });

    // 校验：用例状态为未运行
    const statusBadge = page.locator('.case-title-row .badge');
    await pwExpect(statusBadge).toHaveText('未运行', { timeout: 10000 });

    // 校验："首次"和"缓存" Tab 应当不可见
    const modeTabs = page.locator('.mode-switch-tabs');
    await pwExpect(modeTabs).not.toBeVisible();
    console.log('[Test] 阶段一通过：清除后数据已彻底清空，Tab已重置。');

    // ==========================================
    // 阶段二：通过 CLI 执行 Baseline 首次运行，然后刷新 Dashboard 校验
    // ==========================================
    console.log('[Test] 阶段二：通过 CLI 执行 Baseline 首次运行');
    const baselineOutput = runCli('run cases/workflows/cache-rerun-fail-demo.yaml');
    console.log('[Test] Baseline 完成:', baselineOutput.includes('PASSED') ? '✅ PASSED' : '❌ FAILED');

    // 刷新页面以获取最新的后端数据
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 重新选中用例
    await caseItem.click();
    await pwExpect(page.locator('.case-header h2')).toHaveText('cache-rerun-fail-demo', { timeout: 5000 });

    // 校验：用例状态为执行通过
    await pwExpect(statusBadge).toHaveText('执行通过', { timeout: 10000 });

    // 检查 Step 1 ~ Step 4 的状态
    console.log('[Test] 阶段二：检查 4 个 Step 的状态与右侧面板');
    const stepNodes = page.locator('.step-node');
    await pwExpect(stepNodes).toHaveCount(4);

    for (let i = 0; i < 4; i++) {
      const stepNode = stepNodes.nth(i);
      // 校验 step 显示已完成 (包含 class completed)
      await pwExpect(stepNode).toHaveClass(/completed/);
    }

    // 校验"缓存" Tab 的隔离性：此时没有缓存重跑数据，"缓存" Tab 不可见
    const cacheTabBtn = page.locator('.mode-tab-btn', { hasText: '缓存' });
    await pwExpect(cacheTabBtn).not.toBeVisible();
    console.log('[Test] 阶段二通过：首次运行每个 Step 均成功，"缓存" Tab 保持为空未受影响。');

    // ==========================================
    // 阶段三：通过 CLI 执行缓存重跑，然后刷新 Dashboard 校验
    // ==========================================
    console.log('[Test] 阶段三：通过 CLI 执行缓存重跑');
    try {
      runCli('run --read-cache cases/workflows/cache-rerun-fail-demo.yaml');
    } catch {
      // 预期缓存重跑会失败（step 3 异化报错），忽略非零退出码
      console.log('[Test] 缓存重跑如预期失败');
    }

    // 刷新页面以获取最新数据
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 重新选中用例
    await caseItem.click();
    await pwExpect(page.locator('.case-header h2')).toHaveText('cache-rerun-fail-demo', { timeout: 5000 });

    // 手动切换到缓存 Tab
    await pwExpect(cacheTabBtn).toBeVisible({ timeout: 5000 });
    await cacheTabBtn.click();

    // 校验：缓存 Tab 下 Header 状态应为"执行失败"
    await pwExpect(statusBadge).toHaveText('执行失败', { timeout: 10000 });

    // 校验缓存 Tab 中的步骤状态
    // Step 1、Step 2 完成
    const cacheStep1 = page.locator('.step-node').nth(0);
    const cacheStep2 = page.locator('.step-node').nth(1);
    await pwExpect(cacheStep1).toHaveClass(/completed/);
    await pwExpect(cacheStep2).toHaveClass(/completed/);

    // Step 3 失败
    const cacheStep3 = page.locator('.step-node').nth(2);
    await pwExpect(cacheStep3).toHaveClass(/failed/);

    // Step 4 未执行（既不是 completed 也不是 failed）
    const cacheStep4 = page.locator('.step-node').nth(3);
    await pwExpect(cacheStep4).not.toHaveClass(/completed/);
    await pwExpect(cacheStep4).not.toHaveClass(/failed/);

    // ==========================================
    // 阶段四：切回"首次" Tab 检查隔离性
    // ==========================================
    console.log('[Test] 阶段四：切回首次 Tab 检查隔离性');
    const firstTabBtn = page.locator('.mode-tab-btn', { hasText: '首次' });
    await pwExpect(firstTabBtn).toBeVisible();
    await firstTabBtn.click();

    // 校验切回"首次" Tab 后，Header 状态恢复显示首次通过
    await pwExpect(statusBadge).toHaveText('执行通过', { timeout: 10000 });

    // 校验："首次" Tab 视图下绝不展示 "确认跳过" 按钮与 "▶ 继续执行" 按钮
    const skipStepBtn = page.locator('.btn-skip-step');
    await pwExpect(skipStepBtn).not.toBeVisible();

    const continueRunBtn = page.locator('#btn-run-case', { hasText: '继续执行' });
    await pwExpect(continueRunBtn).not.toBeVisible();

    // 4 个 step 全部依然显示 completed
    for (let i = 0; i < 4; i++) {
      const stepNode = page.locator('.step-node').nth(i);
      await pwExpect(stepNode).toHaveClass(/completed/);
    }

    console.log('[Test] 阶段四通过：缓存重跑数据正确，"首次" Tab 数据完全未受干扰！');

    // ==========================================
    // 阶段五：清除后验证全面恢复干净状态
    // ==========================================
    console.log('[Test] 阶段五：点击清除按钮，验证全面恢复');
    const clearBtn = page.locator('#btn-reset-case');
    await pwExpect(clearBtn).toBeVisible({ timeout: 5000 });
    await clearBtn.click();

    // 弹窗确认
    const confirmClearModalBtn = page.locator('button', { hasText: '确认清除' });
    await pwExpect(confirmClearModalBtn).toBeVisible({ timeout: 5000 });
    await confirmClearModalBtn.click();
    await page.waitForTimeout(1500);

    // 校验：用例状态恢复为未运行
    await pwExpect(statusBadge).toHaveText('未运行', { timeout: 10000 });

    // 校验："首次"和"缓存" Tab 应当不可见
    await pwExpect(modeTabs).not.toBeVisible();

    console.log('[Test] 阶段五通过：清除后数据全面恢复干净状态！');
    console.log('[Test] ✅ 全部 5 个阶段校验通过！');
  }, 120000);
});
