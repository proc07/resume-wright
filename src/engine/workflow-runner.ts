// ============================================================
// workflow-runner.ts — 单 Case 完整执行器
// ============================================================

import { chromium } from '@playwright/test';
import type { CaseDefinition } from '../types/case.types.js';
import type { CaseResult, WorkflowRunnerOptions } from '../types/engine.types.js';
import { ContextStore } from './context-store.js';
import { Checkpoint, getSafeCaseName } from './checkpoint.js';
import { RolePool } from './role-pool.js';
import { StepExecutor } from './step-executor.js';
import { getFormattedDateTime } from './datetime-utils.js';
import path from 'node:path';
import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  runId: string;
  safeCaseName: string;
  logStream: fs.WriteStream;
}

export const logStorage = new AsyncLocalStorage<LogContext>();

const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

function hookWrite(originalWrite: typeof process.stdout.write) {
  return function(this: any, chunk: any, encoding?: any, callback?: any) {
    const store = logStorage.getStore();
    if (store) {
      const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      
      // 写入到专属历史日志文件
      if (store.logStream.writable) {
        store.logStream.write(str);
      }

      // 为总控制台增加前缀以实现按用例分流
      const tagged = str
        .split('\n')
        .map((line: string, idx: number, arr: string[]) => {
          if (idx === arr.length - 1 && line === '') return '';
          return `[case:${encodeURIComponent(store.safeCaseName)}]${line}`;
        })
        .join('\n');

      return originalWrite.call(this, tagged, encoding, callback);
    }
    return originalWrite.call(this, chunk, encoding, callback);
  } as any;
}

process.stdout.write = hookWrite(originalStdoutWrite);
process.stderr.write = hookWrite(originalStderrWrite);

function saveRunHistory(safeCaseName: string, record: {
  runId: string;
  timestamp: string;
  status: 'passed' | 'failed' | 'running';
  duration?: number;
  error?: string | null;
}) {
  const historyFile = path.join('.resumewright', safeCaseName, 'history', 'history.json');
  let history: any[] = [];
  try {
    const dir = path.dirname(historyFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(historyFile)) {
      history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    }
  } catch { /* ignore */ }

  const existingIdx = history.findIndex(r => r.runId === record.runId);
  if (existingIdx >= 0) {
    history[existingIdx] = record;
  } else {
    history.unshift(record);
  }

  try {
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf-8');
  } catch (err) {
    console.error('[runner] Failed to save history:', err);
  }
}

/**
 * WorkflowRunner — 执行单个 Case 的完整生命周期
 */
export class WorkflowRunner {
  constructor(
    private readonly definition: CaseDefinition,
    private readonly filePath: string,
    private readonly opts: WorkflowRunnerOptions = {}
  ) {}

  async run(): Promise<CaseResult> {
    const startTime = Date.now();
    const caseName = this.definition.name;
    const safeCaseName = getSafeCaseName(caseName, this.filePath);
    const caseDir = path.join('.resumewright', safeCaseName);
    const historyDir = path.join(caseDir, 'history');
    fs.mkdirSync(historyDir, { recursive: true });

    const runId = `run_${getFormattedDateTime().replace(/[-:_]/g, '')}_${Math.random().toString(36).substring(2, 6)}`;
    const logFilePath = path.join(historyDir, `${runId}.log`);
    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

    saveRunHistory(safeCaseName, {
      runId,
      timestamp: new Date(startTime).toISOString(),
      status: 'running',
      error: null
    });

    return logStorage.run({ runId, safeCaseName, logStream }, async () => {
      console.log(`\n${'█'.repeat(60)}`);
      console.log(`  CASE: ${caseName}`);
      console.log(`${'█'.repeat(60)}\n`);

      const screenshotDir = path.join(caseDir, 'screenshots');

      const contextStore = new ContextStore();
      const checkpoint = new Checkpoint(caseName, caseDir);
      checkpoint.load();
      checkpoint.restoreContext(contextStore);
      contextStore.set('roles', this.definition.roles);
      if (this.definition.base_url) {
        contextStore.set('base_url', this.definition.base_url);
      }

      // 计算续跑信息
      const resumedFromStep = checkpoint.getResumePoint();
      if (resumedFromStep) {
        console.log(`[runner] 🔄 Resuming from after step: "${resumedFromStep}"`);
      }

      // 启动浏览器
      const browser = await chromium.launch({
        headless: this.opts.headless ?? true,
      });

      // 初始化 RolePool
      const rolePool = new RolePool(
        browser,
        this.definition.roles,
        {
          sessionCheckUrl: this.opts.sessionCheckUrl,
          headless: this.opts.headless ?? true,
          enableTrace: this.opts.enableTrace,
          traceDir: this.opts.traceDir ?? path.join(caseDir, 'traces'),
          loginMacroPath: this.definition.login_macro_path ?? this.opts.loginMacroPath,
        },
        path.join(caseDir, 'states')
      );

      const stepExecutor = new StepExecutor({
        browser,
        rolePool,
        contextStore,
        checkpoint,
        caseName,
        caseDir,
        screenshotDir: this.opts.screenshotOnFail ? screenshotDir : '',
        screenshotOnAssert: this.opts.screenshotOnAssert,
        defaultOnFailure: this.definition.on_failure,
        enableTrace: this.opts.enableTrace,
        beforeHooks: this.definition.before_hooks,
        afterHooks: this.definition.after_hooks,
        apiCache: this.opts.apiCache,
        cacheGet: this.opts.cacheGet,
      });

      let completedSteps = checkpoint.completedCount();
      const totalSteps = this.definition.steps.length;
      let lastError: string | undefined;
      let errorScreenshotPath: string | undefined;

      try {
        for (const step of this.definition.steps) {
          // 已完成步骤直接跳过
          if (checkpoint.isCompleted(step.id)) {
            console.log(`[runner] ⏭  Skipping completed step: ${step.id}`);
            continue;
          }

          await stepExecutor.execute(step);
          completedSteps++;
        }

        const duration = Date.now() - startTime;
        console.log(`\n[runner] ✅ Case PASSED: ${caseName} (${formatDuration(duration)})`);

        saveRunHistory(safeCaseName, {
          runId,
          timestamp: new Date(startTime).toISOString(),
          status: 'passed',
          duration,
          error: null
        });

        return {
          caseName,
          filePath: this.filePath,
          status: 'passed',
          totalSteps,
          completedSteps,
          resumedFromStep,
          duration,
        };

      } catch (err) {
        lastError = String(err);
        const duration = Date.now() - startTime;

        console.error(`\n[runner] ❌ Case FAILED: ${caseName}`);
        console.error(`  Error: ${lastError}`);

        // 失败截图
        if (this.opts.screenshotOnFail) {
          try {
            errorScreenshotPath = await this.captureErrorScreenshot(
              rolePool,
              screenshotDir,
              caseName
            );
          } catch { /* ignore */ }
        }

        saveRunHistory(safeCaseName, {
          runId,
          timestamp: new Date(startTime).toISOString(),
          status: 'failed',
          duration,
          error: lastError
        });

        return {
          caseName,
          filePath: this.filePath,
          status: 'failed',
          totalSteps,
          completedSteps,
          resumedFromStep,
          duration,
          error: lastError,
          screenshotPath: errorScreenshotPath,
        };

      } finally {
        await rolePool.closeAll();
        await browser.close();
        logStream.end();
      }
    });
  }

  private async captureErrorScreenshot(
    rolePool: RolePool,
    dir: string,
    caseName: string
  ): Promise<string | undefined> {
    fs.mkdirSync(dir, { recursive: true });
    const ssPath = path.join(
      dir,
      `${getSafeCaseName(caseName)}-error-${getFormattedDateTime()}.png`
    );

    // 对所有活跃角色都截图
    for (const role of Object.keys(this.definition.roles)) {
      try {
        const { page } = await rolePool.getRoleContext(role);
        await page.screenshot({ path: ssPath });
        return ssPath;
      } catch { /* try next */ }
    }
    return undefined;
  }
}

// ── 时间格式化 ────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${remainSecs}s`;
}
