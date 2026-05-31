// ============================================================
// elements-csv.ts — DOM 元素别名管理（elements.csv）
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

export interface ElementAlias {
  name: string;
  locator: string;
}

/**
 * ElementsRegistry — 加载并缓存 elements.csv 中的所有别名
 */
export class ElementsRegistry {
  private aliases: Map<string, string> = new Map();
  private loaded = false;

  constructor(private readonly csvPath: string) {}

  /**
   * 加载 CSV 文件（幂等，仅首次加载）
   */
  load(): void {
    if (this.loaded) return;

    if (!fs.existsSync(this.csvPath)) {
      // CSV 不存在时静默跳过（非必须文件）
      this.loaded = true;
      return;
    }

    const raw = fs.readFileSync(this.csvPath, 'utf-8');
    const records = parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string>>;

    for (const row of records) {
      const name = (row['name'] ?? row['Name'] ?? '').trim();
      const locator = (row['locator'] ?? row['Locator'] ?? '').trim();
      if (name && locator) {
        this.aliases.set(name, locator);
      }
    }

    this.loaded = true;
    console.log(
      `[elements-csv] Loaded ${this.aliases.size} aliases from ${this.csvPath}`
    );
  }

  /**
   * 查询别名对应的定位器字符串
   * @param name 别名（@符号已被调用方去除）
   * @returns 定位器字符串，或 undefined
   */
  resolve(name: string): string | undefined {
    if (!this.loaded) this.load();
    return this.aliases.get(name);
  }

  /**
   * 返回所有别名（用于调试）
   */
  all(): ElementAlias[] {
    if (!this.loaded) this.load();
    return Array.from(this.aliases.entries()).map(([name, locator]) => ({
      name,
      locator,
    }));
  }
}

/** 全局默认 Registry（使用 config/elements.csv） */
let _defaultRegistry: ElementsRegistry | null = null;

export function getDefaultRegistry(projectRoot = process.cwd()): ElementsRegistry {
  if (!_defaultRegistry) {
    const csvPath = path.join(projectRoot, 'config', 'elements.csv');
    _defaultRegistry = new ElementsRegistry(csvPath);
    _defaultRegistry.load();
  }
  return _defaultRegistry;
}
