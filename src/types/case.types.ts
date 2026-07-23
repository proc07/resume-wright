// ============================================================
// case.types.ts — YAML Case 结构类型定义
// ============================================================

export interface RoleCredential {
  id?: string;
  [key: string]: any;
}

export interface OnFailureConfig {
  strategy: 'retry' | 'skip' | 'manual';
  max_retries?: number;      // 默认 0
  retry_delay?: number;      // 重试间隔 ms，默认 3000
  restore_snapshot?: boolean; // 重试前从快照恢复页面
}

export interface SubStep {
  id: string;
  script: string;
  snapshot_before_submit?: boolean;
  on_failure?: OnFailureConfig;
  use_step?: string;  // 引用共享子步骤，格式：'file.sub_step_id'
  is_use_step?: boolean; // 标识是否为复用出来的子步骤
  skip_blocks?: boolean | string[];
  parallel?: boolean; // 是否与前/同组子步骤并行
}

export interface Step {
  id: string;
  role: string;
  script?: string;
  on_failure?: OnFailureConfig;
  sub_steps?: SubStep[];
  use_step?: string;      // 引用共享步骤，格式：'file.step_id'
  is_use_step?: boolean; // 标识是否为复用出来的步骤
  skip_blocks?: boolean | string[];
  parallel?: boolean | 'step' | 'sub_steps' | 'both'; // 并行标记（Step 级 / SubStep 级 / 双向）
  parallel_sub_steps?: boolean; // 快捷键：该 Step 内所有子步骤并行
  fail_fast?: boolean;          // 并行组内出错是否立即终止（默认 true）
  concurrency?: number;         // 最大并发限制（可选）
}

export interface SharedStaticBootstrapConfig {
  enabled?: boolean;
  include?: string[];
  exclude?: string[];
}

export interface BootstrapCacheConfig {
  shared_static?: SharedStaticBootstrapConfig;
}

export interface CaseDefinition {
  name: string;
  description?: string;
  timeout?: number;                        // 整体超时 ms
  assert_timeout?: string | number;        // 全局断言默认超时
  persist_vars?: string[];         // 长效持久化变量列表
  login_macro_path?: string;
  base_url?: string;                       // 全局基础 URL
  bootstrap_cache?: BootstrapCacheConfig;
  roles: Record<string, RoleCredential>;
  on_failure?: OnFailureConfig;
  steps: Step[];
  before_hooks?: string;
  after_hooks?: string;
}
