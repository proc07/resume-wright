// ============================================================
// yaml-loader.ts — YAML Case 加载与 Zod Schema 校验
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { CaseDefinition, Step, SubStep, BootstrapCacheConfig } from '../types/case.types.js';

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
  use_step: z.string().optional(),
  is_use_step: z.boolean().optional(),
  skip_blocks: z.union([z.boolean(), z.array(z.string())]).optional(),
  parallel: z.boolean().optional(),
});

const StepSchema = z.object({
  id: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  script: z.string().optional(),
  on_failure: OnFailureSchema.optional(),
  sub_steps: z.array(SubStepSchema).optional(),
  use_step: z.string().optional(),
  is_use_step: z.boolean().optional(),
  skip_blocks: z.union([z.boolean(), z.array(z.string())]).optional(),
  parallel: z.union([z.boolean(), z.enum(['step', 'sub_steps', 'both'])]).optional(),
  parallel_sub_steps: z.boolean().optional(),
  fail_fast: z.boolean().optional(),
  concurrency: z.number().int().positive().optional(),
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

const BootstrapCacheSchema = z.object({
  shared_static: z.object({
    enabled: z.boolean().default(true),
    include: z.array(z.string().min(1)).default([]),
    exclude: z.array(z.string().min(1)).default([]),
  }).optional(),
});

const CaseSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  assert_timeout: z.union([z.string(), z.number()]).optional(),
  persist_vars: z.array(z.string()).optional(),
  login_macro_path: z.string().optional(),
  base_url: z.string().optional(),
  bootstrap_cache: BootstrapCacheSchema.optional(),
  roles: z.record(z.string(), RoleSchema),
  on_failure: OnFailureSchema.optional(),
  steps: z.array(StepSchema).min(1),
  before_hooks: HookSchema,
  after_hooks: HookSchema,
});

const GlobalConfigSchema = z.object({
  base_url: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  assert_timeout: z.union([z.string(), z.number()]).optional(),
  persist_vars: z.array(z.string()).optional(),
  login_macro_path: z.string().optional(),
  bootstrap_cache: BootstrapCacheSchema.optional(),
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

/**
 * 根据 skip_blocks 配置过滤脚本中的被标记块，并检验未闭合标记。
 */
export function filterSkipBlocks(script: string, skipBlocksVal: unknown): string {
  const lines = script.split('\n');
  const resultLines: string[] = [];
  
  let inBlock = false;
  let currentBlockName: string | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    
    // 匹配 # @skip_block 极其后的可选块名称
    const match = trimmed.match(/^#\s*@skip_block(?:\s+(\S+))?$/);
    
    if (match) {
      if (!inBlock) {
        inBlock = true;
        currentBlockName = match[1] || null;
      } else {
        inBlock = false;
        currentBlockName = null;
      }
      continue; // 跳过标记行本身
    }
    
    if (inBlock) {
      let shouldSkip = false;
      if (skipBlocksVal === true) {
        shouldSkip = true;
      } else if (Array.isArray(skipBlocksVal)) {
        if (currentBlockName && skipBlocksVal.includes(currentBlockName)) {
          shouldSkip = true;
        }
      }
      
      if (!shouldSkip) {
        resultLines.push(line);
      }
    } else {
      resultLines.push(line);
    }
  }
  
  if (inBlock) {
    const blockDesc = currentBlockName ? `"${currentBlockName}"` : 'unnamed';
    throw new Error(`[yaml-loader] Block parsing error: "# @skip_block" block ${blockDesc} has a start marker but no end marker.`);
  }
  
  return resultLines.join('\n');
}

/**
 * 校验脚本中所有的 # @skip_block 标记是否正确闭合。
 */
export function validateSkipBlocks(script: string, caseFilePath: string): void {
  const lines = script.split('\n');
  let inBlock = false;
  let currentBlockName: string | null = null;
  let startLineNum = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const match = trimmed.match(/^#\s*@skip_block(?:\s+(\S+))?$/);

    if (match) {
      if (!inBlock) {
        inBlock = true;
        currentBlockName = match[1] || null;
        startLineNum = i + 1;
      } else {
        inBlock = false;
        currentBlockName = null;
        startLineNum = -1;
      }
    }
  }

  if (inBlock) {
    const blockDesc = currentBlockName ? `"${currentBlockName}"` : 'unnamed';
    throw new Error(
      `[yaml-loader] Error in "${caseFilePath}": "# @skip_block" block ${blockDesc} starting at line ${startLineNum} has no matching end marker.`
    );
  }
}

// ── 引用展开 ──────────────────────────────────────────────────

/**
 * 展开单个 step 中的 use_step 引用（外部共享步骤，local wins 合并）
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
  merged['is_use_step'] = true;

  // id 若未在引用处提供，则继承 template.id
  if (!merged['id']) {
    merged['id'] = template.id;
  }

  // 如果定义了 skip_blocks，则过滤模板的 script
  if (merged['skip_blocks'] !== undefined && typeof template['script'] === 'string') {
    merged['script'] = filterSkipBlocks(template['script'] as string, merged['skip_blocks']);
  }

  return merged;
}

/**
 * 展开单个 sub_step 中的 use_step 引用（外部共享子步骤，local wins 合并）
 */
function expandSubStep(
  rawSubStep: Record<string, unknown>,
  registry: SharedStepsRegistry,
  caseFilePath: string
): Record<string, unknown> {
  const ref = rawSubStep['use_step'];
  if (typeof ref !== 'string') return rawSubStep;

  const template = registry.subSteps.get(ref);
  if (!template) {
    throw new Error(
      `[yaml-loader] 'use_step: ${ref}' (sub_step) not found in case "${caseFilePath}".\n` +
      `  Available sub_step refs: ${[...registry.subSteps.keys()].join(', ') || '(none)'}`
    );
  }

  const merged: Record<string, unknown> = {
    ...template,
    ...rawSubStep,
  };
  delete merged['use_step'];
  merged['is_use_step'] = true;

  if (!merged['id']) {
    merged['id'] = template.id;
  }

  // 如果定义了 skip_blocks，则过滤模板的 script
  if (merged['skip_blocks'] !== undefined && typeof template['script'] === 'string') {
    merged['script'] = filterSkipBlocks(template['script'] as string, merged['skip_blocks']);
  }

  return merged;
}

/**
 * 计算步骤属性的哈希值（排除 id 和 is_use_step 等标识性字段），确保生成的 ID 的内容寻址稳定性。
 */
function getStepContentHash(step: Record<string, unknown>): string {
  const keys = Object.keys(step).filter(k => k !== 'id' && k !== 'is_use_step').sort();
  const obj: Record<string, unknown> = {};
  for (const k of keys) {
    obj[k] = step[k];
  }
  const str = JSON.stringify(obj);
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 6);
}

/**
 * 对子步骤数组进行递归展开，支持本地 use_step 引用及外部 use_step 引用
 */
function expandSubSteps(
  rawSubSteps: Record<string, unknown>[],
  registry: SharedStepsRegistry,
  caseFilePath: string
): Record<string, unknown>[] {
  const expandedSubSteps: Record<string, unknown>[] = [];
  const localSubStepsMap = new Map<string, Record<string, unknown>>();
  const seenIds = new Set<string>();

  for (const rawSubStep of rawSubSteps) {
    const ref = rawSubStep['use_step'];
    let subStep: Record<string, unknown>;

    if (typeof ref === 'string' && !ref.includes('.')) {
      // 1. 本地子步骤引用
      const template = localSubStepsMap.get(ref);
      if (!template) {
        throw new Error(
          `[yaml-loader] Local 'use_step: ${ref}' (sub_step) not found in the same step of case "${caseFilePath}".\n` +
          `  Ensure the referenced sub_step exists before this one.`
        );
      }
      subStep = {
        ...template,
        ...rawSubStep,
      };
      delete subStep['use_step'];
      subStep['is_use_step'] = true;
      if (!subStep['id']) {
        subStep['id'] = template.id;
      }

      // 如果定义了 skip_blocks，则过滤模板的 script
      if (subStep['skip_blocks'] !== undefined && typeof template['script'] === 'string') {
        subStep['script'] = filterSkipBlocks(template['script'] as string, subStep['skip_blocks']);
      }
    } else {
      // 2. 外部子步骤引用或无引用
      subStep = expandSubStep(rawSubStep, registry, caseFilePath);
    }

    // 自动为未指定 id 的 use_step 生成内容寻址的稳定 ID
    if (!rawSubStep['id'] && typeof ref === 'string') {
      const templateId = ref.includes('.') ? ref.split('.').pop()! : ref;
      const hash = getStepContentHash(rawSubStep);
      let generatedId = templateId;
      if (seenIds.has(templateId)) {
        generatedId = `${templateId}_${hash}`;
        if (seenIds.has(generatedId)) {
          let suffix = 2;
          while (seenIds.has(`${generatedId}_${suffix}`)) {
            suffix++;
          }
          generatedId = `${generatedId}_${suffix}`;
        }
      }
      subStep['id'] = generatedId;
    }

    if (typeof subStep['id'] === 'string') {
      seenIds.add(subStep['id']);
    }

    expandedSubSteps.push(subStep);
    if (typeof subStep['id'] === 'string') {
      localSubStepsMap.set(subStep['id'], subStep);
    }
  }

  return expandedSubSteps;
}

/**
 * 对 Case 的原始 steps 数组进行递归展开，支持本地 use_step 引用及外部 use_step 引用
 */
function expandSteps(
  rawSteps: Record<string, unknown>[],
  registry: SharedStepsRegistry,
  caseFilePath: string
): Record<string, unknown>[] {
  const expandedSteps: Record<string, unknown>[] = [];
  const localStepsMap = new Map<string, Record<string, unknown>>();
  const seenIds = new Set<string>();

  for (const rawStep of rawSteps) {
    const ref = rawStep['use_step'];
    let step: Record<string, unknown>;

    if (typeof ref === 'string' && !ref.includes('.')) {
      // 1. 本地主步骤引用
      const template = localStepsMap.get(ref);
      if (!template) {
        throw new Error(
          `[yaml-loader] Local 'use_step: ${ref}' not found in case "${caseFilePath}".\n` +
          `  Ensure the referenced step exists before this step.`
        );
      }
      step = {
        ...template,
        ...rawStep,
      };
      delete step['use_step'];
      step['is_use_step'] = true;
      if (!step['id']) {
        step['id'] = template.id;
      }

      // 如果定义了 skip_blocks，则过滤模板的 script
      if (step['skip_blocks'] !== undefined && typeof template['script'] === 'string') {
        step['script'] = filterSkipBlocks(template['script'] as string, step['skip_blocks']);
      }

      // 展开内部子步骤
      if (Array.isArray(step['sub_steps'])) {
        step['sub_steps'] = expandSubSteps(
          step['sub_steps'] as Record<string, unknown>[],
          registry,
          caseFilePath
        );
      }
    } else {
      // 2. 外部主步骤引用或无引用
      step = expandStep(rawStep, registry, caseFilePath);
      if (Array.isArray(step['sub_steps'])) {
        step['sub_steps'] = expandSubSteps(
          step['sub_steps'] as Record<string, unknown>[],
          registry,
          caseFilePath
        );
      }
    }

    // 自动为未指定 id 的 use_step 生成内容寻址的稳定 ID
    if (!rawStep['id'] && typeof ref === 'string') {
      const templateId = ref.includes('.') ? ref.split('.').pop()! : ref;
      const hash = getStepContentHash(rawStep);
      let generatedId = templateId;
      if (seenIds.has(templateId)) {
        generatedId = `${templateId}_${hash}`;
        if (seenIds.has(generatedId)) {
          let suffix = 2;
          while (seenIds.has(`${generatedId}_${suffix}`)) {
            suffix++;
          }
          generatedId = `${generatedId}_${suffix}`;
        }
      }
      step['id'] = generatedId;
    }

    if (typeof step['id'] === 'string') {
      seenIds.add(step['id']);
    }

    expandedSteps.push(step);
    if (typeof step['id'] === 'string') {
      localStepsMap.set(step['id'], step);
    }
  }

  return expandedSteps;
}

// ── 配置加载 ──────────────────────────────────────────────────

export interface GlobalConfig {
  base_url?: string;
  timeout?: number;
  assert_timeout?: string | number;
  persist_vars?: string[];
  login_macro_path?: string;
  bootstrap_cache?: BootstrapCacheConfig;
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

  // 校验所有脚本中的 # @skip_block 标记是否闭合
  for (const step of result.data.steps) {
    if (step.script) {
      validateSkipBlocks(step.script, absPath);
    }
    if (step.sub_steps) {
      for (const subStep of step.sub_steps) {
        if (subStep.script) {
          validateSkipBlocks(subStep.script, absPath);
        }
      }
    }
  }

  // 校验 step.role 都存在于 roles 定义中
  const rawData = result.data as any;
  const globalConfig = loadGlobalConfig(absPath);
  const caseData: CaseDefinition = {
    ...rawData,
    name: rawData.name || path.basename(filePath, path.extname(filePath)),
    base_url: rawData.base_url || globalConfig.base_url,
    timeout: rawData.timeout ?? globalConfig.timeout,
    assert_timeout: rawData.assert_timeout ?? globalConfig.assert_timeout,
    persist_vars: rawData.persist_vars || globalConfig.persist_vars,
    login_macro_path: rawData.login_macro_path || globalConfig.login_macro_path,
    bootstrap_cache: rawData.bootstrap_cache || globalConfig.bootstrap_cache,
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
