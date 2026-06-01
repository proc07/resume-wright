// ============================================================
// executor.ts — DSL 命令执行器
// 将 DslInstruction 翻译为 Playwright API 调用
// ============================================================

import path from 'node:path';
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { DslInstruction } from '../types/dsl.types.js';
import { parseScript } from './parser.js';
import { loadMacro } from './macro-loader.js';
import { resolveLocatorFromString, stripQuotes } from './locator-resolver.js';
import type { ContextStore } from '../engine/context-store.js';
import { getFormattedDateTime } from '../engine/datetime-utils.js';

export interface ExecutorOptions {
  screenshotDir?: string;
  macrosDir?: string;
  stepId?: string;
}

// ── 主执行函数 ────────────────────────────────────────────────

/**
 * 执行一段 DSL 脚本字符串
 */
export async function executeScript(
  script: string,
  page: Page,
  ctx: ContextStore,
  opts: ExecutorOptions = {}
): Promise<void> {
  const instructions = parseScript(script);
  await executeInstructions(instructions, page, ctx, opts);
}

/**
 * 执行已解析的 DslInstruction 数组
 */
export async function executeInstructions(
  instructions: DslInstruction[],
  page: Page,
  ctx: ContextStore,
  opts: ExecutorOptions = {}
): Promise<void> {
  for (const inst of instructions) {
    await executeOne(inst, page, ctx, opts);
  }
}

// ── 单条指令执行 ───────────────────────────────────────────────

async function executeOne(
  inst: DslInstruction,
  page: Page,
  ctx: ContextStore,
  opts: ExecutorOptions
): Promise<void> {
  const run = async () => {
    if (inst.command === null) {
      // 变量赋值
      await executeAssign(inst, page, ctx);
    } else {
      await executeCommand(inst, page, ctx, opts);
    }
  };

  if (inst.optional) {
    try {
      await run();
    } catch (err) {
      console.warn(`[dsl] ⚠ Optional step failed (skipped): ${inst.raw}\n  ${String(err)}`);
    }
  } else {
    await run();
  }
}

// ── 变量赋值执行 ───────────────────────────────────────────────

async function executeAssign(
  inst: DslInstruction,
  page: Page,
  ctx: ContextStore
): Promise<void> {
  const target = inst.assignTarget!;
  let value: unknown;

  switch (inst.assignSource) {
    case 'current_url':
      value = page.url();
      break;

    case 'url_match': {
      const pattern = interpolate(inst.args[0]!, ctx);
      const match = page.url().match(new RegExp(pattern));
      value = match?.[1] ?? null;
      break;
    }

    case 'url_param': {
      const key = interpolate(inst.args[0]!, ctx);
      value = new URL(page.url()).searchParams.get(key);
      break;
    }

    case 'locator': {
      const locStr = interpolate(inst.args[0]!, ctx);
      const locator = resolveLocatorFromString(page, locStr);
      value = await locator.textContent();
      break;
    }

    case 'var_ref': {
      // $other.field 引用
      const path = inst.args[0]!;
      value = ctx.getPath(path);
      break;
    }

    case 'http': {
      const [method, rawUrl, rawStatus] = inst.args as [string, string, string];
      const url = interpolate(rawUrl, ctx);
      const expectedStatus = parseInt(rawStatus ?? '200', 10);
      const body = inst.block ? interpolate(inst.block, ctx) : undefined;
      value = await doHttpRequest(page, method, url, body, expectedStatus);
      break;
    }

    case 'execute_script': {
      const jsCode = inst.block ?? '';
      const scriptArgs = inst.args.map((a) => ctx.getPath(stripDollar(a)) ?? a);
      value = await page.evaluate(
        ({ code, args }: { code: string; args: unknown[] }) => {
          const fn = new Function(...args.map((_, i) => `arg${i}`), code);
          return fn(...args);
        },
        { code: jsCode, args: scriptArgs }
      );
      break;
    }

    default:
      throw new Error(`Unknown assignSource: ${inst.assignSource}`);
  }

  ctx.set(target, value);
  console.log(`[dsl]   $${target} = ${JSON.stringify(value)}`);
}

// ── 命令执行 ─────────────────────────────────────────────────

async function executeCommand(
  inst: DslInstruction,
  page: Page,
  ctx: ContextStore,
  opts: ExecutorOptions
): Promise<void> {
  const cmd = inst.command!;
  const args = inst.args.map((a) => interpolate(a, ctx));

  console.log(`[dsl] ${inst.optional ? '? ' : ''}${cmd} ${args.join(' ')}`);

  switch (cmd) {
    // ── 导航 ──────────────────────────────────────────────────
    case 'open': {
      const url = stripQuotes(args[0]!);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      break;
    }

    // ── 点击 ─────────────────────────────────────────────────
    case 'tap': {
      const locStr = args[0]!;

      // 坐标点击：tap 0.5 0.5 (相对) 或 tap "100" "200" (绝对像素)
      if (args.length >= 2 && !locStr.startsWith('"') && !locStr.startsWith("'")) {
        const x = parseFloat(locStr);
        const y = parseFloat(args[1]!);
        if (!isNaN(x) && !isNaN(y)) {
          if (x <= 1 && y <= 1) {
            // 相对坐标
            const vp = page.viewportSize() ?? { width: 1280, height: 720 };
            await page.mouse.click(x * vp.width, y * vp.height);
          } else {
            await page.mouse.click(x, y);
          }
          break;
        }
      }

      const locator = resolveLocatorFromString(page, stripQuotes(locStr));
      await locator.click();
      break;
    }

    // ── 输入 ─────────────────────────────────────────────────
    case 'input': {
      const content = stripQuotes(args[0]!);

      if (args.length >= 3 && args[1]?.toLowerCase() === 'to') {
        // input "value" to "locator"
        const locStr = stripQuotes(args[2]!);
        const locator = resolveLocatorFromString(page, locStr);
        if (content === '') {
          await locator.clear();
        } else {
          await locator.fill(content);
        }
      } else {
        // input "value" — 输入到当前焦点元素
        await page.keyboard.type(content);
      }
      break;
    }

    // ── 键盘 ─────────────────────────────────────────────────
    case 'keyboard': {
      const keys = args.map((k) => stripQuotes(k).toLowerCase());
      // 将 DSL 大写键名转换为 Playwright 格式
      const pwKeys = keys.map(toPwKey);
      if (pwKeys.length === 1) {
        await page.keyboard.press(pwKeys[0]!);
      } else {
        await page.keyboard.press(pwKeys.join('+'));
      }
      break;
    }

    // ── 悬停 ─────────────────────────────────────────────────
    case 'hover': {
      const locator = resolveLocatorFromString(page, stripQuotes(args[0]!));
      await locator.hover();
      break;
    }

    // ── 滚动 ─────────────────────────────────────────────────
    case 'scroll_to': {
      const locator = resolveLocatorFromString(page, stripQuotes(args[0]!));
      await locator.scrollIntoViewIfNeeded();
      break;
    }

    // ── 截图 ─────────────────────────────────────────────────
    case 'screenshot': {
      const dir = opts.screenshotDir ?? '.resumewright/screenshots';
      fs.mkdirSync(dir, { recursive: true });
      const timestamp = getFormattedDateTime();
      const stepId = opts.stepId ?? 'unknown';
      const screenshotPath = path.join(dir, `${stepId}-${timestamp}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`[dsl]   📸 Screenshot saved: ${screenshotPath}`);
      break;
    }

    // ── 等待 ─────────────────────────────────────────────────
    case 'wait': {
      const ms = parseDuration(args[0]!);
      await page.waitForTimeout(ms);
      break;
    }

    // ── 复选框 ───────────────────────────────────────────────
    case 'check': {
      const label = stripQuotes(args[0]!);
      const locator = page.getByLabel(label);
      await locator.check();
      break;
    }

    // ── 上传 ─────────────────────────────────────────────────
    case 'upload': {
      const filePath = path.resolve(process.cwd(), stripQuotes(args[0]!));
      const fileInput = page.locator('input[type="file"]').filter({ visible: true }).first();
      await fileInput.setInputFiles(filePath);
      break;
    }

    // ── 执行 JS ──────────────────────────────────────────────
    case 'execute_script': {
      const jsCode = inst.block ?? '';
      const scriptArgs = inst.args.map((a) => {
        const interp = interpolate(a, ctx);
        // 尝试解析为变量值
        if (interp.startsWith('$')) {
          return ctx.getPath(interp.slice(1));
        }
        return interp;
      });
      await page.evaluate(
        ({ code, args }: { code: string; args: unknown[] }) => {
          const fn = new Function(...args.map((_, i) => `arg${i}`), code);
          return fn(...args);
        },
        { code: jsCode, args: scriptArgs }
      );
      break;
    }

    // ── 断言：元素存在 ────────────────────────────────────────
    case 'assert_exists': {
      const locStr = stripQuotes(args[0]!);
      const timeoutMs = args[1] ? parseDuration(args[1]) : 5000;

      // 检测计数断言修饰符（/3, />2, />=1, /<5, /=3）
      const countMatch = locStr.match(/^(.+?)\/(=?>?=?<?\d+)$/);
      if (countMatch) {
        const baseLocStr = countMatch[1]!;
        const countExpr = countMatch[2]!;
        const locator = resolveLocatorFromString(page, baseLocStr);
        await assertCount(locator, countExpr, timeoutMs);
        break;
      }

      const locator = resolveLocatorFromString(page, locStr);
      await expect(locator).toBeVisible({ timeout: timeoutMs });
      break;
    }

    // ── 断言：元素不存在 ──────────────────────────────────────
    case 'assert_not_exists': {
      const locStr = stripQuotes(args[0]!);
      const timeoutMs = args[1] ? parseDuration(args[1]) : 5000;
      const locator = resolveLocatorFromString(page, locStr);
      await expect(locator).not.toBeVisible({ timeout: timeoutMs });
      break;
    }

    // ── 断言：文本相等 ────────────────────────────────────────
    case 'assert_text_equal': {
      const left = stripQuotes(interpolate(args[0]!, ctx));
      const right = stripQuotes(interpolate(args[1]!, ctx));
      // 如果 left 是变量引用，获取其值
      const leftVal = left.startsWith('$')
        ? String(ctx.getPath(left.slice(1)) ?? left)
        : left;
      const rightVal = right.startsWith('$')
        ? String(ctx.getPath(right.slice(1)) ?? right)
        : right;

      const isMatch = (val: string, pattern: string): boolean => {
        if (pattern.includes('*')) {
          const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regexStr = '^' + escaped.replace(/\\\*/g, '[\\s\\S]*') + '$';
          return new RegExp(regexStr).test(val);
        }
        return val === pattern;
      };

      if (!isMatch(leftVal, rightVal)) {
        throw new Error(
          `assert_text_equal failed: "${leftVal}" does not match pattern "${rightVal}"`
        );
      }
      break;
    }

    // ── 断言：页面标题 ────────────────────────────────────────
    case 'assert_title_exists': {
      const titleText = stripQuotes(args[0]!);
      await expect(page).toHaveTitle(new RegExp(escapeRegex(titleText)));
      break;
    }

    // ── HTTP 请求（无赋值）────────────────────────────────────
    case 'do_get':
    case 'do_post':
    case 'do_put':
    case 'do_delete': {
      const url = stripQuotes(args[0]!);
      const expectedStatus = args[1] ? parseInt(args[1], 10) : 200;
      const body = inst.block ? interpolate(inst.block, ctx) : undefined;
      await doHttpRequest(page, cmd, url, body, expectedStatus);
      break;
    }

    // ── 宏 ───────────────────────────────────────────────────
    case 'macro': {
      const macroName = stripQuotes(args[0]!);
      const macroArgs = args.slice(1).map((a) => stripQuotes(a));
      const macroInstructions = loadMacro(macroName, macroArgs, opts.macrosDir);
      await executeInstructions(macroInstructions, page, ctx, opts);
      break;
    }

    default:
      throw new Error(`Unhandled DSL command: ${cmd}`);
  }
}

// ── HTTP 请求执行 ──────────────────────────────────────────────

async function doHttpRequest(
  page: Page,
  method: string,
  url: string,
  body: string | undefined,
  expectedStatus: number
): Promise<unknown> {
  const m = method.replace('do_', '').toUpperCase();
  let response;

  // 解析 body 中的 header: 前缀
  let headers: Record<string, string> | undefined;
  let bodyData: string | undefined = body;

  if (body) {
    const headerMatch = body.match(/^header:\{(.+?)\}\n([\s\S]*)$/m);
    if (headerMatch) {
      try {
        headers = JSON.parse(`{${headerMatch[1]}}`);
      } catch { /* ignore */ }
      bodyData = headerMatch[2]?.trim();
    }
  }

  const reqOpts: Record<string, unknown> = { headers };
  if (bodyData) {
    reqOpts['data'] = bodyData;
  }

  switch (m) {
    case 'GET':
      response = await page.request.get(url, reqOpts);
      break;
    case 'POST':
      response = await page.request.post(url, reqOpts);
      break;
    case 'PUT':
      response = await page.request.put(url, reqOpts);
      break;
    case 'DELETE':
      response = await page.request.delete(url, reqOpts);
      break;
    default:
      throw new Error(`Unknown HTTP method: ${m}`);
  }

  if (response.status() !== expectedStatus) {
    throw new Error(
      `HTTP ${m} ${url} returned ${response.status()}, expected ${expectedStatus}`
    );
  }

  const contentType = response.headers()['content-type'] ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

// ── 计数断言 ──────────────────────────────────────────────────

async function assertCount(
  locator: import('@playwright/test').Locator,
  countExpr: string,
  timeout: number
): Promise<void> {
  const count = await locator.count();

  const match = countExpr.match(/^(>=|<=|>|<|=)?(\d+)$/);
  if (!match) throw new Error(`Invalid count expression: /${countExpr}`);

  const op = match[1] ?? '=';
  const n = parseInt(match[2]!, 10);

  const ok =
    op === '=' ? count === n :
    op === '>=' ? count >= n :
    op === '<=' ? count <= n :
    op === '>' ? count > n :
    op === '<' ? count < n : false;

  if (!ok) {
    throw new Error(
      `assert_exists count check failed: found ${count} elements, expected ${op}${n}`
    );
  }
}

// ── 工具函数 ─────────────────────────────────────────────────

/**
 * 变量插值：将字符串中的 $var / $var.field.0 替换为实际值
 */
export function interpolate(template: string, ctx: ContextStore): string {
  return template.replace(/\$([a-zA-Z_][\w.]*)/g, (_, path) => {
    const val = ctx.getPath(path);
    return val !== undefined && val !== null ? String(val) : `$${path}`;
  });
}

/**
 * 解析时间字符串：2s → 2000, 0.5s → 500
 */
function parseDuration(s: string): number {
  const cleaned = s.trim();
  if (cleaned.endsWith('ms')) return parseInt(cleaned, 10);
  if (cleaned.endsWith('s')) return parseFloat(cleaned) * 1000;
  return parseInt(cleaned, 10);
}

/**
 * DSL 键名转 Playwright 键名
 */
function toPwKey(key: string): string {
  const MAP: Record<string, string> = {
    enter: 'Enter', tab: 'Tab', escape: 'Escape', backspace: 'Backspace',
    delete: 'Delete', space: 'Space', control: 'Control', shift: 'Shift',
    alt: 'Alt', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  };
  return MAP[key.toLowerCase()] ?? key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripDollar(s: string): string {
  return s.startsWith('$') ? s.slice(1) : s;
}
