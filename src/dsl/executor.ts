// ============================================================
// executor.ts — DSL 命令执行器
// 将 DslInstruction 翻译为 Playwright API 调用
// ============================================================

import path from 'node:path';
import fs from 'node:fs';
import type { Page, Request } from '@playwright/test';
import { expect } from '@playwright/test';
import type { DslInstruction } from '../types/dsl.types.js';
import { parseScript } from './parser.js';
import { loadMacro } from './macro-loader.js';
import { resolveLocatorFromString, resolveInputLocator, stripQuotes, SPECIAL_LOCATOR_REGEX } from './locator-resolver.js';
import type { ContextStore } from '../engine/context-store.js';
import { getFormattedDateTime } from '../engine/datetime-utils.js';
import { escapeRegex } from '../utils.js';

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\\/\?\:\*\"\<\|\>\s\'\`]/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface ExecutorOptions {
  screenshotDir?: string;
  macrosDir?: string;
  stepId?: string;
  screenshotOnAssert?: boolean;
  assertTimeout?: string | number;
}

// ── 主执行函数 ────────────────────────────────────────────────

// ── 断言指令集合（用于可选指令报错时的跳过判断） ───────────────
const ASSERT_COMMANDS = new Set<string>([
  'assert_exists',
  'assert_not_exists',
  'assert_text_equal',
  'assert_title_exists',
  'assert_url',
]);

/**
 * 执行一段 DSL 脚本字符串
 */
export async function executeScript(
  script: string,
  page: Page,
  ctx: ContextStore,
  opts: ExecutorOptions = {}
): Promise<void> {
  // 重置上一次 step 运行残留的跳过状态标记
  ctx.set('_skip_remaining_instructions', false);
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
  // 如果已触发跳过剩余指令的标记，则直接默默跳过该指令
  if (ctx.get('_skip_remaining_instructions')) {
    return;
  }

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
      const lineInfo = inst.lineNumber ? ` (第 ${inst.lineNumber} 行)` : '';
      console.warn(`[dsl] ⚠ Optional step failed (skipped): ${inst.raw}${lineInfo}\n  ${String(err)}`);
      
      const isAssert = inst.command !== null && ASSERT_COMMANDS.has(inst.command);
      if (isAssert) {
        // 断言类型：仅跳过该行，继续执行后面的命令
      } else {
        // 操作类型：设置跳过标记，使当前 step/sub step 后续所有命令默默跳过
        ctx.set('_skip_remaining_instructions', true);
        console.warn(`[dsl] ⏭  Skipping remaining instructions in current step due to optional action failure.`);
      }
    }
  } else {
    try {
      await run();
    } catch (err) {
      const lineInfo = inst.lineNumber ? `\n  📍 位于脚本第 ${inst.lineNumber} 行: ${inst.raw.trim()}` : '';
      throw new Error(`${String(err)}${lineInfo}`);
    }
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

    case 'literal': {
      value = interpolate(inst.args[0]!, ctx);
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
      let url = interpolate(rawUrl, ctx);
      url = resolveUrl(url, ctx);
      const expectedStatus = parseInt(rawStatus ?? '200', 10);
      const body = inst.block ? interpolate(inst.block, ctx) : undefined;
      value = await doHttpRequest(page, method, url, body, expectedStatus);
      break;
    }

    case 'execute_script': {
      const jsCode = inst.block ?? '';
      const scriptArgs = inst.args.map((a) => ctx.getPath(stripDollar(a)) ?? stripQuotes(a));
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

  const defaultAssertTimeout = opts.assertTimeout !== undefined
    ? (typeof opts.assertTimeout === 'number' ? opts.assertTimeout : parseDuration(String(opts.assertTimeout)))
    : 5000;

  switch (cmd) {
    // ── 导航 ──────────────────────────────────────────────────
    case 'open': {
      let url = stripQuotes(args[0]!);
      url = resolveUrl(url, ctx);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      // 等待 SPA 路由完成（body 可见即可）
      await page.waitForLoadState('load');
      
      const secondArg = args[1] ? stripQuotes(args[1]).toLowerCase() : '';
      if (secondArg === 'fast') {
        // 跳过网络空闲等待，直接进行下一步
      } else {
        const timeoutMs = secondArg ? parseDuration(secondArg) : 5000;
        // 智能等待接口网络空闲，自动忽略轮询/WebSocket/心跳
        await waitForSmartNetworkIdle(page, timeoutMs, 500);
      }
      break;
    }


    // ── 点击 ─────────────────────────────────────────────────
    case 'tap': {
      let locStr = args[0]!;
      let remainingArgs = args.slice(1);

      if (remainingArgs.length >= 1 && /^\/-?\d+$/.test(remainingArgs[0]!)) {
        locStr = `${locStr} ${remainingArgs[0]}`;
        remainingArgs.shift();
      }

      // 坐标点击：tap 0.5 0.5 (相对) 或 tap "100" "200" (绝对像素)
      if (args.length >= 2 && !locStr.startsWith('"') && !locStr.startsWith("'")) {
        const x = parseFloat(args[0]!);
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

      // near 近邻定位修饰符
      const tapNearOpts = parseNearOptions(remainingArgs);
      if (tapNearOpts) {
        const el = await findNearestReachable(page, locStr, tapNearOpts, defaultAssertTimeout);
        await el.click();
      } else {
        const locator = resolveLocatorFromString(page, locStr);
        await locator.click();
      }
      break;
    }

    // ── 输入 ─────────────────────────────────────────────────
    case 'input': {
      const content = stripQuotes(args[0]!);

      if (args.length >= 3 && args[1]?.toLowerCase() === 'to') {
        // input "value" to "locator" [near "anchor"] [/0] [/-1]
        const rawLocStr = args[2]!;
        const remainingArgs = args.slice(3);

        // near 近邻定位修饰符
        const inputNearOpts = parseNearOptions(remainingArgs);
        if (inputNearOpts) {
          const el = await findNearestReachable(page, rawLocStr, inputNearOpts, defaultAssertTimeout);
          if (content === '') {
            await el.clear();
          } else {
            await el.fill(content);
          }
        } else {
          // 如果有索引修饰符（/0, /-1 等），合并到 locator 字符串
          let locStr = rawLocStr;
          if (remainingArgs.length >= 1 && /^\/-?\d+$/.test(remainingArgs[0]!)) {
            locStr = `${locStr} ${remainingArgs[0]}`;
          }
          const locator = resolveInputLocator(page, locStr);
          if (content === '') {
            await locator.clear();
          } else {
            await locator.fill(content);
          }
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
      const hoverNearOpts = parseNearOptions(args.slice(1));
      if (hoverNearOpts) {
        const el = await findNearestReachable(page, args[0]!, hoverNearOpts, defaultAssertTimeout);
        await el.hover();
      } else {
        const locator = resolveLocatorFromString(page, args[0]!);
        await locator.hover();
      }
      break;
    }

    // ── 滚动 ─────────────────────────────────────────────────
    case 'scroll_to': {
      const scrollNearOpts = parseNearOptions(args.slice(1));
      if (scrollNearOpts) {
        const el = await findNearestReachable(page, args[0]!, scrollNearOpts, defaultAssertTimeout);
        await el.scrollIntoViewIfNeeded();
      } else {
        const locator = resolveLocatorFromString(page, args[0]!);
        await locator.scrollIntoViewIfNeeded();
      }
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
      console.log(`[dsl]   📸 Screenshot saved: ${decodeURIComponent(screenshotPath)}`);
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
      const rawPath = stripQuotes(args[0]!);
      let filePath: string;
      if (path.isAbsolute(rawPath)) {
        filePath = rawPath;
      } else {
        const projectRoot = ctx.get('_project_root') as string | undefined;
        filePath = path.resolve(projectRoot || process.cwd(), rawPath);
      }
      let fileInput;
      if (args.length >= 3 && args[1] === 'to') {
        fileInput = resolveLocatorFromString(page, args[2]!);
      } else if (args.length >= 2) {
        fileInput = resolveLocatorFromString(page, args[1]!);
      } else {
        fileInput = page.locator('input[type="file"]').filter({ visible: true }).first();
      }
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
        return stripQuotes(interp);
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

      // near 修饰符：找最近可达元素（找不到则抛出，等同于断言不存在）
      const assertNearOpts = parseNearOptions(args.slice(1));
      if (assertNearOpts) {
        let timeoutMs = defaultAssertTimeout;
        const lastArg = args[args.length - 1];
        if (lastArg && /^\d+(\.\d+)?(ms|s|m)$/.test(lastArg)) {
          timeoutMs = parseDuration(lastArg);
        }
        await findNearestReachable(page, locStr, assertNearOpts, timeoutMs);
        if (opts.screenshotOnAssert) {
          const dir = opts.screenshotDir ?? '.resumewright/screenshots';
          fs.mkdirSync(dir, { recursive: true });
          const stepId = opts.stepId ?? 'unknown';
          const sanitizedArg = sanitizeFilename(locStr) || 'target';
          const screenshotPath = path.join(dir, `${sanitizedArg}-${stepId}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: false });
          console.log(`[dsl]   📸 Assert screenshot saved: ${decodeURIComponent(screenshotPath)}`);
        }
        break;
      }

      const timeoutMs = args[1] ? parseDuration(args[1]) : defaultAssertTimeout;

      // 检测计数断言修饰符（/3, />2, />=1, /<5, /=3）
      const countMatch = locStr.match(/^(.+?)\/(=?>?=?<?\d+)$/);
      if (countMatch) {
        const baseLocStr = countMatch[1]!;
        const countExpr = countMatch[2]!;
        const locator = resolveLocatorFromString(page, baseLocStr);
        await assertCount(locator, countExpr, timeoutMs);
      } else {
        const locator = resolveLocatorFromString(page, locStr);
        await expect(locator).toBeVisible({ timeout: timeoutMs });
      }

      if (opts.screenshotOnAssert) {
        const dir = opts.screenshotDir ?? '.resumewright/screenshots';
        fs.mkdirSync(dir, { recursive: true });
        const stepId = opts.stepId ?? 'unknown';
        const sanitizedArg = sanitizeFilename(locStr) || 'target';
        const screenshotPath = path.join(dir, `${sanitizedArg}-${stepId}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`[dsl]   📸 Assert screenshot saved: ${decodeURIComponent(screenshotPath)}`);
      }
      break;
    }

    // ── 断言：元素不存在 ──────────────────────────────────────
    case 'assert_not_exists': {
      const locStr = stripQuotes(args[0]!);
      const timeoutMs = args[1] ? parseDuration(args[1]) : defaultAssertTimeout;
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
      await expect(page).toHaveTitle(new RegExp(escapeRegex(titleText)), { timeout: defaultAssertTimeout });
      break;
    }

    // ── 断言：页面 URL ────────────────────────────────────────
    case 'assert_url': {
      const pattern = stripQuotes(interpolate(args[0]!, ctx));
      const timeoutMs = args[1] ? parseDuration(args[1]) : defaultAssertTimeout;

      const startTime = Date.now();
      let matched = false;
      let lastUrl = '';

      while (Date.now() - startTime < timeoutMs) {
        lastUrl = page.url();
        if (matchUrl(lastUrl, pattern)) {
          matched = true;
          break;
        }
        await page.waitForTimeout(100);
      }

      if (!matched) {
        throw new Error(
          `assert_url failed: URL "${lastUrl}" did not match pattern "${pattern}" within ${timeoutMs}ms`
        );
      }

      if (opts.screenshotOnAssert) {
        const dir = opts.screenshotDir ?? '.resumewright/screenshots';
        fs.mkdirSync(dir, { recursive: true });
        const stepId = opts.stepId ?? 'unknown';
        const sanitizedArg = sanitizeFilename(pattern) || 'target';
        const screenshotPath = path.join(dir, `${sanitizedArg}-${stepId}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`[dsl]   📸 Assert screenshot saved: ${decodeURIComponent(screenshotPath)}`);
      }
      break;
    }

    // ── HTTP 请求（无赋值）────────────────────────────────────
    case 'do_get':
    case 'do_post':
    case 'do_put':
    case 'do_delete': {
      let url = stripQuotes(args[0]!);
      url = resolveUrl(url, ctx);
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

    // ── 调试检查 ─────────────────────────────────────────────
    case 'inspect': {
      const locStr = args[0] ? stripQuotes(args[0]) : '';

      // 收集节点信息（在浏览器端执行）
      type NodeInfo = {
        index: number;
        tag: string;
        id: string;
        className: string;
        text: string;
        visible: boolean;
        disabled: boolean;
        attrs: Record<string, string>;
        bbox: { x: number; y: number; width: number; height: number } | null;
      };

      let nodes: NodeInfo[] = [];

      if (locStr) {
        const locator = resolveLocatorFromString(page, locStr);
        const count = await locator.count();

        for (let idx = 0; idx < count; idx++) {
          const el = locator.nth(idx);
          const info = await el.evaluate((node): NodeInfo => {
            const el = node as HTMLElement;
            const rect = el.getBoundingClientRect();
            const attrs: Record<string, string> = {};
            for (const attr of Array.from(el.attributes)) {
              attrs[attr.name] = attr.value;
            }
            const style = window.getComputedStyle(el);
            const visible =
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.opacity !== '0' &&
              rect.width > 0 &&
              rect.height > 0;
            return {
              index: 0, // filled below
              tag: el.tagName.toLowerCase(),
              id: el.id,
              className: typeof el.className === 'string' ? el.className : (el.getAttribute('class') ?? ''),
              text: (el.textContent ?? '').trim().slice(0, 200),
              visible,
              disabled: (el as HTMLInputElement).disabled ?? false,
              attrs,
              bbox: rect.width > 0 ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
            };
          });
          info.index = idx;
          nodes.push(info);
        }
      }

      // ── 终端输出 ────────────────────────────────────────────
      const CYAN = '\x1b[36m';
      const YELLOW = '\x1b[33m';
      const GREEN = '\x1b[32m';
      const RED = '\x1b[31m';
      const DIM = '\x1b[2m';
      const RESET = '\x1b[0m';
      const BOLD = '\x1b[1m';

      console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}`);
      console.log(`${BOLD}${CYAN}║  🔍 inspect${RESET}  ${YELLOW}${locStr || '(no locator)'}${RESET}`);
      console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${RESET}`);
      console.log(`${DIM}  Current URL: ${page.url()}${RESET}`);

      if (!locStr) {
        console.log(`${YELLOW}  ⚠  No locator provided — page paused for manual inspection${RESET}`);
      } else if (nodes.length === 0) {
        console.log(`${RED}  ✗  No elements matched: "${locStr}"${RESET}`);
      } else {
        console.log(`${GREEN}  ✓  Found ${nodes.length} element(s) matching: "${locStr}"${RESET}\n`);
        for (const n of nodes) {
          console.log(`  ${BOLD}[${n.index}]${RESET} <${CYAN}${n.tag}${RESET}>${n.id ? ` #${n.id}` : ''}${n.className ? ` .${n.className.trim().replace(/\s+/g, '.')}` : ''}`);
          console.log(`       text     : ${n.text ? `"${n.text}"` : DIM + '(empty)' + RESET}`);
          console.log(`       visible  : ${n.visible ? GREEN + '✓ visible' + RESET : RED + '✗ hidden' + RESET}`);
          console.log(`       disabled : ${n.disabled ? RED + 'yes' + RESET : 'no'}`);
          if (n.bbox) {
            console.log(`       bbox     : x=${n.bbox.x} y=${n.bbox.y} w=${n.bbox.width} h=${n.bbox.height}`);
          }
          const attrEntries = Object.entries(n.attrs).filter(([k]) => !['class', 'id', 'style'].includes(k));
          if (attrEntries.length > 0) {
            console.log(`       attrs    : ${attrEntries.map(([k, v]) => `${k}="${v}"`).join('  ')}`);
          }
          console.log('');
        }
      }
      console.log(`${YELLOW}  ⏸  Page paused — open Playwright Inspector or press Resume in browser${RESET}`);
      console.log(`${DIM}──────────────────────────────────────────────────────${RESET}\n`);

      // ── 浏览器 console 输出 ─────────────────────────────────
      if (nodes.length === 0) {
        await page.evaluate(({ locStr }) => {
          console.group(`%c🔍 DSL inspect: "${locStr}"`, 'color:#06b6d4;font-weight:bold;font-size:14px');
          console.warn('⚠ No elements found for locator:', locStr);
          console.groupEnd();
        }, { locStr });
      } else {
        const locator = resolveLocatorFromString(page, locStr);
        await locator.evaluateAll((elements, { locStr }) => {
          console.group(`%c🔍 DSL inspect: "${locStr}"`, 'color:#06b6d4;font-weight:bold;font-size:14px');
          console.log('%cMatched elements:', 'color:#a3e635;font-weight:bold', elements.length, elements);
          elements.forEach((el, index) => {
            console.groupCollapsed(`%c[${index}] <${el.tagName.toLowerCase()}>${el.id ? ' #' + el.id : ''}`, 'color:#f59e0b;font-weight:bold');
            console.log('%cDOM Node  :', 'color:#3b82f6;font-weight:bold', el); // 输出真实 DOM 节点！
            console.log('visible   :', (() => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
            })());
            console.log('textContent:', el.textContent);
            console.log('attrs     :', (() => {
              const attrs: Record<string, string> = {};
              for (const attr of Array.from(el.attributes)) {
                attrs[attr.name] = attr.value;
              }
              return attrs;
            })());
            console.groupEnd();
          });
          console.groupEnd();
        }, { locStr });
      }

      // ── 暂停页面 ────────────────────────────────────────────
      await page.pause();
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
 * 变量插值：将字符串中的 $var / $var.field.0 替换为实际值，并支持内置动态日期时间变量及从上下文读取格式化控制（如 $today+3d, $now-2h）
 */
export function interpolate(template: string, ctx: ContextStore): string {
  // 1. 替换内置动态日期时间变量，支持 $today, $now, $date 及其时间偏移量计算
  let result = template.replace(/\$(today|now|date)(?:([+-]\d+)([dmhyM]))?(?!\w)/g, (match, base, offsetStr, unit) => {
    const date = new Date();

    if (offsetStr && unit) {
      const offset = parseInt(offsetStr, 10);
      if (unit === 'd') {
        date.setDate(date.getDate() + offset);
      } else if (unit === 'h') {
        date.setHours(date.getHours() + offset);
      } else if (unit === 'm') {
        date.setMinutes(date.getMinutes() + offset);
      } else if (unit === 'M') {
        date.setMonth(date.getMonth() + offset);
      } else if (unit === 'y') {
        date.setFullYear(date.getFullYear() + offset);
      }
    }

    let fmt = '';
    if (base === 'now') {
      const customFmt = ctx.getPath('datetime_format');
      fmt = typeof customFmt === 'string' ? customFmt : 'YYYY-MM-DD HH:mm:ss';
    } else {
      const customFmt = ctx.getPath('date_format');
      fmt = typeof customFmt === 'string' ? customFmt : 'YYYY-MM-DD';
    }

    return formatCustomDate(date, fmt);
  });

  // 2. 替换普通的上下文变量
  result = result.replace(/\$([a-zA-Z_][\w.]*)/g, (_, path) => {
    const val = ctx.getPath(path);
    return val !== undefined && val !== null ? String(val) : `$${path}`;
  });

  return result;
}

/**
 * 自定义格式化日期函数
 */
function formatCustomDate(date: Date, fmt: string): string {
  const yyyy = date.getFullYear();
  const yy = String(yyyy).slice(-2);
  const mRaw = date.getMonth() + 1;
  const mm = String(mRaw).padStart(2, '0');
  const m = String(mRaw);
  const dRaw = date.getDate();
  const dd = String(dRaw).padStart(2, '0');
  const d = String(dRaw);
  const hRaw = date.getHours();
  const hh = String(hRaw).padStart(2, '0');
  const h = String(hRaw);
  const minRaw = date.getMinutes();
  const mmMin = String(minRaw).padStart(2, '0');
  const mMin = String(minRaw);
  const sRaw = date.getSeconds();
  const ss = String(sRaw).padStart(2, '0');
  const s = String(sRaw);

  return fmt
    .replace(/YYYY/g, String(yyyy))
    .replace(/YY/g, yy)
    .replace(/MM/g, mm)
    .replace(/M/g, m)
    .replace(/DD/g, dd)
    .replace(/D/g, d)
    .replace(/HH/g, hh)
    .replace(/H/g, h)
    .replace(/mm/g, mmMin)
    .replace(/m/g, mMin)
    .replace(/ss/g, ss)
    .replace(/s/g, s);
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

function isWildcardMatch(val: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regexStr = '^' + escaped.replace(/\\\*/g, '[\\s\\S]*') + '$';
  return new RegExp(regexStr).test(val);
}

function matchUrl(currentUrl: string, pattern: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(currentUrl);
  } catch {
    return currentUrl === pattern || (pattern.includes('*') && isWildcardMatch(currentUrl, pattern));
  }

  const relativeUrl = parsed.pathname + parsed.search + parsed.hash;
  const relativeUrlNoSearch = parsed.pathname + parsed.hash;
  const hash = parsed.hash;

  // 1. 通配符模糊匹配
  if (pattern.includes('*')) {
    return (
      isWildcardMatch(currentUrl, pattern) ||
      isWildcardMatch(relativeUrl, pattern) ||
      isWildcardMatch(relativeUrlNoSearch, pattern) ||
      isWildcardMatch(hash, pattern)
    );
  }

  // 2. 精确匹配
  if (currentUrl === pattern) return true;
  if (relativeUrl === pattern) return true;
  if (relativeUrlNoSearch === pattern) return true;
  if (hash === pattern) return true;

  // 3. 相对路径匹配（去掉首部的 /）
  if (!pattern.startsWith('/') && !pattern.startsWith('#') && !pattern.startsWith('http')) {
    if (parsed.pathname.replace(/^\//, '') === pattern) return true;
    if (relativeUrlNoSearch.replace(/^\//, '') === pattern) return true;
  }

  return false;
}

function stripDollar(s: string): string {
  return s.startsWith('$') ? s.slice(1) : s;
}

/**
 * 智能等待网络空闲，过滤并忽略长连接（WebSocket、SSE）以及持续的心跳/轮询请求。
 */
export async function waitForSmartNetworkIdle(page: Page, timeoutMs = 5000, idleMs = 500): Promise<void> {
  const activeRequests = new Set<Request>();
  let idleTimer: NodeJS.Timeout | null = null;
  let resolvePromise: (() => void) | null = null;

  const isIgnored = (url: string, resourceType: string): boolean => {
    // 1. 过滤 WebSockets 和 Server-Sent Events (SSE)
    if (resourceType === 'websocket' || resourceType === 'eventsource') {
      return true;
    }
    // 2. 过滤常见的心跳、数据埋点和定时轮询接口
    const ignoredPatterns = [
      /heartbeat/i,
      /ping/i,
      /socket\.io/i,
      /sockjs/i,
      /metrics/i,
      /telemetry/i
    ];
    return ignoredPatterns.some((pattern) => pattern.test(url));
  };

  const cleanup = () => {
    page.off('request', onRequest);
    page.off('requestfinished', onRequestFinished);
    page.off('requestfailed', onRequestFailed);
    page.off('close', onClosed);
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const onClosed = () => {
    cleanup();
    if (resolvePromise) resolvePromise();
  };

  const checkIdle = () => {
    if (activeRequests.size === 0) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        cleanup();
        if (resolvePromise) resolvePromise();
      }, idleMs);
    } else {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    }
  };

  const onRequest = (request: Request) => {
    const url = request.url();
    const type = request.resourceType();
    if (!isIgnored(url, type)) {
      activeRequests.add(request);
      checkIdle();
    }
  };

  const onRequestFinished = (request: Request) => {
    activeRequests.delete(request);
    checkIdle();
  };

  const onRequestFailed = (request: Request) => {
    activeRequests.delete(request);
    checkIdle();
  };

  page.on('request', onRequest);
  page.on('requestfinished', onRequestFinished);
  page.on('requestfailed', onRequestFailed);
  page.on('close', onClosed);

  // 初始检查以防没有当前网络请求
  checkIdle();

  await Promise.race([
    new Promise<void>((resolve) => {
      resolvePromise = resolve;
    }),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);
    })
  ]);
}

function resolveUrl(url: string, ctx: ContextStore): string {
  if (!/^(https?|file|about):/i.test(url)) {
    const baseUrl = ctx.get('base_url');
    if (typeof baseUrl === 'string') {
      const separator = baseUrl.endsWith('/') || url.startsWith('/') ? '' : '/';
      return baseUrl + separator + url;
    }
  }
  return url;
}

// ── Near 近邻定位辅助 ──────────────────────────────────────────

type NearDirection = 'left' | 'right' | 'top' | 'bottom';

interface NearOptions {
  anchors: string[];
  direction?: NearDirection;
  nth: number;
}

const NEAR_DIRECTIONS = new Set<string>(['left', 'right', 'top', 'bottom']);

/**
 * 从「目标参数之后」的参数列表中解析 near 修饰符。
 * 语法：[near "anchor1"] [near "anchor2"] [left|right|top|bottom] [nth=N]
 * 返回 null 表示没有 near 修饰符。
 */
export function parseNearOptions(afterTargetArgs: string[]): NearOptions | null {
  if (!afterTargetArgs.includes('near')) return null;

  const anchors: string[] = [];
  let direction: NearDirection | undefined;
  let nth = 0;

  let i = 0;
  while (i < afterTargetArgs.length) {
    const token = afterTargetArgs[i]!;
    if (token === 'near') {
      i++;
      // 下一个 token 如果不是关键字，则作为锚点定位字符串
      if (
        i < afterTargetArgs.length &&
        afterTargetArgs[i] !== 'near' &&
        !NEAR_DIRECTIONS.has(afterTargetArgs[i]!) &&
        !afterTargetArgs[i]!.startsWith('nth=')
      ) {
        anchors.push(afterTargetArgs[i]!);
        i++;
      }
    } else if (NEAR_DIRECTIONS.has(token)) {
      direction = token as NearDirection;
      i++;
    } else if (token.startsWith('nth=')) {
      nth = parseInt(token.slice(4), 10) || 0;
      i++;
    } else {
      i++;
    }
  }

  if (anchors.length === 0) return null;
  return { anchors, direction, nth };
}

/**
 * 近邻定位核心算法：
 * 在所有匹配 targetLocStr 的可见元素中，找到「距所有锚点最近且可达」的元素。
 *
 * 步骤：
 * 1. 获取各锚点元素的屏幕中心坐标
 * 2. 遍历目标元素，依次过滤：
 *    a. elementFromPoint 可达性（自动过滤被 Modal/Overlay 遮挡的元素）
 *    b. 方向扇区（left/right/top/bottom，以主锚点为原点）
 * 3. 计算到所有锚点的欧氏距离之和并排序
 * 4. 按 nth 取第 N 近（0 = 最近）
 */
export async function findNearestReachable(
  page: Page,
  targetLocStr: string,
  nearOpts: NearOptions,
  timeoutMs: number = 2000
): Promise<import('@playwright/test').Locator> {
  const startTime = Date.now();
  let anchorCenters: Array<{ cx: number; cy: number }> = [];
  let targetLoc!: import('@playwright/test').Locator;
  let count = 0;

  while (true) {
    try {
      // 1. 获取所有锚点中心坐标
      anchorCenters = [];
      let isFirst = true;
      for (const anchorStr of nearOpts.anchors) {
        let anchorLoc = resolveLocatorFromString(page, anchorStr);
        let anchorCount = await anchorLoc.count();

        const isAnchorPlain = !SPECIAL_LOCATOR_REGEX.test(stripQuotes(anchorStr));
        if (anchorCount === 0 && isAnchorPlain) {
          anchorLoc = resolveInputLocator(page, anchorStr);
          anchorCount = await anchorLoc.count();
        }

        if (anchorCount === 0) {
          throw new Error(`near: no elements found matching anchor "${stripQuotes(anchorStr)}"`);
        }

        if (isFirst) {
          await anchorLoc.first().scrollIntoViewIfNeeded({ timeout: 3000 });
          isFirst = false;
        }
        const box = await anchorLoc.first().boundingBox();
        if (!box) {
          throw new Error(`near: anchor "${stripQuotes(anchorStr)}" has no bounding box (not visible?)`);
        }
        anchorCenters.push({ cx: box.x + box.width / 2, cy: box.y + box.height / 2 });
      }

      // 2. 获取目标元素集合
      let tmpTargetLoc = resolveLocatorFromString(page, targetLocStr);
      let tmpCount = await tmpTargetLoc.count();

      // 如果没有匹配到任何元素，且是普通文字定位器，尝试作为 input 定位器匹配（例如 placeholder/label）
      const isPlain = !SPECIAL_LOCATOR_REGEX.test(stripQuotes(targetLocStr));
      if (tmpCount === 0 && isPlain) {
        tmpTargetLoc = resolveInputLocator(page, targetLocStr);
        tmpCount = await tmpTargetLoc.count();
      }

      if (tmpCount === 0) {
        throw new Error(`near: no elements found matching "${stripQuotes(targetLocStr)}"`);
      }

      targetLoc = tmpTargetLoc;
      count = tmpCount;
      break;
    } catch (err) {
      if (Date.now() - startTime >= timeoutMs) {
        throw err;
      }
      await page.waitForTimeout(200);
    }
  }

  if (count === 1) {
    // 仅一个目标，无需距离计算，直接返回
    return targetLoc.first();
  }

  // 3. 候选过滤 + 距离计算
  type Candidate = { idx: number; totalDist: number };
  const candidates: Candidate[] = [];
  const primaryAnchor = anchorCenters[0]!;

  for (let i = 0; i < count; i++) {
    const el = targetLoc.nth(i);
    const box = await el.boundingBox();
    if (!box) continue;

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // 3a. elementFromPoint 可达性检测
    //     判断该元素的视觉中心点是否「暴露在最顶层」（未被 Modal/Overlay/Tooltip 遮挡）
    const isReachable: boolean = await el.evaluate((domEl: Element) => {
      const rect = domEl.getBoundingClientRect();
      const testX = rect.left + rect.width / 2;
      const testY = rect.top + rect.height / 2;
      const topEl = document.elementFromPoint(testX, testY);
      if (topEl === null) return false;
      if (domEl === topEl || domEl.contains(topEl) || topEl.contains(domEl)) {
        return true;
      }
      // 如果 topEl 是与 domEl 共享近邻祖先的内部元素（如组件内的清除按钮、图标、占位符层等）
      // 允许最多向上看 3 层祖先节点
      let ancestor = domEl.parentElement;
      for (let depth = 0; depth < 3 && ancestor; depth++) {
        if (ancestor.contains(topEl)) {
          return true;
        }
        ancestor = ancestor.parentElement;
      }
      return false;
    });
    if (!isReachable) continue;

    // 3b. 方向扇区过滤（以主锚点为原点，使用角度范围划分四个方向）
    //     right: -45°~45°  bottom: 45°~135°  left: 135°~225°  top: -135°~-45°
    if (nearOpts.direction) {
      const angle = Math.atan2(cy - primaryAnchor.cy, cx - primaryAnchor.cx) * 180 / Math.PI;
      let inDir = false;
      switch (nearOpts.direction) {
        case 'right':  inDir = angle > -45  && angle <= 45;  break;
        case 'bottom': inDir = angle > 45   && angle <= 135; break;
        case 'left':   inDir = angle > 135  || angle <= -135; break;
        case 'top':    inDir = angle > -135 && angle <= -45; break;
      }
      if (!inDir) continue;
    }

    // 3c. 计算到所有锚点的欧氏距离之和
    //     双锚点时，取两者距离之和最小值，等效于「同时靠近两个锚点」（行列交叉定位）
    let totalDist = 0;
    for (const anchor of anchorCenters) {
      const dx = cx - anchor.cx;
      const dy = cy - anchor.cy;
      totalDist += Math.sqrt(dx * dx + dy * dy);
    }
    candidates.push({ idx: i, totalDist });
  }

  if (candidates.length === 0) {
    const dirMsg = nearOpts.direction ? ` [direction: ${nearOpts.direction}]` : '';
    throw new Error(
      `near: no reachable element "${stripQuotes(targetLocStr)}" found near "${nearOpts.anchors.map(stripQuotes).join('" and "')}"${dirMsg}`
    );
  }

  // 4. 按总距离升序排序，按 nth 取第 N 近（默认 0 = 最近）
  candidates.sort((a, b) => a.totalDist - b.totalDist);
  const picked = candidates[nearOpts.nth] ?? candidates[candidates.length - 1]!;

  console.log(
    `[dsl]   📍 near: picked element #${picked.idx}` +
    ` (dist=${Math.round(picked.totalDist)}px` +
    (nearOpts.direction ? `, dir=${nearOpts.direction}` : '') +
    (nearOpts.nth ? `, nth=${nearOpts.nth}` : '') +
    ')'
  );

  return targetLoc.nth(picked.idx);
}
