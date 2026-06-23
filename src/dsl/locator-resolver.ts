// ============================================================
// locator-resolver.ts — 元素定位解析（前缀自动识别）
// ============================================================

import type { Page, Locator } from '@playwright/test';
import type { ParsedLocator, LocatorModifier } from '../types/dsl.types.js';
import { getDefaultRegistry } from '../adapters/elements-csv.js';
import { stripQuotes, escapeRegex } from '../utils.js';

export const SPECIAL_LOCATOR_REGEX = /^(label:|placeholder:|testid:|title:|alt:|role:|css:|xpath:|\.|#|\/\/|@|\*.*\*|.*\|)/;

// ── 解析原始定位字符串 ──────────────────────────────────────

function extractModifier(str: string): { base: string; modifier?: LocatorModifier } {
  // 正则寻找以 /修饰符 结尾的结构
  const match = str.match(/^(.*?)\/(-?\d+|[a-zA-Z]+)$/);
  if (!match) {
    return { base: str };
  }

  const basePart = match[1]!;
  const modPart = match[2]!;

  // 校验该斜杠是否在未闭合的引号内
  let doubleQuoteCount = 0;
  let singleQuoteCount = 0;
  
  for (let i = 0; i < basePart.length; i++) {
    if (basePart[i] === '"' && (i === 0 || basePart[i - 1] !== '\\')) {
      doubleQuoteCount++;
    } else if (basePart[i] === "'" && (i === 0 || basePart[i - 1] !== '\\')) {
      singleQuoteCount++;
    }
  }

  // 如果双引号或单引号总数是奇数，说明斜杠处于未闭合的引号内部，这属于字面值，不作为修饰符
  if (doubleQuoteCount % 2 !== 0 || singleQuoteCount % 2 !== 0) {
    return { base: str };
  }

  // 否则，该斜杠是处于引号外部的，可以安全地作为修饰符分割符！
  let modifier: LocatorModifier;
  if (/^-?\d+$/.test(modPart)) {
    const idx = parseInt(modPart, 10);
    modifier = idx === -1 ? { last: true } : { index: idx };
  } else {
    modifier = { tag: modPart };
  }

  return { base: basePart.trim(), modifier };
}

const AUTO_TAG_LOCATORS = new Map<string, Omit<ParsedLocator, 'raw'>>([
  ['checkbox', { type: 'role', value: 'checkbox' }],
  ['radio', { type: 'role', value: 'radio' }],
  ['input', { type: 'css', value: 'input' }],
  ['textarea', { type: 'css', value: 'textarea' }],
  ['select', { type: 'css', value: 'select' }],
  ['button', { type: 'role', value: 'button' }],
]);

/**
 * 解析原始定位字符串为结构化的 ParsedLocator
 * 支持文本修饰符：/0  /-1  /tagName
 */
export function parseLocator(raw: string): ParsedLocator {
  let str = raw.trim();

  // ── 提取尾部修饰符并剥离引号 ──
  const { base, modifier } = extractModifier(str);
  str = stripQuotes(base);

  // ── 自动识别表单标签/Role (不带前缀的 checkbox, input, textarea 等) ──
  const lowerStr = str.toLowerCase();
  const autoParsed = AUTO_TAG_LOCATORS.get(lowerStr);
  if (autoParsed) {
    return {
      ...autoParsed,
      modifier,
      raw,
    } as ParsedLocator;
  }

  // ── alias: @别名 ──
  if (str.startsWith('@')) {
    return { type: 'alias', value: stripQuotes(str.slice(1)), modifier, raw };
  }

  // ── xpath: // 开头 或 xpath: 前缀 ──
  if (str.startsWith('//')) {
    return { type: 'xpath', value: stripQuotes(str), modifier, raw };
  }
  if (str.startsWith('xpath:')) {
    return { type: 'xpath', value: stripQuotes(str.slice(6)), modifier, raw };
  }

  // ── css: . 或 # 开头 或 css: 前缀 ──
  if (str.startsWith('.') || str.startsWith('#')) {
    return { type: 'css', value: stripQuotes(str), modifier, raw };
  }
  if (str.startsWith('css:')) {
    return { type: 'css', value: stripQuotes(str.slice(4)), modifier, raw };
  }

  // ── label: 前缀 ──
  if (str.startsWith('label:')) {
    return { type: 'label', value: stripQuotes(str.slice(6)), modifier, raw };
  }

  // ── placeholder: 前缀 ──
  if (str.startsWith('placeholder:')) {
    return { type: 'placeholder', value: stripQuotes(str.slice(12)), modifier, raw };
  }

  // ── testid: 前缀 ──
  if (str.startsWith('testid:')) {
    return { type: 'testid', value: stripQuotes(str.slice(7)), modifier, raw };
  }

  // ── title: 前缀 ──
  if (str.startsWith('title:')) {
    return { type: 'title', value: stripQuotes(str.slice(6)), modifier, raw };
  }

  // ── alt: 前缀 ──
  if (str.startsWith('alt:')) {
    return { type: 'alt', value: stripQuotes(str.slice(4)), modifier, raw };
  }

  // ── role: 前缀，格式 role:button[确认] ──
  if (str.startsWith('role:')) {
    const roleStr = str.slice(5);
    const roleMatch = roleStr.match(/^([a-zA-Z]+)\[(.+)\]$/);
    if (roleMatch) {
      return {
        type: 'role',
        value: roleMatch[1]!,
        roleName: stripQuotes(roleMatch[2]!),
        modifier,
        raw,
      };
    }
    return { type: 'role', value: stripQuotes(roleStr), modifier, raw };
  }

  // ── *text* 包含匹配 ──
  if (str.startsWith('*') && str.endsWith('*') && str.length > 2) {
    return { type: 'text_contains', value: stripQuotes(str.slice(1, -1)), modifier, raw };
  }

  // ── A|B OR 匹配 ──
  if (str.includes('|')) {
    return { type: 'text_or', value: stripQuotes(str), modifier, raw };
  }

  // ── 默认：精确文字匹配 ──
  return { type: 'text', value: str, modifier, raw };
}

// ── 将 ParsedLocator 转换为 Playwright Locator ──────────────

/**
 * 根据 ParsedLocator 构建 Playwright Locator 对象
 */
export function resolveLocator(page: Page, parsed: ParsedLocator): Locator {
  let locator: Locator;

  switch (parsed.type) {
    case 'text':
      if (hasWildcard(parsed.value)) {
        locator = page.getByText(wildcardToRegex(parsed.value));
      } else {
        locator = page.getByText(parsed.value, { exact: true });
      }
      break;

    case 'text_contains':
      locator = page.getByText(new RegExp(escapeRegex(parsed.value)));
      break;

    case 'text_or':
      locator = page.getByText(new RegExp(parsed.value));
      break;

    case 'label':
      if (hasWildcard(parsed.value)) {
        locator = page.getByLabel(wildcardToRegex(parsed.value));
      } else {
        locator = page.getByLabel(parsed.value, { exact: true });
      }
      break;

    case 'placeholder':
      if (hasWildcard(parsed.value)) {
        locator = page.getByPlaceholder(wildcardToRegex(parsed.value));
      } else {
        locator = page.getByPlaceholder(parsed.value, { exact: true });
      }
      break;

    case 'testid':
      if (hasWildcard(parsed.value)) {
        locator = page.getByTestId(wildcardToRegex(parsed.value));
      } else {
        locator = page.getByTestId(parsed.value);
      }
      break;

    case 'title':
      if (hasWildcard(parsed.value)) {
        locator = page.getByTitle(wildcardToRegex(parsed.value));
      } else {
        locator = page.getByTitle(parsed.value, { exact: true });
      }
      break;

    case 'alt':
      if (hasWildcard(parsed.value)) {
        locator = page.getByAltText(wildcardToRegex(parsed.value));
      } else {
        locator = page.getByAltText(parsed.value, { exact: true });
      }
      break;

    case 'role': {
      if (parsed.roleName) {
        const nameOpt = hasWildcard(parsed.roleName)
          ? wildcardToRegex(parsed.roleName)
          : parsed.roleName;
        locator = page.getByRole(parsed.value as Parameters<typeof page.getByRole>[0], { name: nameOpt });
      } else {
        locator = page.getByRole(parsed.value as Parameters<typeof page.getByRole>[0]);
      }
      break;
    }

    case 'xpath':
      locator = page.locator(`xpath=${parsed.value}`);
      break;

    case 'css':
      locator = page.locator(parsed.value);
      break;

    case 'alias': {
      const registry = getDefaultRegistry();
      const aliasLocator = registry.resolve(parsed.value);
      if (!aliasLocator) {
        throw new Error(`Unknown element alias: @${parsed.value}`);
      }
      // 递归解析别名对应的定位器
      return resolveLocator(page, parseLocator(aliasLocator));
    }

    default:
      throw new Error(`Unknown locator type: ${(parsed as ParsedLocator).type}`);
  }

  // ── 默认过滤不可见元素（解决 SPA 页面切换过渡期残留 DOM 问题）──
  locator = locator.filter({ visible: true });

  // ── 应用修饰符 ──
  if (parsed.modifier) {
    const mod = parsed.modifier;
    if (mod.last) {
      locator = locator.last();
    } else if (typeof mod.index === 'number') {
      locator = locator.nth(mod.index);
    } else if (mod.tag) {
      // 限定 DOM 标签
      locator = page.locator(mod.tag).filter({ has: locator });
    }
  }

  return locator;
}

// ── 从原始字符串（可能带引号）直接解析并返回 Locator ──────────────
export function resolveLocatorFromString(page: Page, raw: string): Locator {
  return resolveLocator(page, parseLocator(raw.trim()));
}

/**
 * input 命令专用定位：无前缀时按 label → placeholder 顺序尝试
 * 有前缀时走标准解析
 * 支持索引修饰符：/0  /-1  /2 等
 */
export function resolveInputLocator(page: Page, raw: string): Locator {
  const parsed = parseLocator(raw.trim());

  // 如果是有特殊前缀或自动识别的表单标签，直接走标准解析
  if (parsed.type !== 'text') {
    return resolveLocator(page, parsed);
  }

  // 无前缀：placeholder → label（大多数表单用 placeholder，优先匹配）
  const textVal = parsed.value;
  const placeholderLoc = page.getByPlaceholder(textVal, { exact: true });
  const labelLoc = page.getByLabel(textVal, { exact: true });
  let locator = placeholderLoc.or(labelLoc).filter({ visible: true });

  // 应用修饰符（如索引）
  if (parsed.modifier) {
    const mod = parsed.modifier;
    if (mod.last) {
      locator = locator.last();
    } else if (typeof mod.index === 'number') {
      locator = locator.nth(mod.index);
    }
  }

  return locator;
}

// ── 工具函数 ─────────────────────────────────────────────────

export { stripQuotes };

function hasWildcard(s: string): boolean {
  return s.includes('*');
}

function wildcardToRegex(s: string): RegExp {
  const escaped = escapeRegex(s);
  const regexStr = '^' + escaped.replace(/\\\*/g, '[\\s\\S]*') + '$';
  return new RegExp(regexStr);
}
