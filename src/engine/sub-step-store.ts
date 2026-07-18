// ============================================================
// sub-step-store.ts — 子步骤级存储管理
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import type { SubStepStateMap } from '../types/engine.types.js';

const SUB_STEPS_DIR = '.resumewright/sub-steps';

/**
 * SubStepStore — 管理单个 Step 内所有子步骤的状态
 *
 * 目录结构：
 * .resumewright/sub-steps/<stepId>/
 *   ├── state.json        # 各子步骤完成状态
 *   ├── api-cache.json    # 该 Step 内 API 响应缓存
 *   └── snapshots/        # 子步骤快照
 */
export class SubStepStore {
  private state: SubStepStateMap = {};
  private readonly stateFilePath: string;
  readonly apiCachePath: string;
  readonly snapshotsDir: string;

  constructor(
    private readonly stepId: string,
    baseDir: string = SUB_STEPS_DIR,
    runtimeKind: 'baseline' | 'cache-rerun' = 'baseline'
  ) {
    const safeId = stepId.replace(/[^\w-]/g, '_');
    const stepDir = path.join(baseDir, safeId);
    const prefix = runtimeKind === 'cache-rerun' ? 'cache-rerun-' : '';

    this.stateFilePath = path.join(stepDir, `${prefix}state.json`);
    this.apiCachePath = path.join(stepDir, 'api-cache.json');
    this.snapshotsDir = path.join(stepDir, `${prefix}snapshots`);
  }

  // ── 加载 ─────────────────────────────────────────────────

  /**
   * 从磁盘加载子步骤状态（续跑时调用）
   */
  load(): void {
    if (!fs.existsSync(this.stateFilePath)) return;
    try {
      this.state = JSON.parse(
        fs.readFileSync(this.stateFilePath, 'utf-8')
      ) as SubStepStateMap;
      console.log(
        `[sub-step-store] Loaded state for step "${this.stepId}": ` +
          `${Object.keys(this.state).length} sub-steps tracked`
      );
    } catch (err) {
      console.warn(`[sub-step-store] Failed to load state: ${String(err)}`);
    }
  }

  // ── 查询 ─────────────────────────────────────────────────

  isCompleted(subStepId: string): boolean {
    return this.state[subStepId]?.status === 'completed';
  }

  isFailed(subStepId: string): boolean {
    return this.state[subStepId]?.status === 'failed';
  }

  getRetryCount(subStepId: string): number {
    return this.state[subStepId]?.retryCount ?? 0;
  }

  getState(): SubStepStateMap {
    return { ...this.state };
  }

  // ── 写入 ─────────────────────────────────────────────────

  markCompleted(subStepId: string): void {
    this.state[subStepId] = {
      status: 'completed',
      completedAt: new Date().toISOString(),
    };
    this.persist();
  }

  markFailed(subStepId: string, error: string, retryCount = 0): void {
    this.state[subStepId] = {
      status: 'failed',
      error,
      retryCount,
    };
    this.persist();
  }

  markPending(subStepId: string): void {
    this.state[subStepId] = { status: 'pending' };
    this.persist();
  }

  // ── 持久化 ───────────────────────────────────────────────

  private persist(): void {
    const dir = path.dirname(this.stateFilePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(this.snapshotsDir, { recursive: true });

    const tmpPath = `${this.stateFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.stateFilePath);
  }

  // ── 清理 ─────────────────────────────────────────────────

  /**
   * 重置该 Step 的所有子步骤状态（用于整个 Step 重试）
   */
  reset(): void {
    this.state = {};
    const dir = path.dirname(this.stateFilePath);
    if (fs.existsSync(this.stateFilePath)) {
      fs.unlinkSync(this.stateFilePath);
    }
    // 清空快照目录
    if (fs.existsSync(this.snapshotsDir)) {
      fs.rmSync(this.snapshotsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.snapshotsDir, { recursive: true });
  }
}
