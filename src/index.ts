// ============================================================
// index.ts — Public API 入口
// ============================================================

export { Scheduler } from './engine/scheduler.js';
export { WorkflowRunner } from './engine/workflow-runner.js';
export { StepExecutor } from './engine/step-executor.js';
export { SubStepExecutor } from './engine/sub-step-executor.js';
export { ContextStore } from './engine/context-store.js';
export { Checkpoint, listCheckpoints, resetAllCheckpoints } from './engine/checkpoint.js';
export { RolePool } from './engine/role-pool.js';
export { NetworkInterceptor } from './engine/network-interceptor.js';
export { DomSnapshotManager } from './engine/dom-snapshot.js';
export { SubStepStore } from './engine/sub-step-store.js';

export { parseScript, tokenize } from './dsl/parser.js';
export { executeScript, executeInstructions, interpolate } from './dsl/executor.js';
export { parseLocator, resolveLocator, resolveLocatorFromString, stripQuotes } from './dsl/locator-resolver.js';
export { loadMacro } from './dsl/macro-loader.js';

export { loadCase, loadAllCases } from './adapters/yaml-loader.js';
export { ElementsRegistry, getDefaultRegistry } from './adapters/elements-csv.js';

export type { CaseDefinition, Step, SubStep, RoleCredential, OnFailureConfig } from './types/case.types.js';
export type { DslScript, DslInstruction, DslCommandName, ParsedLocator } from './types/dsl.types.js';
export type {
  SchedulerOptions,
  WorkflowRunnerOptions,
  CaseResult,
  CheckpointData,
  DomSnapshot,
  ApiCacheEntry,
  RoleSession,
  RoleContext,
} from './types/engine.types.js';
