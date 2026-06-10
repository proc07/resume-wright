// ============================================================
// yaml-loader.ts — YAML Case 加载与 Zod Schema 校验
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { CaseDefinition } from '../types/case.types.js';

// ── Zod Schema ────────────────────────────────────────────────

const OnFailureSchema = z.object({
  strategy: z.enum(['retry', 'skip', 'manual']),
  max_retries: z.number().int().min(0).default(0),
  retry_delay: z.number().int().min(0).default(3000),
  restore_snapshot: z.boolean().default(false),
});

const SubStepSchema = z.object({
  id: z.string().min(1),
  script: z.string().min(1),
  snapshot_before_submit: z.boolean().optional(),
  on_failure: OnFailureSchema.optional(),
});

const StepSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  script: z.string().optional(),
  on_failure: OnFailureSchema.optional(),
  sub_steps: z.array(SubStepSchema).optional(),
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

export interface GlobalConfig {
  base_url?: string;
  timeout?: number;
  login_macro_path?: string;
  on_failure?: z.infer<typeof OnFailureSchema>;
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
    const parsed = yaml.load(raw);
    const result = GlobalConfigSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
      console.warn(`[yaml-loader] global config validation failed for ${configPath}:\n${issues}`);
      return {};
    }
    return result.data;
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
  let parsed: unknown;

  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`YAML parse error in ${absPath}: ${String(err)}`);
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
