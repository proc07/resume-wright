// ============================================================
// step-executor.ts — Step 执行引擎
// ============================================================

import type { Step } from '../types/case.types.js';
import type { StepExecutionContext } from '../types/engine.types.js';
import { NetworkInterceptor } from './network-interceptor.js';
import { SubStepExecutor } from './sub-step-executor.js';
import { executeScript } from '../dsl/executor.js';
import { getFormattedDateTime } from './datetime-utils.js';
import path from 'node:path';

/**
 * StepExecutor — 执行单个 Step
 *
 * 执行顺序：
 * 1. 从 RolePool 获取角色 Page
 * 2. 挂载 NetworkInterceptor
 * 3. 若有 sub_steps → SubStepExecutor
 *    否则 → 直接执行 script
 * 4. 更新 Checkpoint
 */
export class StepExecutor {
  constructor(private readonly execCtx: StepExecutionContext) {}

  async execute(step: Step): Promise<void> {
    const { rolePool, contextStore, checkpoint, caseName, screenshotDir } =
      this.execCtx;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[step] ▶ Executing step: ${step.id} (role: ${step.role})`);
    console.log(`${'═'.repeat(60)}`);

    const maxRetries = step.on_failure?.max_retries ?? 0;
    const retryDelay = step.on_failure?.retry_delay ?? 3000;
    const strategy = step.on_failure?.strategy ?? 'retry';
    let attempt = 0;

    while (true) {
      try {
        await this.runStep(step);
        checkpoint.markCompleted(step.id, contextStore);
        console.log(`[step] ✓ Step completed: ${step.id}`);
        return;
      } catch (err) {
        attempt++;
        const errMsg = String(err);
        console.error(`[step] ✗ Step failed: ${step.id} (attempt ${attempt}): ${errMsg}`);

        // 失败截图
        if (this.execCtx.screenshotDir) {
          try {
            const { context, page } = await rolePool.getRoleContext(step.role);
            const ssDir = screenshotDir;
            const { mkdirSync } = await import('node:fs');
            mkdirSync(ssDir, { recursive: true });
            const ssPath = path.join(ssDir, `${step.id}-error-${getFormattedDateTime()}.png`);
            await page.screenshot({ path: ssPath });
            console.log(`[step] 📸 Error screenshot: ${ssPath}`);
          } catch { /* ignore */ }
        }

        if (strategy === 'skip') {
          console.warn(`[step] Strategy=skip — marking step as completed despite failure`);
          checkpoint.markCompleted(step.id, contextStore);
          return;
        }

        if (strategy === 'manual') {
          throw new Error(`Step "${step.id}" failed (strategy=manual): ${errMsg}`);
        }

        // strategy === 'retry'
        if (attempt > maxRetries) {
          throw new Error(
            `Step "${step.id}" failed after ${maxRetries} retries: ${errMsg}`
          );
        }

        console.log(`[step] Retrying in ${retryDelay}ms... (${attempt}/${maxRetries})`);
        await sleep(retryDelay);
      }
    }
  }

  private async runStep(step: Step): Promise<void> {
    const { rolePool, contextStore, caseName, screenshotDir } = this.execCtx;

    // 获取角色的 Page 和 BrowserContext
    const { page, context } = await rolePool.getRoleContext(step.role);

    // 基于 caseName 计算该 case 的专属根路径
    const safeCaseName = caseName.replace(/[/?<>\\:*|"]/g, '_');
    const caseDir = path.join('.resumewright', safeCaseName);

    // API 缓存路径
    const apiCachePath = path.join(
      caseDir,
      'sub-steps',
      step.id.replace(/[^\w-]/g, '_'),
      'api-cache.json'
    );

    if (step.sub_steps && step.sub_steps.length > 0) {
      // ── 有子步骤：使用 SubStepExecutor ──
      const subExec = new SubStepExecutor(
        step.id,
        page,
        context,
        contextStore,
        {
          screenshotDir,
          macrosDir: 'macros',
          subStepsBaseDir: path.join(caseDir, 'sub-steps'),
        }
      );
      await subExec.executeAll(step.sub_steps);
    } else if (step.script) {
      // ── 无子步骤：直接执行 script，并挂载 NetworkInterceptor ──
      const interceptor = new NetworkInterceptor(page, apiCachePath);
      await interceptor.attach();

      try {
        await executeScript(step.script, page, contextStore, {
          screenshotDir,
          macrosDir: 'macros',
          stepId: step.id,
        });
      } finally {
        await interceptor.detach();
      }
    } else {
      console.warn(`[step] Step "${step.id}" has no script or sub_steps — skipping`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
