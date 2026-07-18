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
  screenshotOnAssert?: boolean; // 断言成功时截图
  filter?: string[];          // 按文件名过滤
  onlyFailed?: boolean;       // 仅运行上次失败的 Case
  enableTrace?: boolean;
  traceDir?: string;
  apiCache?: boolean;         // 是否启用 API 响应缓存，默认 true
  cacheGet?: boolean;         // 是否缓存 GET 请求，默认 false
  readCache?: boolean;        // 是否从缓存顺序回放数据，默认 false
}

/** 单个 Case 执行选项 */
export interface WorkflowRunnerOptions {
  headless?: boolean;
  screenshotOnFail?: boolean;
  screenshotOnAssert?: boolean;
  sessionCheckUrl?: string;   // Role Pool Session 校验 URL
  loginMacroPath?: string;
  enableTrace?: boolean;
  traceDir?: string;
  apiCache?: boolean;         // 是否启用 API 响应缓存，默认 true
  cacheGet?: boolean;         // 是否缓存 GET 请求，默认 false
  readCache?: boolean;        // 是否从缓存顺序回放数据，默认 false
  baseUrl?: string;           // 覆盖用例的 base_url (常用于测试)
}

/** Step 执行上下文 */
export interface StepExecutionContext {
  browser: Browser;
  rolePool: import('../engine/role-pool.js').RolePool;
  contextStore: import('../engine/context-store.js').ContextStore;
  checkpoint: import('../engine/checkpoint.js').Checkpoint;
  caseName: string;
  caseDir: string;
  screenshotDir: string;
  errorScreenshotDir?: string;
  suppressScreenshots?: boolean;
  screenshotOnAssert?: boolean;
  assertTimeout?: string | number;
  defaultOnFailure?: import('./case.types.js').OnFailureConfig;
  enableTrace?: boolean;
  beforeHooks?: string;
  afterHooks?: string;
  apiCache?: boolean;         // 是否启用 API 响应缓存，默认 true
  cacheGet?: boolean;         // 是否缓存 GET 请求，默认 false
  readCache?: boolean;        // 是否从缓存顺序回放数据，默认 false
  captureRunId?: string;      // 本次采集/回放运行 ID
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
  stepDurations?: Record<string, number>; // 各步骤耗时，格式为 stepId -> ms
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
  body: string;
  bodyEncoding?: 'utf8' | 'base64';
  requestBody?: string;
  cachedAt: string;           // ISO 8601
  subStepId?: string;
  stepId?: string;
  scopeId?: string;
  occurrence?: number;           // 同 scope + Method/归一化 URL 下第几次请求
  sequence?: number;             // 当前 scope 内所有 API 的请求发起顺序
  attemptId?: string;
  captureRunId?: string;
  matchKeyVersion?: number;
  responseKind?: 'http';
  isActiveSnapshot?: boolean;
}

/** Dashboard 使用的本次运行 API 请求记录，不参与缓存匹配 */
export interface ApiRequestEvent {
  runId: string;
  method: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyEncoding?: 'utf8' | 'base64';
  requestBody?: string;
  requestedAt: string;
  subStepId?: string;
  stepId?: string;
  scopeId?: string;
  occurrence: number;
  sequence: number;
  attemptId: string;
  fromCache: boolean;
  cacheAvailable?: boolean;       // 响应是否已保存，可用于后续回放
  roleName?: string;              // 共享 bootstrap journal 中记录触发请求的角色
}

export interface ApiRequestJournal {
  version: 3;
  runId: string;
  entries: ApiRequestEvent[];
}

/** 每个 scope 当前活跃的成功采集快照 */
export interface ApiCacheMetadata {
  version: 1;
  activeAttempts: Record<string, {
    attemptId: string;
    captureRunId: string;
    entryCount: number;
    completedAt: string;
  }>;
}

/** 某个 scope 的缓存回放统计 */
export interface ApiReplaySummary {
  scopeId: string;
  cached: number;
  consumed: number;
  cacheHits: number;
  liveFallbacks: number;
  unconsumed: number;
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
