// ============================================================
// tests/unit/dsl/interpolate.test.ts
// 变量插值与日期时间计算单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { interpolate } from '../../../src/dsl/executor.js';
import { ContextStore } from '../../../src/engine/context-store.js';

describe('DSL Interpolate', () => {
  const ctx = new ContextStore();
  ctx.set('username', 'test_user');
  ctx.set('invoice_url', 'http://127.0.0.1:61775/invoice/123');
  ctx.set('res', { data: { amount: 12580 } });

  it('支持无引号的简单变量替换', () => {
    expect(interpolate('$username', ctx)).toBe('test_user');
    expect(interpolate('$invoice_url', ctx)).toBe('http://127.0.0.1:61775/invoice/123');
    expect(interpolate('$res.data.amount', ctx)).toBe('12580');
  });

  it('支持带引号的简单变量替换', () => {
    expect(interpolate('"$username"', ctx)).toBe('"test_user"');
    expect(interpolate('"$invoice_url"', ctx)).toBe('"http://127.0.0.1:61775/invoice/123"');
    expect(interpolate('"$res.data.amount"', ctx)).toBe('"12580"');
  });

  it('支持在普通字符串中嵌入无引号/有引号变量', () => {
    expect(interpolate('hello $username!', ctx)).toBe('hello test_user!');
    expect(interpolate('url is: $invoice_url/detail', ctx)).toBe('url is: http://127.0.0.1:61775/invoice/123/detail');
  });

  describe('内置日期时间变量与动态格式控制', () => {
    const formatDate = (date: Date, formatStr: string): string => {
      const yyyy = date.getFullYear();
      const yy = String(yyyy).slice(-2);
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const m = String(date.getMonth() + 1);
      const dd = String(date.getDate()).padStart(2, '0');
      const d = String(date.getDate());
      const hh = String(date.getHours()).padStart(2, '0');
      const h = String(date.getHours());
      const min = String(date.getMinutes()).padStart(2, '0');
      const minM = String(date.getMinutes());
      const ss = String(date.getSeconds()).padStart(2, '0');
      const s = String(date.getSeconds());

      return formatStr
        .replace(/YYYY/g, String(yyyy))
        .replace(/YY/g, yy)
        .replace(/MM/g, mm)
        .replace(/M/g, m)
        .replace(/DD/g, dd)
        .replace(/D/g, d)
        .replace(/HH/g, hh)
        .replace(/H/g, h)
        .replace(/mm/g, min)
        .replace(/m/g, minM)
        .replace(/ss/g, ss)
        .replace(/s/g, s);
    };

    it('默认输出格式', () => {
      const now = new Date();
      const expectedDate = formatDate(now, 'YYYY-MM-DD');
      const expectedDateTime = formatDate(now, 'YYYY-MM-DD HH:mm:ss');

      const testCtx = new ContextStore();
      expect(interpolate('$today', testCtx)).toBe(expectedDate);
      expect(interpolate('$date', testCtx)).toBe(expectedDate);
      expect(interpolate('$now', testCtx)).toBe(expectedDateTime);
    });

    it('支持偏移计算 (+n天, -n月, +n年 等)', () => {
      const testCtx = new ContextStore();
      
      const t3 = new Date();
      t3.setDate(t3.getDate() + 3);
      expect(interpolate('$today+3d', testCtx)).toBe(formatDate(t3, 'YYYY-MM-DD'));

      const tMinus2M = new Date();
      tMinus2M.setMonth(tMinus2M.getMonth() - 2);
      expect(interpolate('$today-2M', testCtx)).toBe(formatDate(tMinus2M, 'YYYY-MM-DD'));

      const tPlus1y = new Date();
      tPlus1y.setFullYear(tPlus1y.getFullYear() + 1);
      expect(interpolate('$today+1y', testCtx)).toBe(formatDate(tPlus1y, 'YYYY-MM-DD'));

      const tHourPlus1 = new Date();
      tHourPlus1.setHours(tHourPlus1.getHours() + 1);
      expect(interpolate('$now+1h', testCtx)).toBe(formatDate(tHourPlus1, 'YYYY-MM-DD HH:mm:ss'));
    });

    it('通过 date_format 和 datetime_format 动态控制格式', () => {
      const testCtx = new ContextStore();

      // 1. 设置日期格式为斜杠格式
      testCtx.set('date_format', 'YYYY/MM/DD');
      const now = new Date();
      expect(interpolate('$today', testCtx)).toBe(formatDate(now, 'YYYY/MM/DD'));

      const t3 = new Date();
      t3.setDate(t3.getDate() + 3);
      expect(interpolate('$today+3d', testCtx)).toBe(formatDate(t3, 'YYYY/MM/DD'));

      // 2. 更改为纯数字紧凑格式
      testCtx.set('date_format', 'YYYYMMDD');
      expect(interpolate('$today', testCtx)).toBe(formatDate(now, 'YYYYMMDD'));
      expect(interpolate('$today+3d', testCtx)).toBe(formatDate(t3, 'YYYYMMDD'));

      // 3. 设置时间格式
      testCtx.set('datetime_format', 'YYYY-MM-DD HH:mm');
      expect(interpolate('$now', testCtx)).toBe(formatDate(now, 'YYYY-MM-DD HH:mm'));

      const tMinus15m = new Date();
      tMinus15m.setMinutes(tMinus15m.getMinutes() - 15);
      expect(interpolate('$now-15m', testCtx)).toBe(formatDate(tMinus15m, 'YYYY-MM-DD HH:mm'));
    });

    it('避免与以内置变量名为前缀的自定义变量冲突', () => {
      const testCtx = new ContextStore();
      testCtx.set('today_active', 'custom_value');
      expect(interpolate('$today_active', testCtx)).toBe('custom_value');
    });
  });
});
