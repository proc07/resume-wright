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
import { SharedStaticBootstrapCache } from './network-interceptor.js';
import { groupSteps } from './step-grouper.js';
import { executeParallelSteps } from './parallel-executor.js';
import path from 'node:path';
import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  runId: string;
  safeCaseName: string;
  logStream: fs.WriteStream;
}

export const logStorage = new AsyncLocalStorage<LogContext>();

let hooksInstalled = false;
let originalStdoutWrite: typeof process.stdout.write;
let originalStderrWrite: typeof process.stderr.write;

function hookWrite(originalWrite: typeof process.stdout.write) {
  return function(this: any, chunk: any, encoding?: any, callback?: any) {
    const store = logStorage.getStore();
    if (store) {
      const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

      if (store.logStream.writable) {
        store.logStream.write(str);
      }

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

function installHooks() {
  if (hooksInstalled) return;
  originalStdoutWrite = process.stdout.write;
  originalStderrWrite = process.stderr.write;
  process.stdout.write = hookWrite(originalStdoutWrite);
  process.stderr.write = hookWrite(originalStderrWrite);
  hooksInstalled = true;
}

function saveRunHistory(safeCaseName: string, record: {
  runId: string;
  timestamp: string;
  status: 'passed' | 'failed' | 'running';
  duration?: number;
  stepDurations?: Record<string, number>;
  error?: string | null;
  readCache?: boolean;
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
    history[existingIdx] = { ...history[existingIdx], ...record };
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
    installHooks();
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
      error: null,
      readCache: this.opts.readCache ?? false,
    });

    return logStorage.run({ runId, safeCaseName, logStream }, async () => {
      console.log(`\n${'█'.repeat(60)}`);
      console.log(`  CASE: ${caseName}`);
      console.log(`${'█'.repeat(60)}\n`);

      const screenshotDir = path.join(caseDir, 'screenshots');

      const contextStore = new ContextStore();

      // 加载长效持久化变量
      const persistentVarsPath = path.join(caseDir, 'persistent.json');
      if (fs.existsSync(persistentVarsPath)) {
        try {
          const savedData = JSON.parse(fs.readFileSync(persistentVarsPath, 'utf-8'));
          const normalizedData: Record<string, any> = {};
          for (const [rawKey, val] of Object.entries(savedData)) {
            const key = rawKey.startsWith('$') ? rawKey.slice(1) : rawKey;
            normalizedData[key] = val;
          }
          contextStore.merge(normalizedData);
          console.log(`[runner] 📥 Loaded persistent variables: ${Object.keys(normalizedData).join(', ')}`);
        } catch (err) {
          console.error(`[runner] Failed to load persistent variables: ${err}`);
        }
      }

      const checkpoint = new Checkpoint(caseName, caseDir);
      checkpoint.load();
      checkpoint.restoreContext(contextStore);
      contextStore.set('roles', this.definition.roles);
      const effectiveBaseUrl = this.opts.baseUrl ?? this.definition.base_url;
      if (effectiveBaseUrl) {
        contextStore.set('base_url', effectiveBaseUrl);
      }
      
      let projectRoot = process.cwd();
      let dir = path.dirname(path.resolve(this.filePath));
      while (true) {
        const p = path.join(dir, 'config.yaml');
        if (fs.existsSync(p)) {
          projectRoot = dir;
          break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
          break;
        }
        dir = parent;
      }
      contextStore.set('_project_root', projectRoot);

      // 当 contextStore 变动时，自动将最新的变量状态同步至 checkpoint.json，确保子步骤执行和中断续跑能完全还原
      contextStore.onChange((store) => {
        if (!this.opts.readCache) {
          checkpoint.syncContext(store);
        }
      });

      // 计算续跑信息
      const resumedFromStep = checkpoint.getResumePoint();
      if (resumedFromStep) {
        console.log(`[runner] 🔄 Resuming from after step: "${resumedFromStep}"`);
      }

      // 启动浏览器
      const browser = await chromium.launch({
        headless: this.opts.headless ?? true,
      });

      const sharedStaticConfig = this.definition.bootstrap_cache?.shared_static;
      const sharedStaticCache = this.opts.apiCache !== false
        && sharedStaticConfig?.enabled !== false
        && Boolean(sharedStaticConfig)
        && Boolean(effectiveBaseUrl)
        ? new SharedStaticBootstrapCache({
            cacheFilePath: path.join(
              caseDir,
              'bootstrap-cache',
              'shared-static',
              'api-cache.json',
            ),
            baseUrl: effectiveBaseUrl!,
            include: sharedStaticConfig?.include ?? [],
            exclude: sharedStaticConfig?.exclude ?? [],
            readCache: this.opts.readCache ?? false,
            captureRunId: runId,
            ignoreBareNumericQuery: true,
            requestJournalFilePath: this.opts.readCache
              ? path.join(
                  caseDir,
                  'bootstrap-cache',
                  'shared-static',
                  'cache-rerun-api-requests.json',
                )
              : undefined,
          })
        : undefined;

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
          baseUrl: this.opts.baseUrl ?? this.definition.base_url,
          apiCache: this.opts.apiCache,
          readCache: this.opts.readCache ?? false,
          captureRunId: runId,
          roleCacheDir: path.join(caseDir, 'role-cache'),
          sharedStaticCache,
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
        errorScreenshotDir: this.opts.screenshotOnFail
          ? this.opts.readCache
            ? path.join(caseDir, 'cache-rerun-screenshots')
            : screenshotDir
          : '',
        suppressScreenshots: this.opts.readCache ?? false,
        screenshotOnAssert: this.opts.screenshotOnAssert,
        assertTimeout: this.definition.assert_timeout,
        defaultOnFailure: this.definition.on_failure,
        enableTrace: this.opts.enableTrace,
        beforeHooks: this.definition.before_hooks,
        afterHooks: this.definition.after_hooks,
        apiCache: this.opts.apiCache,
        cacheGet: this.opts.cacheGet,
        readCache: this.opts.readCache ?? false,
        captureRunId: runId,
      });

      let completedSteps = checkpoint.completedCount();
      const totalSteps = this.definition.steps.length;
      let lastError: string | undefined;

      const stepDurations: Record<string, number> = {};
      let currentStepId: string | undefined;
      let currentStepStartTime = 0;

      const printStepDurations = () => {
        console.log(`\n[runner] 📋 Step Execution Durations:`);
        for (const step of this.definition.steps) {
          const dur = stepDurations[step.id];
          const isSkipped = checkpoint.isCompleted(step.id) && dur !== undefined;
          const statusSuffix = isSkipped ? ' (skipped)' : '';
          const durStr = dur !== undefined ? formatDuration(dur) : 'pending';
          console.log(`  - ${step.id}: ${durStr}${statusSuffix}`);
        }
      };

      try {
        const units = groupSteps(this.definition.steps);

        const handleStepCompletion = (stepId: string, duration: number) => {
          completedSteps++;
          console.log(`[runner] 🎯 Completed step: ${stepId} (${formatDuration(duration)})`);

          // 保存长效持久化变量
          const persistentKeys = this.definition.persist_vars || [];
          if (persistentKeys.length > 0) {
            const dataToPersist: Record<string, any> = {};
            for (const rawKey of persistentKeys) {
              const key = rawKey.startsWith('$') ? rawKey.slice(1) : rawKey;
              if (contextStore.has(key)) {
                dataToPersist[key] = contextStore.get(key);
              }
            }
            if (Object.keys(dataToPersist).length > 0) {
              try {
                fs.mkdirSync(path.dirname(persistentVarsPath), { recursive: true });
                fs.writeFileSync(persistentVarsPath, JSON.stringify(dataToPersist, null, 2), 'utf-8');
                console.log(`[runner] 💾 Saved persistent variables: ${Object.keys(dataToPersist).join(', ')}`);
              } catch (err) {
                console.error(`[runner] Failed to save persistent variables: ${err}`);
              }
            }
          }
        };

        for (const unit of units) {
          if (unit.type === 'single') {
            const step = unit.step;
            if (!this.opts.readCache && checkpoint.isCompleted(step.id)) {
              console.log(`[runner] ⏭  Skipping completed step: ${step.id}`);
              const savedDurations = checkpoint.getStepDurations();
              if (savedDurations[step.id] !== undefined) {
                stepDurations[step.id] = savedDurations[step.id];
              }
              continue;
            }

            currentStepId = step.id;
            currentStepStartTime = Date.now();
            await stepExecutor.execute(step);
            const stepDuration = Date.now() - currentStepStartTime;
            stepDurations[step.id] = stepDuration;
            currentStepId = undefined;

            handleStepCompletion(step.id, stepDuration);
          } else {
            // 并行步骤组
            const stepsToRun = unit.steps.filter((s) => {
              if (!this.opts.readCache && checkpoint.isCompleted(s.id)) {
                console.log(`[runner] ⏭  Skipping completed step in parallel group: ${s.id}`);
                const savedDurations = checkpoint.getStepDurations();
                if (savedDurations[s.id] !== undefined) {
                  stepDurations[s.id] = savedDurations[s.id];
                }
                return false;
              }
              return true;
            });

            if (stepsToRun.length > 0) {
              const pDurations = await executeParallelSteps(
                stepsToRun,
                contextStore,
                async (step, childStore, createNewPage) => {
                  await stepExecutor.execute(step, {
                    createNewPage,
                    overrideContextStore: childStore,
                  });
                }
              );

              for (const step of stepsToRun) {
                const dur = pDurations[step.id] ?? 0;
                stepDurations[step.id] = dur;
                handleStepCompletion(step.id, dur);
              }
            }
          }
        }

        printStepDurations();
        const duration = Date.now() - startTime;
        console.log(`\n[runner] ✅ Case PASSED: ${caseName} (${formatDuration(duration)})`);

        saveRunHistory(safeCaseName, {
          runId,
          timestamp: new Date(startTime).toISOString(),
          status: 'passed',
          duration,
          stepDurations: { ...stepDurations },
          readCache: this.opts.readCache ?? false,
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

        if (currentStepId && currentStepStartTime > 0) {
          stepDurations[currentStepId] = Date.now() - currentStepStartTime;
        }

        printStepDurations();
        console.error(`\n[runner] ❌ Case FAILED: ${caseName}`);
        console.error(`  Error: ${lastError}`);

        // 失败截图已由 StepExecutor 处理，这里不再重复截图

        saveRunHistory(safeCaseName, {
          runId,
          timestamp: new Date(startTime).toISOString(),
          status: 'failed',
          duration,
          stepDurations: { ...stepDurations },
          readCache: this.opts.readCache ?? false,
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
        };

      } finally {
        await rolePool.closeAll();
        await browser.close();
        logStream.end();
      }
    });
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
