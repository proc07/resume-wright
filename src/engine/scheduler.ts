// ============================================================
// scheduler.ts — 并行调度器
// ============================================================

import path from 'node:path';
import type { CaseDefinition } from '../types/case.types.js';
import type { CaseResult, SchedulerOptions, ReportLine } from '../types/engine.types.js';
import { WorkflowRunner, formatDuration } from './workflow-runner.js';
import { listCheckpoints } from './checkpoint.js';
import { loadAllCases } from '../adapters/yaml-loader.js';

/**
 * Scheduler — 并行执行多个 Case
 *
 * - 使用 p-limit 控制并发 Worker 数量
 * - Promise.allSettled 确保单个失败不影响其他
 * - 自动扫描 cases/ 目录
 * - 支持按文件名 / Tag 过滤
 * - --only-failed 模式：仅运行上次有 Checkpoint 但未完成的 Case
 */
export class Scheduler {
  constructor(
    private readonly casesDir: string = 'cases',
    private readonly opts: SchedulerOptions = {}
  ) {}

  async runAll(
    specificFiles?: string[]
  ): Promise<{ results: CaseResult[]; exitCode: number }> {
    const startTime = Date.now();
    const concurrency = this.opts.concurrency ?? 5;

    // ── 加载 Case 列表 ──
    let cases: Array<{ filePath: string; definition: CaseDefinition }>;

    if (specificFiles && specificFiles.length > 0) {
      cases = [];
      for (const f of specificFiles) {
        try {
          const { loadCase } = await import('../adapters/yaml-loader.js');
          const def = loadCase(f);
          cases.push({ filePath: f, definition: def });
        } catch (err) {
          console.error(`[scheduler] Failed to load ${f}: ${String(err)}`);
        }
      }
    } else {
      cases = await loadAllCases(this.casesDir, this.opts.filter);
    }

    if (cases.length === 0) {
      console.log('[scheduler] No cases found.');
      return { results: [], exitCode: 0 };
    }

    // ── --only-failed 过滤 ──
    if (this.opts.onlyFailed) {
      const checkpoints = listCheckpoints();
      const failedNames = new Set(
        checkpoints
          .filter((cp) => {
            // 未完成的 case（有 checkpoint 但不是所有 step 都完成）
            return cp.completedSteps.length > 0;
          })
          .map((cp) => cp.caseName)
      );
      cases = cases.filter((c) => failedNames.has(c.definition.name));
      console.log(
        `[scheduler] --only-failed: running ${cases.length} case(s) with existing checkpoints`
      );
    }

    console.log(
      `\n${'═'.repeat(62)}`
    );
    console.log(`  ResumeWright — Starting ${cases.length} case(s) | concurrency=${concurrency}`);
    console.log(`${'═'.repeat(62)}\n`);

    // ── 并发执行 ──
    const { default: pLimit } = await import('p-limit');
    const limit = pLimit(concurrency);

    const tasks = cases.map(({ filePath, definition }) =>
      limit(async (): Promise<CaseResult> => {
        const runner = new WorkflowRunner(definition, filePath, {
          headless: this.opts.headless ?? true,
          screenshotOnFail: this.opts.screenshotOnFail ?? true,
          screenshotOnAssert: this.opts.screenshotOnAssert,
          enableTrace: this.opts.enableTrace,
          traceDir: this.opts.traceDir,
        });
        return runner.run();
      })
    );

    const settled = await Promise.allSettled(tasks);

    const results: CaseResult[] = settled.map((s, i) => {
      if (s.status === 'fulfilled') return s.value;
      // Promise 本身 reject（非常罕见，通常 WorkflowRunner 内部已 catch）
      return {
        caseName: cases[i]!.definition.name,
        filePath: cases[i]!.filePath,
        status: 'failed' as const,
        totalSteps: cases[i]!.definition.steps.length,
        completedSteps: 0,
        duration: 0,
        error: String(s.reason),
      };
    });

    const totalDuration = Date.now() - startTime;
    this.printReport(results, totalDuration);

    const exitCode = results.some((r) => r.status === 'failed') ? 1 : 0;
    return { results, exitCode };
  }

  // ── 执行报告 ──────────────────────────────────────────────

  private printReport(results: CaseResult[], totalDuration: number): void {
    const passed = results.filter((r) => r.status === 'passed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;

    const startedAt = new Date(Date.now() - totalDuration).toLocaleString();
    const finishedAt = new Date().toLocaleString();

    console.log(`\n${'═'.repeat(62)}`);
    console.log(`  ResumeWright Execution Report`);
    console.log(`${'═'.repeat(62)}`);
    console.log(`  Started:  ${startedAt}`);
    console.log(`  Finished: ${finishedAt}`);
    console.log(
      `  Duration: ${formatDuration(totalDuration)}  |  Concurrency: ${this.opts.concurrency ?? 5}`
    );
    console.log('');

    for (const r of results) {
      const icon =
        r.status === 'passed' ? '✅' : r.status === 'failed' ? '❌' : '⏭️ ';
      const stepsStr =
        r.status === 'passed' || r.completedSteps === r.totalSteps
          ? `${r.totalSteps} steps`
          : `${r.completedSteps}/${r.totalSteps} steps`;
      const durationStr = formatDuration(r.duration);
      const resumeNote = r.resumedFromStep
        ? `  [resumed from ${r.resumedFromStep}]`
        : '';
      const failNote =
        r.status === 'failed' && r.error
          ? `  ${truncate(r.error, 60)}`
          : '';

      console.log(
        `  ${icon}  ${padEnd(r.caseName, 24)}  ${padEnd(stepsStr, 12)}  ${padEnd(durationStr, 8)}${resumeNote}${failNote}`
      );
    }

    console.log(`\n  ${'─'.repeat(58)}`);
    console.log(
      `  Total: ${results.length}  |  ✅ Passed: ${passed}  |  ❌ Failed: ${failed}  |  ⏭️  Skipped: ${skipped}`
    );

    if (failed > 0) {
      console.log(`\n  Failed details:`);
      for (const r of results.filter((r) => r.status === 'failed')) {
        console.log(`    ${r.caseName}`);
        if (r.error) console.log(`      → ${r.error}`);
        if (r.screenshotPath)
          console.log(`      screenshot: ${r.screenshotPath}`);
      }
    }

    console.log(`${'═'.repeat(62)}\n`);
  }
}

// ── 工具 ─────────────────────────────────────────────────────

function padEnd(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 3) + '...';
}
