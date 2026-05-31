// ============================================================
// context-store.ts — 跨角色变量系统
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

/**
 * ContextStore — 全局变量存储，支持跨步骤、跨角色访问
 *
 * 所有通过 DSL "$var = ..." 赋值的变量自动写入此 Store，
 * 并在每次 Step 完成后与 Checkpoint 同步持久化到磁盘。
 */
export class ContextStore {
  private store: Map<string, unknown> = new Map();

  constructor(
    /** 持久化文件路径（由 Checkpoint 管理，此处仅用于独立持久化需求） */
    private readonly persistPath?: string
  ) {}

  // ── 读取 ─────────────────────────────────────────────────

  /**
   * 获取顶层变量值
   */
  get(key: string): unknown {
    return this.store.get(key);
  }

  /**
   * 支持点号路径访问：getPath("res.data.steps.0.role")
   * 对应 DSL 中的 $res.data.steps.0.role
   */
  getPath(dotPath: string): unknown {
    const parts = dotPath.split('.');
    let current: unknown = this.store.get(parts[0]!);

    for (let i = 1; i < parts.length; i++) {
      if (current === null || current === undefined) return undefined;
      const key = parts[i]!;
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * 检查变量是否存在
   */
  has(key: string): boolean {
    return this.store.has(key);
  }

  // ── 写入 ─────────────────────────────────────────────────

  /**
   * 设置变量值（支持点号路径，但顶层 key 直接覆盖）
   */
  set(key: string, value: unknown): void {
    // 如果 key 包含点号，只取第一段作为顶层 key
    const topKey = key.split('.')[0]!;
    this.store.set(topKey, value);
  }

  /**
   * 批量合并（从 Checkpoint 恢复时使用）
   */
  merge(data: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(data)) {
      this.store.set(k, v);
    }
  }

  // ── 序列化 ───────────────────────────────────────────────

  /**
   * 将当前 Store 序列化为普通对象（用于持久化）
   */
  toJSON(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of this.store.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  /**
   * 从 JSON 对象恢复（Checkpoint 重启时调用）
   */
  fromJSON(data: Record<string, unknown>): void {
    this.store.clear();
    this.merge(data);
  }

  /**
   * 清空所有变量（测试用）
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * 返回所有变量键名
   */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  // ── 独立持久化（可选）───────────────────────────────────

  /**
   * 将 Store 独立写盘（通常由 Checkpoint 调用，无需手动调用）
   */
  persist(): void {
    if (!this.persistPath) return;
    fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
    fs.writeFileSync(this.persistPath, JSON.stringify(this.toJSON(), null, 2), 'utf-8');
  }

  /**
   * 从磁盘加载（独立模式下使用）
   */
  loadFromDisk(): void {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
    const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));
    this.fromJSON(data);
  }
}
