// ============================================================
// checkpoint.ts — Step 级断点续跑
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import type { CheckpointData } from '../types/engine.types.js';
import type { ContextStore } from './context-store.js';

const BASE_DIR = '.resumewright';

export function getSafeCaseNameFromPath(filePath: string): string {
  let relative = filePath;
  if (path.isAbsolute(filePath)) {
    const casesDir = path.resolve(process.cwd(), 'cases');
    relative = path.relative(casesDir, filePath);
    if (relative.startsWith('..')) {
      relative = path.relative(process.cwd(), filePath);
    }
  } else {
    relative = relative.replace(/^cases\//, '');
  }
  const ext = path.extname(relative);
  if (ext) {
    relative = relative.slice(0, -ext.length);
  }
  relative = relative.replace(/\\/g, '/');
  return relative.replace(/[?<>\\:*|"]/g, '_');
}

export function getSafeCaseName(caseName: string, filePath?: string): string {
  if (filePath) {
    return getSafeCaseNameFromPath(filePath);
  }
  return caseName.replace(/[/?<>\\:*|"]/g, '_');
}

/**
 * Checkpoint — 管理单个 Case 的断点续跑状态
 *
 * 使用原子写（先写 .tmp 再 rename）防止写一半崩溃导致数据损坏。
 */
export class Checkpoint {
  private data: CheckpointData;
  private readonly filePath: string;
  private readonly tmpPath: string;

  constructor(caseName: string, baseDir?: string) {
    const safeCaseName = getSafeCaseName(caseName);
    const actualBaseDir = baseDir ?? path.join(BASE_DIR, safeCaseName);
    this.filePath = path.join(actualBaseDir, 'checkpoint.json');
    this.tmpPath = `${this.filePath}.tmp`;

    this.data = {
      caseName,
      completedSteps: [],
      context: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  // ── 加载 ─────────────────────────────────────────────────

  /**
   * 从磁盘加载已有 Checkpoint（重启续跑时调用）
   * 如果不存在则保持初始空状态
   */
  load(): void {
    if (!fs.existsSync(this.filePath)) return;

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as CheckpointData;
      this.data = parsed;
      console.log(
        `[checkpoint] Loaded checkpoint for "${this.data.caseName}": ` +
          `${this.data.completedSteps.length} completed steps`
      );
    } catch (err) {
      console.warn(`[checkpoint] Failed to load checkpoint, starting fresh: ${String(err)}`);
    }
  }

  // ── 查询 ─────────────────────────────────────────────────

  /**
   * 检查某个 Step 是否已完成
   */
  isCompleted(stepId: string): boolean {
    return this.data.completedSteps.includes(stepId);
  }

  /**
   * 获取第一个未完成的步骤 ID（用于日志中显示"从哪个步骤恢复"）
   */
  getResumePoint(): string | undefined {
    return this.data.completedSteps.length > 0
      ? this.data.completedSteps[this.data.completedSteps.length - 1]
      : undefined;
  }

  /**
   * 获取已完成的步骤数量
   */
  completedCount(): number {
    return this.data.completedSteps.length;
  }

  /**
   * 获取当前保存的 Context 变量
   */
  getContext(): Record<string, any> {
    return this.data.context;
  }

  /**
   * 恢复 ContextStore（重启后还原变量）
   */
  restoreContext(ctx: ContextStore): void {
    if (Object.keys(this.data.context).length > 0) {
      ctx.fromJSON(this.data.context);
      console.log(
        `[checkpoint] Restored context: ${Object.keys(this.data.context).join(', ')}`
      );
    }
  }

  // ── 写入 ─────────────────────────────────────────────────

  /**
   * 标记某个 Step 为已完成，并同步持久化 ContextStore 快照
   * 使用原子写防止数据损坏
   */
  markCompleted(stepId: string, ctx: ContextStore): void {
    if (!this.data.completedSteps.includes(stepId)) {
      this.data.completedSteps.push(stepId);
    }
    this.data.context = ctx.toJSON();
    this.data.lastUpdated = new Date().toISOString();
    this.writeAtomic();
  }

  /**
   * 仅更新 context 快照（无需标记 step 完成时使用）
   */
  syncContext(ctx: ContextStore): void {
    this.data.context = ctx.toJSON();
    this.data.lastUpdated = new Date().toISOString();
    this.writeAtomic();
  }

  // ── 重置 ─────────────────────────────────────────────────

  /**
   * 删除 Checkpoint 文件（reset 命令时使用）
   */
  reset(): void {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
      console.log(`[checkpoint] Reset: ${this.filePath}`);
    }
    this.data.completedSteps = [];
    this.data.context = {};
  }

  // ── 工具 ─────────────────────────────────────────────────

  getFilePath(): string {
    return this.filePath;
  }

  /** 原子写：先写 .tmp，再 rename */
  private writeAtomic(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const json = JSON.stringify(this.data, null, 2);
    fs.writeFileSync(this.tmpPath, json, 'utf-8');
    fs.renameSync(this.tmpPath, this.filePath);
  }
}

// ── 静态工具函数 ──────────────────────────────────────────────

/**
 * 列出所有已有 Checkpoint（status 命令使用）
 */
export function listCheckpoints(
  baseDir = BASE_DIR
): CheckpointData[] {
  if (!fs.existsSync(baseDir)) return [];

  const results: CheckpointData[] = [];
  try {
    const files = fs.readdirSync(baseDir);
    for (const f of files) {
      const dirPath = path.join(baseDir, f);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      const cpPath = path.join(dirPath, 'checkpoint.json');
      if (fs.existsSync(cpPath)) {
        try {
          const raw = fs.readFileSync(cpPath, 'utf-8');
          results.push(JSON.parse(raw) as CheckpointData);
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return results;
}

/**
 * 删除所有 Checkpoint（reset --all）
 */
export function resetAllCheckpoints(baseDir = BASE_DIR): void {
  if (!fs.existsSync(baseDir)) return;
  let count = 0;
  try {
    const files = fs.readdirSync(baseDir);
    for (const f of files) {
      const dirPath = path.join(baseDir, f);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      const cpPath = path.join(dirPath, 'checkpoint.json');
      if (fs.existsSync(cpPath)) {
        fs.unlinkSync(cpPath);
        count++;
      }
    }
  } catch { /* ignore */ }
  console.log(`[checkpoint] Reset all (${count} checkpoints cleared)`);
}

/**
 * 清除单个 Case 的运行状态（如断点、子步骤、截图、录像、状态等），但保留 history 目录以确保运行历史不丢失
 */
export function resetCaseRuntime(caseDir: string): void {
  if (!fs.existsSync(caseDir)) return;
  try {
    const items = fs.readdirSync(caseDir);
    for (const item of items) {
      if (item === 'history') continue;
      const itemPath = path.join(caseDir, item);
      fs.rmSync(itemPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`[checkpoint] Failed to reset case runtime at ${caseDir}:`, err);
  }
}

/**
 * 清除单个 Case 的断点和子步骤状态，但保留 API 缓存和 history 目录
 * 用于「重新运行（使用缓存）」场景
 */
export function resetCaseKeepCache(caseDir: string): void {
  if (!fs.existsSync(caseDir)) return;
  try {
    // 清除 checkpoint
    const cpFile = path.join(caseDir, 'checkpoint.json');
    if (fs.existsSync(cpFile)) fs.unlinkSync(cpFile);

    // 清除 sub-steps 下的 state.json 和 snapshots，保留 api-cache.json
    const subStepsDir = path.join(caseDir, 'sub-steps');
    if (fs.existsSync(subStepsDir)) {
      for (const stepDir of fs.readdirSync(subStepsDir)) {
        const stepDirPath = path.join(subStepsDir, stepDir);
        if (!fs.statSync(stepDirPath).isDirectory()) continue;

        // 删除 state.json
        const stateFile = path.join(stepDirPath, 'state.json');
        if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

        // 清空 snapshots 目录
        const snapsDir = path.join(stepDirPath, 'snapshots');
        if (fs.existsSync(snapsDir)) {
          fs.rmSync(snapsDir, { recursive: true, force: true });
          fs.mkdirSync(snapsDir, { recursive: true });
        }
        // api-cache.json 保留不动
      }
    }

    // 清除 traces 和 screenshots，保留 history
    const tracesDir = path.join(caseDir, 'traces');
    if (fs.existsSync(tracesDir)) fs.rmSync(tracesDir, { recursive: true, force: true });

    const screenshotsDir = path.join(caseDir, 'screenshots');
    if (fs.existsSync(screenshotsDir)) fs.rmSync(screenshotsDir, { recursive: true, force: true });
  } catch (err) {
    console.error(`[checkpoint] Failed to reset case (keep cache) at ${caseDir}:`, err);
  }
}

/**
 * 清除所有 Case 的运行状态，但保留所有 history 目录以确保运行历史不丢失
 */
export function resetAllRuntimes(baseDir = BASE_DIR): void {
  if (!fs.existsSync(baseDir)) return;
  try {
    const files = fs.readdirSync(baseDir);
    for (const f of files) {
      const dirPath = path.join(baseDir, f);
      if (fs.statSync(dirPath).isDirectory()) {
        resetCaseRuntime(dirPath);
      }
    }
  } catch (err) {
    console.error(`[checkpoint] Failed to reset all runtimes:`, err);
  }
}
