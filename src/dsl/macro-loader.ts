// ============================================================
// macro-loader.ts — 宏文件加载与执行
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { parseScript } from './parser.js';
import type { DslScript } from '../types/dsl.types.js';

/** 内置宏名称（rw: 前缀） */
const BUILTIN_MACROS = new Set(['rw:login', 'rw:goto_workflow', 'rw:wait_status']);

/**
 * 加载并解析宏文件，返回经过位置参数替换的 DslScript
 *
 * @param macroName  宏名称（如 "login" / "./macros/login" / "rw:login"）
 * @param args       位置参数列表（替换 $1 $2 $3 ...）
 * @param macrosDir  宏文件根目录（默认 ./macros）
 */
export function loadMacro(
  macroName: string,
  args: string[] | Record<string, string>,
  macrosDir: string = path.join(process.cwd(), 'macros')
): DslScript {
  // ── 内置宏 ──
  if (BUILTIN_MACROS.has(macroName)) {
    const positionalArgs = Array.isArray(args) ? args : Object.values(args);
    return buildBuiltinMacro(macroName, positionalArgs);
  }

  // ── 解析宏文件路径 ──
  const macroPath = resolveMacroPath(macroName, macrosDir);

  if (!fs.existsSync(macroPath)) {
    throw new Error(`Macro file not found: ${macroPath}`);
  }

  const raw = fs.readFileSync(macroPath, 'utf-8');

  let substituted = raw;

  if (Array.isArray(args)) {
    // 尝试解析参数定义行: # params: username, password
    const paramMatch = raw.match(/^\s*#\s*(?:params|param):\s*([^\r\n]+)/im);
    if (paramMatch) {
      const paramNames = paramMatch[1].split(',').map((s) => s.trim());
      const namedArgs: Record<string, string> = {};
      for (let i = 0; i < paramNames.length; i++) {
        if (paramNames[i]) {
          namedArgs[paramNames[i]] = args[i] ?? '';
        }
      }
      substituted = substituteNamedArgs(substituted, namedArgs);
    } else {
      substituted = substitutePositionalArgs(substituted, args);
    }
  } else {
    // 是 Record<string, string>
    substituted = substituteNamedArgs(substituted, args);
    // 同时也支持位置参数的后备替换
    substituted = substitutePositionalArgs(substituted, Object.values(args));
  }

  return parseScript(substituted);
}

// ── 宏文件路径解析 ────────────────────────────────────────────

function resolveMacroPath(name: string, macrosDir: string): string {
  // 绝对路径
  if (path.isAbsolute(name)) {
    if (name.endsWith('.macro')) return name;
    return `${name}.macro`;
  }

  // 显式相对路径（以 ./ 或 ../ 开头）
  if (name.startsWith('./') || name.startsWith('../')) {
    const p = path.resolve(process.cwd(), name);
    if (p.endsWith('.macro')) return p;
    return `${p}.macro`;
  }

  // 简短名称：在 macrosDir 下查找
  const candidates = [
    path.join(macrosDir, `${name}.macro`),
    path.join(macrosDir, name, `${path.basename(name)}.macro`),
    path.join(macrosDir, `${name}`),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // 最后回退
  return path.join(macrosDir, `${name}.macro`);
}

// ── 变量参数替换 ───────────────────────────────────────────────

function substituteNamedArgs(source: string, args: Record<string, string>): string {
  let result = source;
  // 按键长度降序排序，防止短变量替换破坏长变量 (如 $user 破坏 $username)
  const sortedKeys = Object.keys(args).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const val = args[key] ?? '';
    const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\$${escapedKey}(?![a-zA-Z0-9_])`, 'g');
    result = result.replace(regex, val);
  }
  return result;
}

function substitutePositionalArgs(source: string, args: string[]): string {
  let result = source;
  for (let i = args.length; i >= 1; i--) {
    // 从大到小替换，防止 $1 替换破坏 $10 $11 等
    result = result.replaceAll(`$${i}`, args[i - 1] ?? '');
  }
  return result;
}

// ── 内置宏实现 ────────────────────────────────────────────────

/**
 * 内置宏：生成对应的 DslScript
 *
 * rw:login "$role_name"
 *   → 通过 Role Pool 登录（框架层面处理，DSL 层返回空脚本+特殊标记）
 *
 * rw:goto_workflow
 *   → open "$workflow_url"
 *
 * rw:wait_status "$text" 30s
 *   → assert_exists "$text" 30s（轮询等待）
 */
function buildBuiltinMacro(name: string, args: string[]): DslScript {
  switch (name) {
    case 'rw:login': {
      // 登录由 Role Pool 处理，这里返回一个特殊指令
      return parseScript(`# builtin: rw:login handled by RolePool for role ${args[0] ?? ''}`);
    }

    case 'rw:goto_workflow': {
      return parseScript('open "$workflow_url"');
    }

    case 'rw:wait_status': {
      const text = args[0] ?? '';
      const timeout = args[1] ?? '30s';
      return parseScript(`assert_exists "${text}" ${timeout}`);
    }

    default:
      throw new Error(`Unknown builtin macro: ${name}`);
  }
}
