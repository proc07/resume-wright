// ============================================================
// yaml-loader.ts — YAML Case 加载与 Zod Schema 校验
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { CaseDefinition, Step, SubStep } from '../types/case.types.js';

// ── Zod Schema ────────────────────────────────────────────────

const OnFailureSchema = z.object({
  strategy: z.enum(['retry', 'skip', 'manual']),
  max_retries: z.number().int().min(0).default(0),
  retry_delay: z.number().int().min(0).default(3000),
  restore_snapshot: z.boolean().default(false),
});

const SubStepSchema = z.object({
  id: z.string().min(1).optional(),
  script: z.string().optional(),
  snapshot_before_submit: z.boolean().optional(),
  on_failure: OnFailureSchema.optional(),
  use_sub_step: z.string().optional(),
});

const StepSchema = z.object({
  id: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  script: z.string().optional(),
  on_failure: OnFailureSchema.optional(),
  sub_steps: z.array(SubStepSchema).optional(),
  use_step: z.string().optional(),
});

const RoleSchema = z.record(z.string(), z.any());

const HookSchema = z.union([z.string(), z.array(z.string())])
  .transform((val) => {
    if (Array.isArray(val)) {
      return val.join('\n');
    }
    return val;
  })
  .optional();

const CaseSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  login_macro_path: z.string().optional(),
  base_url: z.string().optional(),
  roles: z.record(z.string(), RoleSchema),
  on_failure: OnFailureSchema.optional(),
  steps: z.array(StepSchema).min(1),
  before_hooks: HookSchema,
  after_hooks: HookSchema,
});

const GlobalConfigSchema = z.object({
  base_url: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  login_macro_path: z.string().optional(),
  on_failure: OnFailureSchema.optional(),
});

// ── 共享步骤 Schema ────────────────────────────────────────────

/** .steps.yaml 文件内用于定义模板的 Schema（字段均为可选，允许在引用时覆盖） */
const SharedSubStepTemplateSchema = z.object({
  id: z.string().min(1),
  script: z.string().optional(),
  snapshot_before_submit: z.boolean().optional(),
  on_failure: OnFailureSchema.optional(),
});

const SharedStepTemplateSchema = z.object({
  id: z.string().min(1),
  role: z.string().optional(),
  script: z.string().optional(),
  on_failure: OnFailureSchema.optional(),
  sub_steps: z.array(SharedSubStepTemplateSchema).optional(),
});

const SharedStepsFileSchema = z.object({
  steps: z.array(SharedStepTemplateSchema).optional(),
  sub_steps: z.array(SharedSubStepTemplateSchema).optional(),
});

export type SharedStepTemplate = z.infer<typeof SharedStepTemplateSchema>;
export type SharedSubStepTemplate = z.infer<typeof SharedSubStepTemplateSchema>;

export interface SharedStepsRegistry {
  steps: Map<string, SharedStepTemplate>;
  subSteps: Map<string, SharedSubStepTemplate>;
}

// ── 共享步骤加载 ──────────────────────────────────────────────

/**
 * 加载单个 .steps.yaml 文件，返回 step 和 sub_step 的 Map（以 id 为键）
 */
export function loadSharedStepsFile(filePath: string): SharedStepsRegistry {
  const steps = new Map<string, SharedStepTemplate>();
  const subSteps = new Map<string, SharedSubStepTemplate>();

  if (!fs.existsSync(filePath)) {
    return { steps, subSteps };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(raw);
    const result = SharedStepsFileSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
      console.warn(`[yaml-loader] shared steps validation failed for ${filePath}:\n${issues}`);
      return { steps, subSteps };
    }
    for (const s of result.data.steps ?? []) {
      steps.set(s.id, s);
    }
    for (const ss of result.data.sub_steps ?? []) {
      subSteps.set(ss.id, ss);
    }
  } catch (err) {
    console.warn(`[yaml-loader] failed to load shared steps from ${filePath}:`, err);
  }

  return { steps, subSteps };
}

/**
 * 从 caseFilePath 所在目录开始向上递归搜索所有 .steps.yaml 文件，
 * 合并为一个全局 registry（子目录中的 .steps.yaml 优先级更高，会覆盖父目录同名 id）
 */
export function resolveSharedSteps(caseFilePath: string): SharedStepsRegistry {
  const registry: SharedStepsRegistry = {
    steps: new Map(),
    subSteps: new Map(),
  };

  // 从当前目录向上收集所有 .steps.yaml 文件路径（由远及近）
  const dirs: string[] = [];
  let dir = path.dirname(path.resolve(caseFilePath));
  while (true) {
    dirs.unshift(dir); // 放前面，使父目录先被加载（子目录覆盖父目录）
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const d of dirs) {
    // 搜索该目录下所有 .steps.yaml 文件（包含 shared/ 子目录）
    const candidates = [d, path.join(d, 'shared')];
    for (const searchDir of candidates) {
      if (!fs.existsSync(searchDir)) continue;
      try {
        const entries = fs.readdirSync(searchDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.steps.yaml')) {
            const fileKey = entry.name.replace(/\.steps\.yaml$/, '');
            const filePath = path.join(searchDir, entry.name);
            const loaded = loadSharedStepsFile(filePath);
            // 子目录中同名 id 覆盖父目录
            for (const [id, step] of loaded.steps) {
              registry.steps.set(`${fileKey}.${id}`, step);
            }
            for (const [id, subStep] of loaded.subSteps) {
              registry.subSteps.set(`${fileKey}.${id}`, subStep);
            }
          }
        }
      } catch {
        // 忽略无法读取的目录
      }
    }
  }

  return registry;
}

// ── 引用展开 ──────────────────────────────────────────────────

/**
 * 展开单个 step 中的 use_step 引用（local wins 合并）
 */
function expandStep(
  rawStep: Record<string, unknown>,
  registry: SharedStepsRegistry,
  caseFilePath: string
): Record<string, unknown> {
  const ref = rawStep['use_step'];
  if (typeof ref !== 'string') return rawStep;

  const template = registry.steps.get(ref);
  if (!template) {
    throw new Error(
      `[yaml-loader] 'use_step: ${ref}' not found in case "${caseFilePath}".\n` +
      `  Available step refs: ${[...registry.steps.keys()].join(', ') || '(none)'}`
    );
  }

  // Local wins: rawStep 字段覆盖 template
  const merged: Record<string, unknown> = {
    ...template,
    ...rawStep,
  };
  delete merged['use_step'];

  // id 若未在引用处提供，则继承 template.id
  if (!merged['id']) {
    merged['id'] = template.id;
  }

  // sub_steps 中也可能含有 use_sub_step，递归展开
  if (Array.isArray(merged['sub_steps'])) {
    merged['sub_steps'] = (merged['sub_steps'] as Record<string, unknown>[])
      .map((ss) => expandSubStep(ss, registry, caseFilePath));
  }

  return merged;
}

/**
 * 展开单个 sub_step 中的 use_sub_step 引用（local wins 合并）
 */
function expandSubStep(
  rawSubStep: Record<string, unknown>,
  registry: SharedStepsRegistry,
  caseFilePath: string
): Record<string, unknown> {
  const ref = rawSubStep['use_sub_step'];
  if (typeof ref !== 'string') return rawSubStep;

  const template = registry.subSteps.get(ref);
  if (!template) {
    throw new Error(
      `[yaml-loader] 'use_sub_step: ${ref}' not found in case "${caseFilePath}".\n` +
      `  Available sub_step refs: ${[...registry.subSteps.keys()].join(', ') || '(none)'}`
    );
  }

  const merged: Record<string, unknown> = {
    ...template,
    ...rawSubStep,
  };
  delete merged['use_sub_step'];

  if (!merged['id']) {
    merged['id'] = template.id;
  }

  return merged;
}

/**
 * 对 Case 的原始 steps 数组进行递归展开，返回展开后的步骤列表
 */
function expandSteps(
  rawSteps: Record<string, unknown>[],
  registry: SharedStepsRegistry,
  caseFilePath: string
): Record<string, unknown>[] {
  return rawSteps.map((rawStep) => {
    // 先展开 step 本身的 use_step
    const step = expandStep(rawStep, registry, caseFilePath);
    // 再展开 step 内部所有 sub_steps 的 use_sub_step
    if (Array.isArray(step['sub_steps'])) {
      step['sub_steps'] = (step['sub_steps'] as Record<string, unknown>[])
        .map((ss) => expandSubStep(ss, registry, caseFilePath));
    }
    return step;
  });
}

// ── 配置加载 ──────────────────────────────────────────────────

export interface GlobalConfig {
  base_url?: string;
  timeout?: number;
  login_macro_path?: string;
  on_failure?: z.infer<typeof OnFailureSchema>;
}

function validateQuotesForPathFields(rawContent: string, filePath: string): void {
  const lines = rawContent.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(/^\s*login_macro_path\s*:\s*(.*)$/);
    if (match) {
      const value = match[1]!.trim();
      if (value === '') continue;
      
      const firstChar = value[0];
      if (firstChar !== '"' && firstChar !== "'") {
        throw new Error(`Validation failed for ${filePath} at line ${i + 1}: login_macro_path must be enclosed in quotes (found: ${value})`);
      }
      
      const regex = new RegExp(`^(['"])(.*?)\\1(?:\\s*#.*)?$`);
      if (!regex.test(value)) {
        throw new Error(`Validation failed for ${filePath} at line ${i + 1}: login_macro_path must be enclosed in matching quotes (found: ${value})`);
      }
    }
  }
}

export function loadGlobalConfig(caseFilePath?: string): GlobalConfig {
  let configPath = path.resolve('config.yaml');
  if (caseFilePath) {
    let dir = path.dirname(path.resolve(caseFilePath));
    while (true) {
      const p = path.join(dir, 'config.yaml');
      if (fs.existsSync(p)) {
        configPath = p;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }

  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    validateQuotesForPathFields(raw, configPath);
    const parsed = yaml.load(raw);
    const result = GlobalConfigSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
      console.warn(`[yaml-loader] global config validation failed for ${configPath}:\n${issues}`);
      return {};
    }
    const data = result.data;
    if (data.login_macro_path && (data.login_macro_path.startsWith('./') || data.login_macro_path.startsWith('../'))) {
      data.login_macro_path = path.resolve(path.dirname(configPath), data.login_macro_path);
    }
    return data;
  } catch (err) {
    console.warn(`[yaml-loader] failed to load global config from ${configPath}:`, err);
    return {};
  }
}

// ── Loader ────────────────────────────────────────────────────

/**
 * 加载并校验单个 YAML Case 文件，返回强类型的 CaseDefinition
 */
export function loadCase(filePath: string): CaseDefinition {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Case file not found: ${absPath}`);
  }

  const raw = fs.readFileSync(absPath, 'utf-8');
  validateQuotesForPathFields(raw, absPath);
  let parsed: unknown;

  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`YAML parse error in ${absPath}: ${String(err)}`);
  }

  // 在 Schema 校验前先展开 use_step / use_sub_step 引用
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).steps)) {
    const registry = resolveSharedSteps(absPath);
    (parsed as any).steps = expandSteps(
      (parsed as any).steps as Record<string, unknown>[],
      registry,
      absPath
    );
  }

  const result = CaseSchema.safeParse(parsed);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Case schema validation failed for ${absPath}:\n${issues}`);
  }

  // 校验 step.role 都存在于 roles 定义中
  const rawData = result.data as any;
  const globalConfig = loadGlobalConfig(absPath);
  const caseData: CaseDefinition = {
    ...rawData,
    name: rawData.name || path.basename(filePath, path.extname(filePath)),
    base_url: rawData.base_url || globalConfig.base_url,
    timeout: rawData.timeout ?? globalConfig.timeout,
    login_macro_path: rawData.login_macro_path || globalConfig.login_macro_path,
    on_failure: rawData.on_failure || globalConfig.on_failure,
  };
  for (const step of caseData.steps) {
    if (!caseData.roles[step.role]) {
      throw new Error(
        `Step "${step.id}" references unknown role "${step.role}". ` +
          `Available roles: ${Object.keys(caseData.roles).join(', ')}`
      );
    }
  }

  // 校验 step.id 不重复
  const stepIds = caseData.steps.map((s) => s.id);
  const duplicates = stepIds.filter((id, idx) => stepIds.indexOf(id) !== idx);
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate step IDs in ${absPath}: ${duplicates.join(', ')}`
    );
  }

  return caseData;
}

/**
 * 批量加载目录下所有 YAML Case 文件
 */
export async function loadAllCases(
  casesDir: string,
  filter?: string[]
): Promise<Array<{ filePath: string; definition: CaseDefinition }>> {
  const { default: fg } = await import('fast-glob');
  const pattern = path.join(casesDir, '**/*.yaml').replace(/\\/g, '/');
  const files = await fg(pattern);

  const results: Array<{ filePath: string; definition: CaseDefinition }> = [];

  for (const file of files) {
    if (filter && filter.length > 0) {
      const base = path.basename(file);
      const matched = filter.some(
        (f) => base === f || base === `${f}.yaml` || file.includes(f)
      );
      if (!matched) continue;
    }

    try {
      const definition = loadCase(file);
      results.push({ filePath: file, definition });
    } catch (err) {
      console.error(`[yaml-loader] Skipping ${file}: ${String(err)}`);
    }
  }

  return results;
}
