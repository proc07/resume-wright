// ============================================================
// workflow-runner.ts — 单 Case 完整执行器
// ============================================================

import { chromium } from '@playwright/test';
import type { CaseDefinition } from '../types/case.types.js';
import type { CaseResult, WorkflowRunnerOptions } from '../types/engine.types.js';
import { ContextStore } from './context-store.js';
import { Checkpoint } from './checkpoint.js';
import { RolePool } from './role-pool.js';
import { StepExecutor } from './step-executor.js';
import { getFormattedDateTime } from './datetime-utils.js';
import path from 'node:path';
import fs from 'node:fs';

/**
 * WorkflowRunner — 执行单个 Case 的完整生命周期
 *
 * 流程：
 * 1. 启动 Browser
 * 2. 加载 Checkpoint（已完成 Steps 自动跳过）
 * 3. 恢复 ContextStore
 * 4. 按序执行每个 Step
 * 5. 关闭 RolePool
 * 6. 返回执行结果
 */
export class WorkflowRunner {
  constructor(
    private readonly definition: CaseDefinition,
    private readonly filePath: string,
    private readonly opts: WorkflowRunnerOptions = {}
  ) {}

  async run(): Promise<CaseResult> {
    const startTime = Date.now();
    const caseName = this.definition.name;

    console.log(`\n${'█'.repeat(60)}`);
    console.log(`  CASE: ${caseName}`);
    console.log(`${'█'.repeat(60)}\n`);

    const safeCaseName = caseName.replace(/[/?<>\\:*|"]/g, '_');
    const caseDir = path.join('.resumewright', safeCaseName);
    const screenshotDir = path.join(caseDir, 'screenshots');

    // ── 初始化核心组件 ──
    const contextStore = new ContextStore();
    const checkpoint = new Checkpoint(caseName, caseDir);
    checkpoint.load();
    checkpoint.restoreContext(contextStore);

    // 计算续跑信息
    const resumedFromStep = checkpoint.getResumePoint();
    if (resumedFromStep) {
      console.log(`[runner] 🔄 Resuming from after step: "${resumedFromStep}"`);
    }

    // 启动浏览器
    const browser = await chromium.launch({
      headless: this.opts.headless ?? true,
    });

    // 初始化 RolePool
    const rolePool = new RolePool(
      browser,
      this.definition.roles,
      {
        sessionCheckUrl: this.opts.sessionCheckUrl,
        headless: this.opts.headless ?? true,
        enableTrace: this.opts.enableTrace,
        traceDir: this.opts.traceDir ?? path.join(caseDir, 'traces'),
      },
      path.join(caseDir, 'states')
    );

    const stepExecutor = new StepExecutor({
      browser,
      rolePool,
      contextStore,
      checkpoint,
      caseName,
      screenshotDir: this.opts.screenshotOnFail ? screenshotDir : '',
    });

    let completedSteps = checkpoint.completedCount();
    const totalSteps = this.definition.steps.length;
    let lastError: string | undefined;
    let errorScreenshotPath: string | undefined;

    try {
      for (const step of this.definition.steps) {
        // 已完成步骤直接跳过
        if (checkpoint.isCompleted(step.id)) {
          console.log(`[runner] ⏭  Skipping completed step: ${step.id}`);
          continue;
        }

        await stepExecutor.execute(step);
        completedSteps++;
      }

      const duration = Date.now() - startTime;
      console.log(`\n[runner] ✅ Case PASSED: ${caseName} (${formatDuration(duration)})`);

      return {
        caseName,
        filePath: this.filePath,
        status: 'passed',
        totalSteps,
        completedSteps,
        resumedFromStep,
        duration,
      };

    } catch (err) {
      lastError = String(err);
      const duration = Date.now() - startTime;

      console.error(`\n[runner] ❌ Case FAILED: ${caseName}`);
      console.error(`  Error: ${lastError}`);

      // 失败截图
      if (this.opts.screenshotOnFail) {
        try {
          errorScreenshotPath = await this.captureErrorScreenshot(
            rolePool,
            screenshotDir,
            caseName
          );
        } catch { /* ignore */ }
      }

      return {
        caseName,
        filePath: this.filePath,
        status: 'failed',
        totalSteps,
        completedSteps,
        resumedFromStep,
        duration,
        error: lastError,
        screenshotPath: errorScreenshotPath,
      };

    } finally {
      await rolePool.closeAll();
      await browser.close();
    }
  }

  private async captureErrorScreenshot(
    rolePool: RolePool,
    dir: string,
    caseName: string
  ): Promise<string | undefined> {
    fs.mkdirSync(dir, { recursive: true });
    const ssPath = path.join(
      dir,
      `${caseName.replace(/[/?<>\\:*|"]/g, '_')}-error-${getFormattedDateTime()}.png`
    );

    // 对所有活跃角色都截图
    for (const role of Object.keys(this.definition.roles)) {
      try {
        const { page } = await rolePool.getRoleContext(role);
        await page.screenshot({ path: ssPath });
        return ssPath;
      } catch { /* try next */ }
    }
    return undefined;
  }
}

// ── 时间格式化 ────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${remainSecs}s`;
}
