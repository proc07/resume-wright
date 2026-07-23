import { describe, it, expect } from 'vitest';
import { groupSteps, groupSubSteps } from '../../../src/engine/step-grouper.js';
import type { Step, SubStep } from '../../../src/types/case.types.js';

describe('Step Grouper', () => {
  it('should group sequential steps when no parallel flag is present', () => {
    const steps: Step[] = [
      { id: 's1', role: 'admin' },
      { id: 's2', role: 'user' },
      { id: 's3', role: 'admin' },
    ];
    const units = groupSteps(steps);
    expect(units).toEqual([
      { type: 'single', step: steps[0] },
      { type: 'single', step: steps[1] },
      { type: 'single', step: steps[2] },
    ]);
  });

  it('should group consecutive parallel steps into a parallel unit', () => {
    const steps: Step[] = [
      { id: 's1', role: 'admin' },
      { id: 's2', role: 'user', parallel: true },
      { id: 's3', role: 'buyer', parallel: true },
      { id: 's4', role: 'admin' },
    ];
    const units = groupSteps(steps);
    expect(units.length).toBe(2);
    expect(units[0]).toEqual({
      type: 'parallel',
      steps: [steps[0], steps[1], steps[2]],
    });
    expect(units[1]).toEqual({
      type: 'single',
      step: steps[3],
    });
  });

  it('should handle multiple separate parallel groups', () => {
    const steps: Step[] = [
      { id: 's1', role: 'admin' },
      { id: 's2', role: 'user', parallel: true },
      { id: 's3', role: 'admin' },
      { id: 's4', role: 'user', parallel: true },
    ];
    const units = groupSteps(steps);
    expect(units.length).toBe(2);
    expect(units[0]).toEqual({ type: 'parallel', steps: [steps[0], steps[1]] });
    expect(units[1]).toEqual({ type: 'parallel', steps: [steps[2], steps[3]] });
  });

  it('should group sub_steps with bulk parallel_sub_steps flag on parent step', () => {
    const parentStep: Step = {
      id: 'step_bulk',
      role: 'admin',
      parallel_sub_steps: true,
    };
    const subSteps: SubStep[] = [
      { id: 'ss1', script: 'open "/"' },
      { id: 'ss2', script: 'open "/2"' },
      { id: 'ss3', script: 'open "/3"' },
    ];
    const units = groupSubSteps(subSteps, parentStep);
    expect(units).toEqual([
      { type: 'parallel', subSteps },
    ]);
  });

  it('should group sub_steps individually when parallel: true is set on sub_steps', () => {
    const subSteps: SubStep[] = [
      { id: 'ss1', script: 'open "/"' },
      { id: 'ss2', script: 'open "/2"', parallel: true },
      { id: 'ss3', script: 'open "/3"' },
    ];
    const units = groupSubSteps(subSteps);
    expect(units.length).toBe(2);
    expect(units[0]).toEqual({
      type: 'parallel',
      subSteps: [subSteps[0], subSteps[1]],
    });
    expect(units[1]).toEqual({
      type: 'single',
      subStep: subSteps[2],
    });
  });
});
