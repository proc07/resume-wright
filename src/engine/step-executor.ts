// ============================================================
// step-executor.ts — Step 执行引擎
// ============================================================

import type { Step } from '../types/case.types.js';
import type { StepExecutionContext } from '../types/engine.types.js';
import type { ContextStore } from './context-store.js';
import { NetworkInterceptor } from './network-interceptor.js';
import { SubStepExecutor } from './sub-step-executor.js';
import { executeScript } from '../dsl/executor.js';
import { getFormattedDateTime } from './datetime-utils.js';
import { sleep } from '../utils.js';
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

  async execute(
    step: Step,
    options: { createNewPage?: boolean; overrideContextStore?: ContextStore } = {}
  ): Promise<void> {
    const { rolePool, checkpoint, caseName, screenshotDir } = this.execCtx;
    const contextStore = options.overrideContextStore ?? this.execCtx.contextStore;
    const errorScreenshotDir = this.execCtx.errorScreenshotDir ?? screenshotDir;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[step] ▶ Executing step: ${step.id} (role: ${step.role})`);
    console.log(`${'═'.repeat(60)}`);

    const defaultOnFailure = this.execCtx.defaultOnFailure;
    const stepOnFailure = step.on_failure ?? defaultOnFailure;

    const maxRetries = stepOnFailure?.max_retries ?? 0;
    const retryDelay = stepOnFailure?.retry_delay ?? 3000;
    const strategy = stepOnFailure?.strategy ?? 'retry';
    let attempt = 0;

    const startTime = Date.now();

    while (true) {
      try {
        await this.runStep(step, options);
        const duration = Date.now() - startTime;
        if (!this.execCtx.readCache) {
          checkpoint.markCompleted(step.id, contextStore, duration);
        }
        console.log(`[step] ✓ Step completed: ${step.id}`);
        return;
      } catch (err) {
        attempt++;
        const errMsg = String(err);
        console.error(`[step] ✗ Step failed: ${step.id} (attempt ${attempt}): ${errMsg}`);

        if (strategy === 'skip') {
          console.warn(`[step] Strategy=skip — marking step as completed despite failure`);
          // skip 策略时截图
          if (errorScreenshotDir) {
            try {
              const roleCtx = rolePool.getActiveRoleContext(step.role);
              if (roleCtx) {
                const ssDir = errorScreenshotDir;
                const { mkdirSync } = await import('node:fs');
                mkdirSync(ssDir, { recursive: true });
                const ssPath = path.join(ssDir, `${step.id}-error-${getFormattedDateTime()}.png`);
                await roleCtx.page.screenshot({ path: ssPath });
                console.log(`[step] 📸 Error screenshot: ${decodeURIComponent(ssPath)}`);
              }
            } catch { /* ignore */ }
          }
          const duration = Date.now() - startTime;
          if (!this.execCtx.readCache) {
            checkpoint.markCompleted(step.id, contextStore, duration);
          }
          return;
        }

        if (strategy === 'manual') {
          if (errorScreenshotDir) {
            try {
              const roleCtx = rolePool.getActiveRoleContext(step.role);
              if (roleCtx) {
                const { mkdirSync } = await import('node:fs');
                mkdirSync(errorScreenshotDir, { recursive: true });
                const ssPath = path.join(
                  errorScreenshotDir,
                  `${step.id}-error-${getFormattedDateTime()}.png`
                );
                await roleCtx.page.screenshot({ path: ssPath });
                console.log(`[step] 📸 Error screenshot: ${decodeURIComponent(ssPath)}`);
              }
            } catch { /* ignore */ }
          }
          throw new Error(`Step "${step.id}" failed (strategy=manual): ${errMsg}`);
        }

        // strategy === 'retry'
        if (attempt > maxRetries) {
          // 最终失败时才截图
          if (errorScreenshotDir) {
            try {
              const roleCtx = rolePool.getActiveRoleContext(step.role);
              if (roleCtx) {
                const ssDir = errorScreenshotDir;
                const { mkdirSync } = await import('node:fs');
                mkdirSync(ssDir, { recursive: true });
                const ssPath = path.join(ssDir, `${step.id}-error-${getFormattedDateTime()}.png`);
                await roleCtx.page.screenshot({ path: ssPath });
                console.log(`[step] 📸 Error screenshot: ${decodeURIComponent(ssPath)}`);
              }
            } catch { /* ignore */ }
          }
          throw new Error(
            `Step "${step.id}" failed after ${maxRetries} retries: ${errMsg}`
          );
        }

        console.log(`[step] Retrying in ${retryDelay}ms... (${attempt}/${maxRetries})`);
        await sleep(retryDelay);
      }
    }
  }

  private async runStep(
    step: Step,
    options: { createNewPage?: boolean; overrideContextStore?: ContextStore } = {}
  ): Promise<void> {
    const { rolePool, caseName, screenshotDir, screenshotOnAssert, assertTimeout } = this.execCtx;
    const contextStore = options.overrideContextStore ?? this.execCtx.contextStore;

    // ── 源匹配自动登录保护逻辑 ──
    // 静态提取当前步骤（或子步骤）中首条 open 目标地址。如果目标是一个绝对路径 URL，
    // 且其 Origin 协议域名与全局的 base_url 不符（例如去访问 bilibili 等外部站点），
    // 则判定需要跨域，触发 skipLogin 保护，使得角色池管理器跳过自动登录与 Session 缓存。
    let skipLogin = false;
    const baseUrl = contextStore.get('base_url') as string | undefined;
    let firstOpenUrl: string | null = null;
    if (step.script) {
      firstOpenUrl = this.getFirstOpenUrl(step.script);
    } else if (step.sub_steps) {
      for (const subStep of step.sub_steps) {
        if (subStep.script) {
          firstOpenUrl = this.getFirstOpenUrl(subStep.script);
          if (firstOpenUrl) break;
        }
      }
    }

    if (firstOpenUrl && baseUrl) {
      const isAbsolute = firstOpenUrl.startsWith('http://') || firstOpenUrl.startsWith('https://');
      if (isAbsolute) {
        try {
          const firstOpenOrigin = new URL(firstOpenUrl).origin;
          const baseOrigin = new URL(baseUrl).origin;
          if (firstOpenOrigin !== baseOrigin) {
            skipLogin = true;
          }
        } catch { /* ignore invalid URL */ }
      }
    }

    // 获取角色的 Page 和 BrowserContext
    const { page, context } = await rolePool.getRoleContext(step.role, {
      skipLogin,
      createNewPage: options.createNewPage,
    });

    // 动态注入当前角色的属性及凭证信息，便于 DSL 脚本和宏直接读取，无需显式传参
    const creds = rolePool.getCredentials(step.role);
    if (creds) {
      for (const [key, value] of Object.entries(creds)) {
        contextStore.set(key, value);
      }
    }
    // 动态注入所有角色配置，便于通过 $roles.roleName.prop 形式进行跨角色属性查询
    contextStore.set('roles', rolePool.getRoles());

    const caseDir = this.execCtx.caseDir;

    // API 缓存路径
    const stepRuntimeDir = path.join(
      caseDir,
      'sub-steps',
      step.id.replace(/[^\w-]/g, '_')
    );
    const apiCachePath = path.join(stepRuntimeDir, 'api-cache.json');

    let tracingStarted = false;
    const traceDir = path.join(
      caseDir,
      this.execCtx.readCache ? 'cache-rerun-traces' : 'traces'
    );
    const tracePath = path.join(traceDir, `${step.id}-trace.zip`);

    if (this.execCtx.enableTrace) {
      try {
        const fs = await import('node:fs');
        fs.mkdirSync(traceDir, { recursive: true });
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        tracingStarted = true;
      } catch (err) {
        console.error(`[step] Failed to start tracing: ${err}`);
      }
    }

    try {
      if (this.execCtx.beforeHooks) {
        await executeScript(this.execCtx.beforeHooks, page, contextStore, {
          screenshotDir,
          macrosDir: 'macros',
          stepId: `${step.id}-before`,
          screenshotOnAssert,
          suppressScreenshots: this.execCtx.suppressScreenshots,
          assertTimeout,
        });
      }

      try {
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
              screenshotOnAssert,
              suppressScreenshots: this.execCtx.suppressScreenshots,
              assertTimeout,
              defaultOnFailure: step.on_failure ?? this.execCtx.defaultOnFailure,
              apiCache: this.execCtx.apiCache,
              cacheGet: this.execCtx.cacheGet,
              readCache: this.execCtx.readCache,
              captureRunId: this.execCtx.captureRunId,
              isUseStep: step.is_use_step,
            }
          );
          await subExec.executeAll(step.sub_steps, step);
        } else if (step.script) {
          // ── 无子步骤：直接执行 script ──
          const useCache = this.execCtx.apiCache !== false;
          if (useCache) {
            const interceptor = new NetworkInterceptor(page, apiCachePath, {
              cacheGet: this.execCtx.cacheGet,
              readCache: this.execCtx.readCache,
              stepId: step.id,
              captureRunId: this.execCtx.captureRunId,
              requestJournalFilePath: this.execCtx.readCache
                ? path.join(stepRuntimeDir, 'cache-rerun-api-requests.json')
                : undefined,
            });
            interceptor.beginScopeAttempt();
            await interceptor.attach();
            try {
              await executeScript(step.script, page, contextStore, {
                screenshotDir,
                macrosDir: 'macros',
                stepId: step.id,
                screenshotOnAssert,
                suppressScreenshots: this.execCtx.suppressScreenshots,
                assertTimeout,
                isUseStep: step.is_use_step,
              });
              await interceptor.completeScopeAttempt();

              const stateFileName = this.execCtx.readCache ? 'cache-rerun-state.json' : 'state.json';
              const statePath = path.join(stepRuntimeDir, stateFileName);
              try {
                const fs = await import('node:fs');
                fs.mkdirSync(stepRuntimeDir, { recursive: true });
                fs.writeFileSync(statePath, JSON.stringify({
                  $step: { status: 'completed' }
                }, null, 2), 'utf-8');
              } catch { /* ignore */ }
            } catch (err) {
              const replayError = await interceptor.failScopeAttempt();
              const stateFileName = this.execCtx.readCache ? 'cache-rerun-state.json' : 'state.json';
              const statePath = path.join(stepRuntimeDir, stateFileName);
              try {
                const fs = await import('node:fs');
                fs.mkdirSync(stepRuntimeDir, { recursive: true });
                fs.writeFileSync(statePath, JSON.stringify({
                  $step: { status: 'failed', error: String(err) }
                }, null, 2), 'utf-8');
              } catch { /* ignore */ }
              throw replayError ?? err;
            } finally {
              await interceptor.detach();
            }
          } else {
            await executeScript(step.script, page, contextStore, {
              screenshotDir,
              macrosDir: 'macros',
              stepId: step.id,
              screenshotOnAssert,
              suppressScreenshots: this.execCtx.suppressScreenshots,
              assertTimeout,
              isUseStep: step.is_use_step,
            });
          }
        } else {
          console.warn(`[step] Step "${step.id}" has no script or sub_steps — skipping`);
        }
      } finally {
        if (this.execCtx.afterHooks) {
          await executeScript(this.execCtx.afterHooks, page, contextStore, {
            screenshotDir,
            macrosDir: 'macros',
            stepId: `${step.id}-after`,
            screenshotOnAssert,
            suppressScreenshots: this.execCtx.suppressScreenshots,
            assertTimeout,
          }).catch((err) => {
            console.error(`[step] Failed to execute after_step hook: ${err}`);
          });
        }
      }
    } finally {
      if (tracingStarted) {
        try {
          await context.tracing.stop({ path: tracePath });
          console.log(`[step] ✓ Tracing file saved: ${decodeURIComponent(tracePath)}`);
        } catch (err) {
          console.error(`[step] Failed to stop tracing: ${err}`);
        }
      }
    }
  }

  private getFirstOpenUrl(script: string): string | null {
    const lines = script.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^open\s+(".*?"|'.*?'|\S+)/);
      if (match) {
        return match[1]!.replace(/^['"]|['"]$/g, '');
      }
    }
    return null;
  }
}
