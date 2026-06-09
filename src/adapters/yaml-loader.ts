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
  max_retries: z.number().int().min(0).default(3),
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
  roles: z.record(z.string(), RoleSchema),
  on_failure: OnFailureSchema.optional(),
  steps: z.array(StepSchema).min(1),
  before_hooks: HookSchema,
  after_hooks: HookSchema,
});

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
  const caseData: CaseDefinition = {
    ...rawData,
    name: rawData.name || path.basename(filePath, path.extname(filePath)),
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
