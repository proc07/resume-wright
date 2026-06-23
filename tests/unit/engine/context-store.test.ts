// ============================================================
// tests/unit/engine/context-store.test.ts
// ContextStore 单元测试
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextStore } from '../../../src/engine/context-store.js';

describe('ContextStore', () => {
  let ctx: ContextStore;

  beforeEach(() => {
    ctx = new ContextStore();
  });

  // ── 基础 set / get ────────────────────────────────────────

  describe('set / get', () => {
    it('设置和读取字符串值', () => {
      ctx.set('workflow_url', 'https://app.example.com/workflow/abc-123');
      expect(ctx.get('workflow_url')).toBe('https://app.example.com/workflow/abc-123');
    });

    it('设置和读取数字', () => {
      ctx.set('count', 42);
      expect(ctx.get('count')).toBe(42);
    });

    it('设置和读取对象', () => {
      ctx.set('res', { data: { status: 'pending', amount: 50000 } });
      expect(ctx.get('res')).toEqual({ data: { status: 'pending', amount: 50000 } });
    });

    it('读取不存在的键返回 undefined', () => {
      expect(ctx.get('nonexistent')).toBeUndefined();
    });

    it('覆盖已有值', () => {
      ctx.set('status', 'pending');
      ctx.set('status', 'approved');
      expect(ctx.get('status')).toBe('approved');
    });

    it('has() 检测键存在', () => {
      ctx.set('foo', 'bar');
      expect(ctx.has('foo')).toBe(true);
      expect(ctx.has('baz')).toBe(false);
    });
  });

  // ── 点号路径访问 ──────────────────────────────────────────

  describe('getPath()', () => {
    beforeEach(() => {
      ctx.set('res', {
        data: {
          status: 'manager_approved',
          amount: 50000,
          steps: [
            { role: 'manager', approved: true },
            { role: 'finance', approved: false },
          ],
          info: {
            creator: { name: '张三', id: 'u001' },
          },
        },
      });
    });

    it('访问一级字段', () => {
      expect(ctx.getPath('res')).toBeDefined();
    });

    it('访问深层嵌套字段', () => {
      expect(ctx.getPath('res.data.status')).toBe('manager_approved');
    });

    it('访问数字字段', () => {
      expect(ctx.getPath('res.data.amount')).toBe(50000);
    });

    it('访问数组下标 .0', () => {
      expect(ctx.getPath('res.data.steps.0.role')).toBe('manager');
    });

    it('访问数组下标 .1', () => {
      expect(ctx.getPath('res.data.steps.1.role')).toBe('finance');
    });

    it('访问三层嵌套', () => {
      expect(ctx.getPath('res.data.info.creator.name')).toBe('张三');
    });

    it('路径不存在返回 undefined', () => {
      expect(ctx.getPath('res.data.nonexistent')).toBeUndefined();
    });

    it('中间路径为 null 时返回 undefined', () => {
      ctx.set('nullval', null);
      expect(ctx.getPath('nullval.child')).toBeUndefined();
    });

    it('顶层不存在时返回 undefined', () => {
      expect(ctx.getPath('ghost.field')).toBeUndefined();
    });
  });

  // ── 序列化 / 反序列化 ─────────────────────────────────────

  describe('toJSON / fromJSON', () => {
    it('toJSON 导出所有变量', () => {
      ctx.set('url', 'https://example.com');
      ctx.set('id', 'abc-123');
      const json = ctx.toJSON();
      expect(json).toEqual({ url: 'https://example.com', id: 'abc-123' });
    });

    it('fromJSON 导入并覆盖', () => {
      ctx.set('old', 'value');
      ctx.fromJSON({ url: 'https://new.com', status: 'pending' });
      expect(ctx.get('url')).toBe('https://new.com');
      expect(ctx.get('old')).toBeUndefined(); // 清空后重载
    });

    it('空 Store 的 toJSON 返回空对象', () => {
      expect(ctx.toJSON()).toEqual({});
    });
  });

  // ── merge ─────────────────────────────────────────────────

  describe('merge()', () => {
    it('合并新键', () => {
      ctx.set('a', 1);
      ctx.merge({ b: 2, c: 3 });
      expect(ctx.get('a')).toBe(1);
      expect(ctx.get('b')).toBe(2);
      expect(ctx.get('c')).toBe(3);
    });

    it('合并覆盖已有键', () => {
      ctx.set('status', 'old');
      ctx.merge({ status: 'new' });
      expect(ctx.get('status')).toBe('new');
    });
  });

  // ── keys / clear ──────────────────────────────────────────

  describe('keys / clear', () => {
    it('keys() 返回所有键名', () => {
      ctx.set('a', 1);
      ctx.set('b', 2);
      expect(ctx.keys().sort()).toEqual(['a', 'b']);
    });

    it('clear() 清空所有变量', () => {
      ctx.set('a', 1);
      ctx.clear();
      expect(ctx.keys()).toHaveLength(0);
    });
  });

  // ── 变动监听 ──────────────────────────────────────────────

  describe('onChange 变动监听', () => {
    it('在变量 set / merge / clear / fromJSON 时应该正确触发监听器', () => {
      let triggerCount = 0;
      let lastStore: ContextStore | null = null;

      const unsubscribe = ctx.onChange((store) => {
        triggerCount++;
        lastStore = store;
      });

      // 1. set 变动
      ctx.set('testKey', 'value1');
      expect(triggerCount).toBe(1);
      expect(lastStore).toBe(ctx);
      expect(ctx.get('testKey')).toBe('value1');

      // 2. merge 变动
      ctx.merge({ testKey2: 'value2', testKey3: 'value3' });
      expect(triggerCount).toBe(2);

      // 3. fromJSON 变动
      ctx.fromJSON({ newKey: 'newValue' });
      expect(triggerCount).toBe(3);
      expect(ctx.get('testKey')).toBeUndefined();
      expect(ctx.get('newKey')).toBe('newValue');

      // 4. clear 变动
      ctx.clear();
      expect(triggerCount).toBe(4);
      expect(ctx.keys()).toHaveLength(0);

      // 5. 取消监听
      unsubscribe();
      ctx.set('afterUnsubscribe', 'ignored');
      expect(triggerCount).toBe(4);
    });
  });
});
