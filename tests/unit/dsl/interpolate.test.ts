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
});
