// ============================================================
// step-grouper.ts — 步骤与子步骤并行分组调度算法
// ============================================================

import type { Step, SubStep } from '../types/case.types.js';

export type StepExecutionUnit =
  | { type: 'single'; step: Step }
  | { type: 'parallel'; steps: Step[] };

export type SubStepExecutionUnit =
  | { type: 'single'; subStep: SubStep }
  | { type: 'parallel'; subSteps: SubStep[] };

/**
 * 判断 Step 是否配置了 Step 级别的并行
 */
export function isStepParallel(step: Step): boolean {
  return step.parallel === true || step.parallel === 'step' || step.parallel === 'both';
}

/**
 * 判断 SubStep 是否配置了 SubStep 级别的并行
 */
export function isSubStepParallel(subStep: SubStep): boolean {
  return subStep.parallel === true;
}

/**
 * 判断 Step 是否配置了批量子步骤并行 (parallel_sub_steps: true / parallel: 'sub_steps' / 'both')
 */
export function isParentBulkSubStepParallel(step?: Step): boolean {
  if (!step) return false;
  return (
    step.parallel_sub_steps === true ||
    step.parallel === 'sub_steps' ||
    step.parallel === 'both'
  );
}

/**
 * 将 Case 中的 steps 列表划分为串行执行单元 (single) 与并行执行单元 (parallel)
 */
export function groupSteps(steps: Step[]): StepExecutionUnit[] {
  const units: StepExecutionUnit[] = [];
  let i = 0;
  while (i < steps.length) {
    const current = steps[i]!;
    const isCurrentParallel = isStepParallel(current);
    const isNextParallel = i + 1 < steps.length && isStepParallel(steps[i + 1]!);

    if (isCurrentParallel || isNextParallel) {
      const parallelGroup: Step[] = [current];
      i++;
      while (i < steps.length && isStepParallel(steps[i]!)) {
        parallelGroup.push(steps[i]!);
        i++;
      }
      if (parallelGroup.length === 1) {
        units.push({ type: 'single', step: parallelGroup[0]! });
      } else {
        units.push({ type: 'parallel', steps: parallelGroup });
      }
    } else {
      units.push({ type: 'single', step: current });
      i++;
    }
  }
  return units;
}

/**
 * 将 Step 中的 sub_steps 列表划分为串行执行单元与并行执行单元
 */
export function groupSubSteps(subSteps: SubStep[], parentStep?: Step): SubStepExecutionUnit[] {
  if (isParentBulkSubStepParallel(parentStep)) {
    if (subSteps.length === 0) return [];
    if (subSteps.length === 1) return [{ type: 'single', subStep: subSteps[0]! }];
    return [{ type: 'parallel', subSteps }];
  }

  const units: SubStepExecutionUnit[] = [];
  let i = 0;
  while (i < subSteps.length) {
    const current = subSteps[i]!;
    const isCurrentParallel = isSubStepParallel(current);
    const isNextParallel = i + 1 < subSteps.length && isSubStepParallel(subSteps[i + 1]!);

    if (isCurrentParallel || isNextParallel) {
      const parallelGroup: SubStep[] = [current];
      i++;
      while (i < subSteps.length && isSubStepParallel(subSteps[i]!)) {
        parallelGroup.push(subSteps[i]!);
        i++;
      }
      if (parallelGroup.length === 1) {
        units.push({ type: 'single', subStep: parallelGroup[0]! });
      } else {
        units.push({ type: 'parallel', subSteps: parallelGroup });
      }
    } else {
      units.push({ type: 'single', subStep: current });
      i++;
    }
  }
  return units;
}
