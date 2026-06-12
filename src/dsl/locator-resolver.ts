// ============================================================
// locator-resolver.ts — 元素定位解析（前缀自动识别）
// ============================================================

import type { Page, Locator } from '@playwright/test';
import type { ParsedLocator, LocatorModifier } from '../types/dsl.types.js';
import { getDefaultRegistry } from '../adapters/elements-csv.js';
import { stripQuotes, escapeRegex } from '../utils.js';

// ── 解析原始定位字符串 ──────────────────────────────────────

/**
 * 解析原始定位字符串为结构化的 ParsedLocator
 * 支持文本修饰符：/0  /-1  /tagName
 */
export function parseLocator(raw: string): ParsedLocator {
  let str = raw.trim();

  // ── 提取尾部修饰符 (/0, /-1, /button 等) ──
  const modMatch = str.match(/^(.*?)\/(-?\d+|[a-zA-Z]+)$/);
  let modifier: LocatorModifier | undefined;

  if (modMatch) {
    const modPart = modMatch[2]!;
    str = modMatch[1]!.trim();

    if (/^-?\d+$/.test(modPart)) {
      const idx = parseInt(modPart, 10);
      modifier = idx === -1 ? { last: true } : { index: idx };
    } else {
      modifier = { tag: modPart };
    }
  }

  // ── alias: @别名 ──
  if (str.startsWith('@')) {
    return { type: 'alias', value: str.slice(1), modifier, raw };
  }

  // ── xpath: // 开头 ──
  if (str.startsWith('//')) {
    return { type: 'xpath', value: str, modifier, raw };
  }

  // ── css: . 或 # 开头 ──
  if (str.startsWith('.') || str.startsWith('#')) {
    return { type: 'css', value: str, modifier, raw };
  }

  // ── label: 前缀 ──
  if (str.startsWith('label:')) {
    return { type: 'label', value: str.slice(6), modifier, raw };
  }

  // ── placeholder: 前缀 ──
  if (str.startsWith('placeholder:')) {
    return { type: 'placeholder', value: str.slice(12), modifier, raw };
  }

  // ── testid: 前缀 ──
  if (str.startsWith('testid:')) {
    return { type: 'testid', value: str.slice(7), modifier, raw };
  }

  // ── title: 前缀 ──
  if (str.startsWith('title:')) {
    return { type: 'title', value: str.slice(6), modifier, raw };
  }

  // ── alt: 前缀 ──
  if (str.startsWith('alt:')) {
    return { type: 'alt', value: str.slice(4), modifier, raw };
  }

  // ── role: 前缀，格式 role:button[确认] ──
  if (str.startsWith('role:')) {
    const roleStr = str.slice(5);
    const roleMatch = roleStr.match(/^([a-zA-Z]+)\[(.+)\]$/);
    if (roleMatch) {
      return {
        type: 'role',
        value: roleMatch[1]!,
        roleName: roleMatch[2]!,
        modifier,
        raw,
      };
    }
    return { type: 'role', value: roleStr, modifier, raw };
  }

  // ── *text* 包含匹配 ──
  if (str.startsWith('*') && str.endsWith('*') && str.length > 2) {
    return { type: 'text_contains', value: str.slice(1, -1), modifier, raw };
  }

  // ── A|B OR 匹配 ──
  if (str.includes('|')) {
    return { type: 'text_or', value: str, modifier, raw };
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
  const cleaned = stripQuotes(raw);
  return resolveLocator(page, parseLocator(cleaned));
}

/**
 * input 命令专用定位：无前缀时按 label → placeholder 顺序尝试
 * 有前缀时走标准解析
 * 支持索引修饰符：/0  /-1  /2 等
 */
export function resolveInputLocator(page: Page, raw: string): Locator {
  const cleaned = stripQuotes(raw);

  // 检查是否有索引修饰符（/0, /-1, /2 等）
  const indexMatch = cleaned.match(/^(.+?)\s+\/(-?\d+)$/);
  if (indexMatch) {
    const baseLocator = indexMatch[1]!;
    const index = parseInt(indexMatch[2]!, 10);
    const parsed = parseLocator(baseLocator);

    // 先构建基础 locator
    let locator: Locator;
    if (parsed.type === 'text') {
      // 无前缀文字：placeholder → label
      const placeholderLoc = page.getByPlaceholder(parsed.value, { exact: true });
      const labelLoc = page.getByLabel(parsed.value, { exact: true });
      locator = placeholderLoc.or(labelLoc);
    } else {
      // 有前缀：走标准解析
      locator = resolveLocator(page, { ...parsed, modifier: undefined }); // 先不应用修饰符
    }

    // 应用索引修饰符
    if (index === -1) {
      return locator.last();
    }
    return locator.nth(index);
  }

  // 有明确前缀或特殊语法，走标准解析
  if (/^(label:|placeholder:|testid:|title:|alt:|role:|\.|#|\/\/|@|\*.*\*|.*\|)/.test(cleaned)) {
    return resolveLocatorFromString(page, cleaned);
  }

  // 无前缀：placeholder → label（大多数表单用 placeholder，优先匹配）
  const placeholderLoc = page.getByPlaceholder(cleaned, { exact: true });
  const labelLoc = page.getByLabel(cleaned, { exact: true });

  return placeholderLoc.or(labelLoc);
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
