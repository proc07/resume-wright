// ============================================================
// parser.ts — DSL 脚本解析器
// 将 script 字符串解析为 DslInstruction 数组
// ============================================================

import { stripQuotes } from '../utils.js';
import type {
  DslScript,
  DslInstruction,
  DslCommandName,
  AssignSource,
} from '../types/dsl.types.js';

// 所有合法命令名集合
const COMMANDS = new Set<DslCommandName>([
  'open', 'tap', 'input', 'keyboard', 'hover', 'scroll_to',
  'screenshot', 'wait', 'check', 'upload', 'execute_script',
  'assert_exists', 'assert_not_exists', 'assert_text_equal',
  'assert_title_exists', 'assert_url', 'do_get', 'do_post', 'do_put', 'do_delete',
  'macro', 'inspect', 'wait_api',
]);

// HTTP 命令集合（可以作为赋值来源）
const HTTP_COMMANDS = new Set(['do_get', 'do_post', 'do_put', 'do_delete']);

/**
 * 解析 DSL script 字符串，返回 DslInstruction 数组
 */
export function parseScript(script: string): DslScript {
  const lines = script.split('\n');
  const instructions: DslInstruction[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    const lineNumber = i + 1;  // 从 1 开始
    i++;

    // 空行 / 注释
    if (!trimmed) {
      instructions.push({
        optional: false,
        command: 'boundary',
        args: [],
        raw: '',
        lineNumber,
      });
      continue;
    }
    if (trimmed.startsWith('#')) continue;

    // 检测非阻塞前缀 ?
    let optional = false;
    let workLine = trimmed;
    if (workLine.startsWith('? ') || workLine === '?') {
      optional = true;
      workLine = workLine.slice(2).trim();
    }

    // ── 变量赋值：$var = ... ──
    const assignMatch = workLine.match(/^(\$[\w.]+)\s*=\s*(.+)$/s);
    if (assignMatch) {
      const target = assignMatch[1]!.replace(/^\$/, '');
      const rhs = assignMatch[2]!.trim();

      const inst = parseAssignment(target, rhs, workLine);
      inst.optional = optional;
      inst.raw = raw;
      inst.lineNumber = lineNumber;

      // 如果是 execute_script 或 do_post/put 赋值，可能需要读取后续多行块
      if (inst.assignSource === 'execute_script' || HTTP_COMMANDS.has(rhs.split(/\s+/)[0]! as DslCommandName)) {
        const { block, nextIndex } = readBlock(lines, i);
        if (block) {
          inst.block = block;
          i = nextIndex;
        }
      }

      instructions.push(inst);
      continue;
    }

    // ── 普通命令 ──
    const parts = tokenize(workLine);
    if (parts.length === 0) continue;

    const cmdStr = parts[0]!;
    const args = parts.slice(1);

    if (!COMMANDS.has(cmdStr as DslCommandName)) {
      // 未知命令，作为注释跳过并警告
      console.warn(`[parser] Unknown DSL command: "${cmdStr}" — skipped`);
      continue;
    }

    const cmd = cmdStr as DslCommandName;

    const inst: DslInstruction = {
      optional,
      command: cmd,
      args,
      raw,
      lineNumber,
    };

    // execute_script / do_post with body 需要读取后续多行块
    if (cmd === 'execute_script' || cmd === 'do_post' || cmd === 'do_put') {
      const { block, nextIndex } = readBlock(lines, i);
      if (block) {
        inst.block = block;
        i = nextIndex;
      }
    }

    instructions.push(inst);
  }

  return instructions;
}

function isLocatorString(s: string): boolean {
  const t = s.trim();
  if (t.startsWith('@') || t.startsWith('//') || t.startsWith('.') || t.startsWith('#')) {
    return true;
  }
  if (/^(label|placeholder|testid|title|alt|role):/.test(t)) {
    return true;
  }
  if (t.startsWith('*') && t.endsWith('*') && t.length > 2) {
    return true;
  }
  if (t.includes('|')) {
    return true;
  }
  return false;
}

// ── 解析赋值语句右侧 ─────────────────────────────────────────

function parseAssignment(
  target: string,
  rhs: string,
  workLine: string
): DslInstruction {
  // CURRENT_URL
  if (rhs === 'CURRENT_URL') {
    return {
      optional: false,
      command: null,
      assignTarget: target,
      assignSource: 'current_url',
      args: [],
      raw: workLine,
    };
  }

  // URL_MATCH "pattern"
  const urlMatchM = rhs.match(/^URL_MATCH\s+(.+)$/);
  if (urlMatchM) {
    return {
      optional: false,
      command: null,
      assignTarget: target,
      assignSource: 'url_match',
      args: [stripQuotes(urlMatchM[1]!)],
      raw: workLine,
    };
  }

  // URL_PARAM "key"
  const urlParamM = rhs.match(/^URL_PARAM\s+(.+)$/);
  if (urlParamM) {
    return {
      optional: false,
      command: null,
      assignTarget: target,
      assignSource: 'url_param',
      args: [stripQuotes(urlParamM[1]!)],
      raw: workLine,
    };
  }

  // execute_script (optional args before """)
  if (rhs.startsWith('execute_script')) {
    const argsStr = rhs.slice('execute_script'.length).trim();
    const scriptArgs = argsStr ? tokenize(argsStr) : [];
    return {
      optional: false,
      command: null,
      assignTarget: target,
      assignSource: 'execute_script',
      args: scriptArgs,
      raw: workLine,
    };
  }

  // do_get / do_post / do_put / do_delete
  const httpMatch = rhs.match(/^(do_get|do_post|do_put|do_delete)\s+(.+?)(\s+\d+)?$/);
  if (httpMatch) {
    const url = stripQuotes(httpMatch[2]!.trim());
    const status = httpMatch[3]?.trim() ?? '200';
    return {
      optional: false,
      command: null,
      assignTarget: target,
      assignSource: 'http',
      args: [httpMatch[1]!, url, status],
      raw: workLine,
    };
  }

  // $other.field 变量引用
  if (rhs.startsWith('$')) {
    return {
      optional: false,
      command: null,
      assignTarget: target,
      assignSource: 'var_ref',
      args: [rhs.slice(1)],  // 去掉 $，保留点路径
      raw: workLine,
    };
  }

  // literal 字符串字面量直接赋值
  const stripped = stripQuotes(rhs);
  if ((rhs.startsWith('"') && rhs.endsWith('"')) || (rhs.startsWith("'") && rhs.endsWith("'"))) {
    if (!isLocatorString(stripped)) {
      return {
        optional: false,
        command: null,
        assignTarget: target,
        assignSource: 'literal',
        args: [stripped],
        raw: workLine,
      };
    }
  }

  // 空值与布尔字面量直接赋值
  if (rhs === 'null' || rhs === 'true' || rhs === 'false') {
    return {
      optional: false,
      command: null,
      assignTarget: target,
      assignSource: 'boolean',
      args: [rhs],
      raw: workLine,
    };
  }

  // 数字字面量直接赋值
  if (/^-?\d+(\.\d+)?$/.test(rhs)) {
    return {
      optional: false,
      command: null,
      assignTarget: target,
      assignSource: 'number',
      args: [rhs],
      raw: workLine,
    };
  }

  // "locator" 从页面元素提取文字
  return {
    optional: false,
    command: null,
    assignTarget: target,
    assignSource: 'locator',
    args: [stripped],
    raw: workLine,
  };
}

// ── 读取多行 """ ... """ 块 ────────────────────────────────────

function readBlock(
  lines: string[],
  startIdx: number
): { block: string | null; nextIndex: number } {
  // 检查当前行或下一行是否以 """ 开头
  let idx = startIdx;

  // 跳过空行寻找块开始
  while (idx < lines.length && !lines[idx]!.trim()) idx++;

  if (idx >= lines.length || !lines[idx]!.trim().startsWith('"""')) {
    return { block: null, nextIndex: startIdx };
  }

  // 找到开始的 """
  const openLine = lines[idx]!.trim();
  const inlineContent = openLine.slice(3);  // 可能 """ 后面还有内容
  idx++;

  const blockLines: string[] = [];
  if (inlineContent && inlineContent !== '"""') {
    blockLines.push(inlineContent);
  }

  // 读取直到关闭 """
  while (idx < lines.length) {
    const line = lines[idx]!;
    idx++;
    if (line.trim() === '"""') break;
    blockLines.push(line);
  }

  return { block: blockLines.join('\n'), nextIndex: idx };
}

// ── 简单分词器（支持引号字符串）────────────────────────────────

export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const s = line.trim();

  while (i < s.length) {
    // 跳过空白
    if (/\s/.test(s[i]!)) {
      i++;
      continue;
    }

    // 引号字符串
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i]!;
      let j = i + 1;
      while (j < s.length && s[j] !== quote) {
        if (s[j] === '\\') j++; // 转义字符
        j++;
      }
      tokens.push(s.slice(i, j + 1));
      i = j + 1;
      continue;
    }

    // 普通 token（到下一个空白或行尾）
    let j = i;
    while (j < s.length && !/\s/.test(s[j]!)) j++;
    tokens.push(s.slice(i, j));
    i = j;
  }

  return tokens;
}
