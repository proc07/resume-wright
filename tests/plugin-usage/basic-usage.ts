// ============================================================
// tests/plugin-usage/basic-usage.ts
// 演示如何在真实项目中以插件形式使用 ResumeWright
//
// 场景：将 resumewright 作为 npm 包安装后，
//       在自己的项目中导入并使用
// ============================================================

/**
 * ─────────────────────────────────────────────────────────────
 * 安装（在你的项目中）：
 *
 *   npm install resumewright
 *
 * 或使用本地路径（开发阶段）：
 *   npm install /path/to/resume-wright
 * ─────────────────────────────────────────────────────────────
 */

// ── 用法一：直接使用 Scheduler 运行整个 cases/ 目录 ──────────

import { Scheduler } from '../../src/index.js';

async function runAllCases() {
  const scheduler = new Scheduler('cases', {
    concurrency: 3,          // 同时最多运行 3 个 Case
    headless: true,          // 无头模式
    screenshotOnFail: true,  // 失败时截图
  });

  const { results, exitCode } = await scheduler.runAll();

  console.log(`\n共 ${results.length} 个 Case，退出码: ${exitCode}`);
  return exitCode;
}

// ── 用法二：运行单个 Case 并获取结构化结果 ────────────────────

import { WorkflowRunner } from '../../src/index.js';
import { loadCase } from '../../src/index.js';

async function runSingleCase(yamlPath: string) {
  const definition = loadCase(yamlPath);

  const runner = new WorkflowRunner(definition, yamlPath, {
    headless: false,         // 有头模式（调试用）
    screenshotOnFail: true,
  });

  const result = await runner.run();

  if (result.status === 'passed') {
    console.log(`✅ ${result.caseName} — ${result.completedSteps} steps in ${result.duration}ms`);
  } else {
    console.error(`❌ ${result.caseName} — ${result.error}`);
  }

  return result;
}

// ── 用法三：单独使用 DSL 执行器（嵌入已有 Playwright 测试）────

import { chromium } from '@playwright/test';
import { executeScript, ContextStore } from '../../src/index.js';

async function runDslInExistingTest() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 使用 ContextStore 管理变量
  const ctx = new ContextStore();
  ctx.set('base_url', 'https://your-app.example.com');

  // 执行 DSL 脚本（可直接内嵌在你的测试文件里）
  await executeScript(`
    open "$base_url/purchase/new"
    input "Q3 办公设备采购" to "label:申请标题"
    input "50000"           to "label:申请金额"
    tap "role:button[提交申请]"

    $workflow_url = CURRENT_URL
    $workflow_id  = URL_MATCH "/purchase/([\\w-]+)"

    assert_exists "申请已提交" 10s
    screenshot
  `, page, ctx, {
    screenshotDir: '.resumewright/screenshots',
    stepId: 'my-custom-step',
  });

  console.log('Workflow URL:', ctx.get('workflow_url'));
  console.log('Workflow ID:', ctx.get('workflow_id'));

  await browser.close();
}

// ── 用法四：使用 Checkpoint 实现自定义断点续跑 ───────────────

import { Checkpoint } from '../../src/index.js';

async function customResumeLogic(caseName: string) {
  const checkpoint = new Checkpoint(caseName);
  checkpoint.load();

  const steps = ['step1_create', 'step2_manager', 'step3_finance'];
  const ctx = new ContextStore();
  checkpoint.restoreContext(ctx); // 恢复变量（如 workflow_url）

  for (const stepId of steps) {
    if (checkpoint.isCompleted(stepId)) {
      console.log(`⏭ Skipping: ${stepId}`);
      continue;
    }

    console.log(`▶ Running: ${stepId}`);
    // ... 执行步骤 ...
    checkpoint.markCompleted(stepId, ctx);
  }
}

// ── 用法五：在 Playwright Test (@playwright/test) 中集成 ────

/**
 * my-workflow.spec.ts
 *
 * import { test, expect } from '@playwright/test';
 * import { executeScript, ContextStore } from 'resumewright';
 *
 * test('采购申请全流程', async ({ page }) => {
 *   const ctx = new ContextStore();
 *
 *   await executeScript(`
 *     open "https://app.example.com/purchase/new"
 *     input "测试采购申请" to "label:申请标题"
 *     tap "role:button[提交申请]"
 *     $workflow_url = CURRENT_URL
 *     assert_exists "申请已提交" 10s
 *   `, page, ctx);
 *
 *   expect(ctx.get('workflow_url')).toContain('/purchase/');
 * });
 */

export {
  runAllCases,
  runSingleCase,
  runDslInExistingTest,
  customResumeLogic,
};
