// ============================================================
// parallel-executor.ts — 并行 Step 与 SubStep 调度执行器
// ============================================================

import type { Step, SubStep } from '../types/case.types.js';
import type { ContextStore } from './context-store.js';

export interface ParallelStepExecutionOptions {
  failFast?: boolean;
  concurrency?: number;
  onStepStart?: (step: Step) => void;
  onStepComplete?: (step: Step, duration: number) => void;
}

export interface ParallelSubStepExecutionOptions {
  failFast?: boolean;
  concurrency?: number;
  onSubStepStart?: (subStep: SubStep) => void;
  onSubStepComplete?: (subStep: SubStep) => void;
}

/**
 * 通用并发控制辅助函数 (支持限流与 fail_fast)
 */
async function runConcurrentTasks<T>(
  items: T[],
  taskFn: (item: T) => Promise<void>,
  options: { failFast?: boolean; concurrency?: number } = {}
): Promise<void> {
  const failFast = options.failFast ?? true;
  const limit = options.concurrency && options.concurrency > 0 ? options.concurrency : items.length;

  if (items.length === 0) return;

  if (failFast) {
    // 熔断模式：任一任务报错立刻 reject 终止 Promise.all
    let index = 0;
    const workers: Promise<void>[] = [];

    const runWorker = async () => {
      while (index < items.length) {
        const itemIdx = index++;
        const item = items[itemIdx]!;
        await taskFn(item);
      }
    };

    const workerCount = Math.min(limit, items.length);
    for (let w = 0; w < workerCount; w++) {
      workers.push(runWorker());
    }

    await Promise.all(workers);
  } else {
    // 汇总模式：等待所有任务执行完毕，再抛出汇总错误
    const errors: Array<{ item: T; error: unknown }> = [];
    let index = 0;
    const workers: Promise<void>[] = [];

    const runWorker = async () => {
      while (index < items.length) {
        const itemIdx = index++;
        const item = items[itemIdx]!;
        try {
          await taskFn(item);
        } catch (err) {
          errors.push({ item, error: err });
        }
      }
    };

    const workerCount = Math.min(limit, items.length);
    for (let w = 0; w < workerCount; w++) {
      workers.push(runWorker());
    }

    await Promise.all(workers);

    if (errors.length > 0) {
      const msgs = errors.map(e => String(e.error)).join('\n');
      throw new Error(`[parallel-executor] ${errors.length} parallel task(s) failed:\n${msgs}`);
    }
  }
}

/**
 * 并行执行多个 Step
 */
export async function executeParallelSteps(
  steps: Step[],
  parentContextStore: ContextStore,
  executeStepFn: (step: Step, childStore: ContextStore, createNewPage: boolean) => Promise<void>,
  options: ParallelStepExecutionOptions = {}
): Promise<Record<string, number>> {
  console.log(`[parallel] 🚀 Launching ${steps.length} parallel steps: ${steps.map(s => s.id).join(', ')}`);

  // 校验 Role 使用频率，若多个并发 Step 使用同一个 Role，标记 createNewPage = true
  const roleCounts: Record<string, number> = {};
  for (const s of steps) {
    roleCounts[s.role] = (roleCounts[s.role] || 0) + 1;
  }

  const childStores = new Map<string, ContextStore>();
  const durations: Record<string, number> = {};

  for (const s of steps) {
    childStores.set(s.id, parentContextStore.createChildStore());
  }

  const failFast = options.failFast ?? (steps.every(s => s.fail_fast !== false));
  const concurrency = options.concurrency ?? steps.reduce((min, s) => (s.concurrency ? Math.min(min, s.concurrency) : min), steps.length);

  await runConcurrentTasks(
    steps,
    async (step) => {
      const childStore = childStores.get(step.id)!;
      const needsNewPage = (roleCounts[step.role] || 0) > 1;
      const startTime = Date.now();

      options.onStepStart?.(step);
      console.log(`[parallel] ▶ Starting step "${step.id}" (role: ${step.role})`);

      await executeStepFn(step, childStore, needsNewPage);

      const duration = Date.now() - startTime;
      durations[step.id] = duration;
      options.onStepComplete?.(step, duration);
      console.log(`[parallel] ✓ Completed step "${step.id}" (${duration}ms)`);
    },
    { failFast, concurrency }
  );

  // 所有并发 Step 顺利完成后，按顺序将 childStores 合并回主 parentContextStore
  for (const step of steps) {
    const childStore = childStores.get(step.id);
    if (childStore) {
      parentContextStore.mergeChildStore(childStore);
    }
  }

  return durations;
}

/**
 * 并行执行多个 SubStep
 */
export async function executeParallelSubSteps(
  subSteps: SubStep[],
  parentContextStore: ContextStore,
  executeSubStepFn: (subStep: SubStep, childStore: ContextStore) => Promise<void>,
  options: ParallelSubStepExecutionOptions = {}
): Promise<void> {
  console.log(`[parallel] 🚀 Launching ${subSteps.length} parallel sub-steps: ${subSteps.map(s => s.id).join(', ')}`);

  const childStores = new Map<string, ContextStore>();

  for (const ss of subSteps) {
    childStores.set(ss.id, parentContextStore.createChildStore());
  }

  const failFast = options.failFast ?? true;

  await runConcurrentTasks(
    subSteps,
    async (subStep) => {
      const childStore = childStores.get(subStep.id)!;
      options.onSubStepStart?.(subStep);
      console.log(`[parallel] ▶ Starting sub-step "${subStep.id}"`);

      await executeSubStepFn(subStep, childStore);

      options.onSubStepComplete?.(subStep);
      console.log(`[parallel] ✓ Completed sub-step "${subStep.id}"`);
    },
    { failFast, concurrency: options.concurrency }
  );

  // 所有并发 SubStep 顺利完成后，将 childStores 合并回 parentContextStore
  for (const ss of subSteps) {
    const childStore = childStores.get(ss.id);
    if (childStore) {
      parentContextStore.mergeChildStore(childStore);
    }
  }
}
