import { describe, it, expect, vi } from 'vitest';
import { executeParallelSteps, executeParallelSubSteps } from '../../../src/engine/parallel-executor.js';
import { ContextStore } from '../../../src/engine/context-store.js';
import type { Step, SubStep } from '../../../src/types/case.types.js';

describe('Parallel Executor', () => {
  it('should execute parallel steps concurrently and merge child context stores', async () => {
    const parentStore = new ContextStore();
    parentStore.set('global_var', 'initial');

    const steps: Step[] = [
      { id: 's1', role: 'admin' },
      { id: 's2', role: 'user', parallel: true },
    ];

    const order: string[] = [];

    const executeStepFn = vi.fn(async (step: Step, childStore: ContextStore, createNewPage: boolean) => {
      order.push(`start:${step.id}`);
      expect(childStore.get('global_var')).toBe('initial');
      expect(createNewPage).toBe(false); // different roles: admin & user

      // Simulate async work
      await new Promise((resolve) => setTimeout(resolve, step.id === 's1' ? 50 : 10));

      childStore.set(`output_${step.id}`, `val_${step.id}`);
      order.push(`finish:${step.id}`);
    });

    const durations = await executeParallelSteps(steps, parentStore, executeStepFn);

    expect(order).toEqual(['start:s1', 'start:s2', 'finish:s2', 'finish:s1']);
    expect(parentStore.get('output_s1')).toBe('val_s1');
    expect(parentStore.get('output_s2')).toBe('val_s2');
    expect(durations['s1']).toBeGreaterThanOrEqual(40);
    expect(durations['s2']).toBeGreaterThanOrEqual(10);
  });

  it('should set createNewPage = true when multiple parallel steps share the same role', async () => {
    const parentStore = new ContextStore();
    const steps: Step[] = [
      { id: 's1', role: 'requester' },
      { id: 's2', role: 'requester', parallel: true },
    ];

    const pageCreationFlags: Record<string, boolean> = {};

    await executeParallelSteps(steps, parentStore, async (step, _childStore, createNewPage) => {
      pageCreationFlags[step.id] = createNewPage;
    });

    expect(pageCreationFlags['s1']).toBe(true);
    expect(pageCreationFlags['s2']).toBe(true);
  });

  it('should handle failFast in parallel steps execution', async () => {
    const parentStore = new ContextStore();
    const steps: Step[] = [
      { id: 's1', role: 'admin' },
      { id: 's2', role: 'user', parallel: true },
    ];

    const executeStepFn = vi.fn(async (step: Step) => {
      if (step.id === 's1') {
        throw new Error('Step 1 failed');
      }
    });

    await expect(
      executeParallelSteps(steps, parentStore, executeStepFn, { failFast: true })
    ).rejects.toThrow('Step 1 failed');
  });

  it('should execute parallel sub-steps and merge context store', async () => {
    const parentStore = new ContextStore();
    const subSteps: SubStep[] = [
      { id: 'ss1', script: 'open "/"' },
      { id: 'ss2', script: 'open "/2"' },
    ];

    await executeParallelSubSteps(subSteps, parentStore, async (subStep, childStore) => {
      childStore.set(`ss_var_${subStep.id}`, true);
    });

    expect(parentStore.get('ss_var_ss1')).toBe(true);
    expect(parentStore.get('ss_var_ss2')).toBe(true);
  });
});
