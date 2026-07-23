// ============================================================
// sub-step-executor.ts — SubStep 执行引擎
// ============================================================

import type { Page, BrowserContext } from '@playwright/test';
import type { SubStep } from '../types/case.types.js';
import type { ContextStore } from './context-store.js';
import { SubStepStore } from './sub-step-store.js';
import { DomSnapshotManager } from './dom-snapshot.js';
import { CacheReplayMismatchError, NetworkInterceptor } from './network-interceptor.js';
import { executeScript } from '../dsl/executor.js';
import { sleep } from '../utils.js';
import path from 'node:path';

export interface SubStepExecutorOptions {
  screenshotDir?: string;
  macrosDir?: string;
  subStepsBaseDir?: string;
  screenshotOnAssert?: boolean;
  suppressScreenshots?: boolean;
  assertTimeout?: string | number;
  defaultOnFailure?: import('../types/case.types.js').OnFailureConfig;
  apiCache?: boolean;
  cacheGet?: boolean;
  readCache?: boolean;
  captureRunId?: string;
  isUseStep?: boolean;
}

/**
 * SubStepExecutor — 执行一个 Step 内的所有 SubStep
 *
 * 功能：
 * - 执行前保存 DOM 快照
 * - 已完成的子步骤自动跳过
 * - 按 on_failure 策略重试（可从快照恢复）
 * - 挂载 NetworkInterceptor 防止 API 重复调用
 */
export class SubStepExecutor {
  private readonly store: SubStepStore;
  private readonly snapshotMgr: DomSnapshotManager;
  private readonly interceptor: NetworkInterceptor | null;

  constructor(
    private readonly stepId: string,
    private readonly page: Page,
    private readonly context: BrowserContext,
    private readonly ctx: ContextStore,
    private readonly opts: SubStepExecutorOptions = {}
  ) {
    this.store = new SubStepStore(
      stepId,
      this.opts.subStepsBaseDir,
      this.opts.readCache ? 'cache-rerun' : 'baseline'
    );
    this.store.load();

    this.snapshotMgr = new DomSnapshotManager(this.store.snapshotsDir);

    const useCache = this.opts.apiCache !== false;
    if (useCache) {
      this.interceptor = new NetworkInterceptor(page, this.store.apiCachePath, {
        cacheGet: this.opts.cacheGet,
        readCache: this.opts.readCache,
        stepId: this.stepId,
        captureRunId: this.opts.captureRunId,
        requestJournalFilePath: this.opts.readCache
          ? path.join(path.dirname(this.store.apiCachePath), 'cache-rerun-api-requests.json')
          : undefined,
      });
    } else {
      this.interceptor = null;
    }
  }

  async executeAll(subSteps: SubStep[]): Promise<void> {
    if (this.interceptor) {
      await this.interceptor.attach();
    }

    try {
      for (const subStep of subSteps) {
        await this.executeOne(subStep);
      }
    } finally {
      if (this.interceptor) {
        await this.interceptor.detach();
      }
    }
  }

  private async executeOne(subStep: SubStep): Promise<void> {
    const { id, script, snapshot_before_submit } = subStep;

    // 已完成则跳过（缓存重新运行场景需完整跑一遍 API 回放，不跳过子步骤）
    if (!this.opts.readCache && this.store.isCompleted(id)) {
      console.log(`[sub-step] ⏭  Skipping completed sub-step: ${id}`);
      return;
    }

    const on_failure = subStep.on_failure ?? this.opts.defaultOnFailure;
    const maxRetries = on_failure?.max_retries ?? 0;
    const retryDelay = on_failure?.retry_delay ?? 3000;
    const restoreSnapshot = on_failure?.restore_snapshot ?? false;
    let retryCount = this.store.getRetryCount(id);

    this.interceptor?.beginScopeAttempt(id);

    // 存在历史快照则恢复，否则保存当前状态为执行前快照
    if (this.snapshotMgr.exists(`${id}-before`)) {
      console.log(`[sub-step] Restoring snapshot before execution: ${id}-before`);
      await this.snapshotMgr.restore(`${id}-before`, this.page, this.context);
    } else {
      await this.snapshotMgr.save(`${id}-before`, this.page, this.context);
    }

    while (true) {
      try {
        // snapshot_before_submit：在提交前额外保存快照
        if (snapshot_before_submit) {
          await this.snapshotMgr.save(`${id}-pre-submit`, this.page, this.context);
        }

        if (script) {
          await executeScript(script, this.page, this.ctx, {
            screenshotDir: this.opts.screenshotDir,
            macrosDir: this.opts.macrosDir,
            stepId: id,
            screenshotOnAssert: this.opts.screenshotOnAssert,
            suppressScreenshots: this.opts.suppressScreenshots,
            assertTimeout: this.opts.assertTimeout,
            isUseStep: subStep.is_use_step || this.opts.isUseStep,
          });
        }

        await this.interceptor?.completeScopeAttempt();
        this.store.markCompleted(id);
        console.log(`[sub-step] ✓ Completed: ${id}`);
        return;

      } catch (err) {
        const replayError = await this.interceptor?.failScopeAttempt();
        const failure = replayError ?? err;
        retryCount++;
        const errMsg = String(failure);
        console.error(`[sub-step] ✗ Failed: ${id} (attempt ${retryCount}): ${errMsg}`);

        if (failure instanceof CacheReplayMismatchError) {
          this.store.markFailed(id, errMsg, retryCount);
          throw failure;
        }

        const strategy = on_failure?.strategy ?? 'retry';

        if (strategy === 'skip') {
          console.warn(`[sub-step] Strategy=skip — continuing despite failure`);
          this.store.markFailed(id, errMsg, retryCount);
          return;
        }

        if (strategy === 'manual') {
          this.store.markFailed(id, errMsg, retryCount);
          throw new Error(`Sub-step "${id}" failed (strategy=manual): ${errMsg}`);
        }

        // strategy === 'retry'
        if (retryCount > maxRetries) {
          this.store.markFailed(id, errMsg, retryCount);
          throw new Error(
            `Sub-step "${id}" failed after ${maxRetries} retries: ${errMsg}`
          );
        }

        this.store.markFailed(id, errMsg, retryCount);
        console.log(
          `[sub-step] Retrying in ${retryDelay}ms... (${retryCount}/${maxRetries})`
        );
        await sleep(retryDelay);

        this.interceptor?.beginScopeAttempt(id);

        // 从快照恢复（如果配置了 restore_snapshot）
        if (restoreSnapshot && this.snapshotMgr.exists(`${id}-before`)) {
          console.log(`[sub-step] Restoring snapshot before retry...`);
          await this.snapshotMgr.restore(`${id}-before`, this.page, this.context);
        }
      }
    }
  }
}
