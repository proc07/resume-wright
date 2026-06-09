// ============================================================
// case.types.ts — YAML Case 结构类型定义
// ============================================================

export interface RoleCredential {
  id?: string;
  [key: string]: any;
}

export interface OnFailureConfig {
  strategy: 'retry' | 'skip' | 'manual';
  max_retries?: number;      // 默认 3
  retry_delay?: number;      // 重试间隔 ms，默认 3000
  restore_snapshot?: boolean; // 重试前从快照恢复页面
}

export interface SubStep {
  id: string;
  script: string;
  snapshot_before_submit?: boolean;
  on_failure?: OnFailureConfig;
}

export interface Step {
  id: string;
  role: string;
  script?: string;
  on_failure?: OnFailureConfig;
  sub_steps?: SubStep[];
}

export interface CaseDefinition {
  name: string;
  description?: string;
  timeout?: number;                        // 整体超时 ms
  login_macro_path?: string;
  roles: Record<string, RoleCredential>;
  on_failure?: OnFailureConfig;
  steps: Step[];
  before_hooks?: string;
  after_hooks?: string;
}
