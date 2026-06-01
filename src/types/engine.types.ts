// ============================================================
// engine.types.ts — 引擎运行时类型定义
// ============================================================

import type { Browser, BrowserContext, Page } from '@playwright/test';

/** 调度器选项 */
export interface SchedulerOptions {
  concurrency?: number;       // 最大并发 Case 数，默认 5
  headless?: boolean;         // 无头模式，默认 true
  retryFailed?: boolean;      // 自动重试失败的 Case
  screenshotOnFail?: boolean; // 失败时截图
  filter?: string[];          // 按文件名过滤
  onlyFailed?: boolean;       // 仅运行上次失败的 Case
  enableTrace?: boolean;
  traceDir?: string;
}

/** 单个 Case 执行选项 */
export interface WorkflowRunnerOptions {
  headless?: boolean;
  screenshotOnFail?: boolean;
  sessionCheckUrl?: string;   // Role Pool Session 校验 URL
  enableTrace?: boolean;
  traceDir?: string;
}

/** Step 执行上下文 */
export interface StepExecutionContext {
  browser: Browser;
  rolePool: import('../engine/role-pool.js').RolePool;
  contextStore: import('../engine/context-store.js').ContextStore;
  checkpoint: import('../engine/checkpoint.js').Checkpoint;
  caseName: string;
  screenshotDir: string;
  defaultOnFailure?: import('./case.types.js').OnFailureConfig;
}

/** Case 执行结果 */
export interface CaseResult {
  caseName: string;
  filePath: string;
  status: 'passed' | 'failed' | 'skipped';
  totalSteps: number;
  completedSteps: number;
  resumedFromStep?: string;
  duration: number;           // ms
  error?: string;
  screenshotPath?: string;
}

/** Checkpoint 持久化格式 */
export interface CheckpointData {
  caseName: string;
  completedSteps: string[];
  context: Record<string, unknown>;
  lastUpdated: string;        // ISO 8601
}

/** SubStep 状态 */
export interface SubStepState {
  status: 'pending' | 'completed' | 'failed';
  completedAt?: string;
  error?: string;
  retryCount?: number;
}

/** SubStep state.json 格式 */
export type SubStepStateMap = Record<string, SubStepState>;

/** DOM 快照格式 */
export interface DomSnapshot {
  id: string;
  url: string;
  timestamp: number;
  storageState: {
    cookies: Array<Record<string, unknown>>;
    origins: Array<{
      origin: string;
      localStorage: Array<{ name: string; value: string }>;
    }>;
  };
  pageState: {
    title: string;
    stateIndicator?: string;  // [data-state] 属性值
  };
}

/** API 缓存条目 */
export interface ApiCacheEntry {
  fingerprint: string;        // MD5(method+url+body[:500])
  method: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;               // JSON 字符串
  cachedAt: string;           // ISO 8601
}

/** 角色 Session 缓存 */
export interface RoleSession {
  roleName: string;
  storageState: {
    cookies: Array<Record<string, unknown>>;
    origins: Array<{
      origin: string;
      localStorage: Array<{ name: string; value: string }>;
    }>;
  };
  savedAt: string;
}

/** 执行报告行 */
export interface ReportLine {
  caseName: string;
  status: 'passed' | 'failed' | 'skipped';
  steps: string;              // "4 steps" / "2/5 steps"
  duration: string;           // "3m 12s"
  note?: string;              // "[resumed from step2]" / "timeout @ step3"
}

/** BrowserContext + Page 对 */
export interface RoleContext {
  context: BrowserContext;
  page: Page;
}
