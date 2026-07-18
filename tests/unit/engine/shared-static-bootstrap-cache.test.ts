// ============================================================
// tests/unit/engine/shared-static-bootstrap-cache.test.ts
// SharedStaticBootstrapCache 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SharedStaticBootstrapCache } from '../../../src/engine/network-interceptor.js';
import type { Page, Route, Request } from '@playwright/test';

function createMockRequest(options: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
}): Request {
  const urlValue = options.url || 'https://example.com/api/config';
  const methodValue = options.method || 'GET';
  const headersValue = options.headers || {};
  return {
    url: () => urlValue,
    method: () => methodValue,
    headers: () => headersValue,
  } as unknown as Request;
}

function createMockRoute(response?: {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}): Route {
  const statusValue = response?.status ?? 200;
  const headersValue = response?.headers ?? { 'content-type': 'application/json' };
  const bodyValue = response?.body ?? '{"success":true}';

  const mockResponse = {
    status: () => statusValue,
    headers: () => headersValue,
    text: vi.fn().mockResolvedValue(bodyValue),
  };

  return {
    fulfill: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue(mockResponse),
  } as unknown as Route;
}

describe('SharedStaticBootstrapCache', () => {
  let tmpDir: string;
  let cacheFilePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-test-shared-cache-'));
    cacheFilePath = path.join(tmpDir, 'shared-api-cache.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('URL 匹配机制', () => {
    it('应该只匹配符合包含规则且不符合排除规则的相同源 GET/HEAD 请求', () => {
      const cache = new SharedStaticBootstrapCache({
        cacheFilePath,
        baseUrl: 'https://example.com',
        include: ['/api/static/*', '/assets/**'],
        exclude: ['/api/static/private'],
        readCache: false,
        captureRunId: 'test-run',
      });

      expect(cache.matches('GET', 'https://example.com/api/static/config')).toBe(true);
      expect(cache.matches('HEAD', 'https://example.com/assets/logo.png')).toBe(true);
      expect(cache.matches('POST', 'https://example.com/api/static/config')).toBe(false); // POST 拒绝
      expect(cache.matches('GET', 'https://example.com/api/static/private')).toBe(false); // 被 exclude 排除
      expect(cache.matches('GET', 'https://other.com/api/static/config')).toBe(false); // 源不匹配
    });
  });

  describe('请求处理机制', () => {
    it('在 Capture 模式下，第一次请求应该触发网络 fetch 并缓存，第二次请求应该命中缓存', async () => {
      const cache = new SharedStaticBootstrapCache({
        cacheFilePath,
        baseUrl: 'https://example.com',
        include: ['/api/*'],
        readCache: false,
        captureRunId: 'test-run',
      });

      const route1 = createMockRoute({ body: '{"data":1}' });
      const request1 = createMockRequest({ url: 'https://example.com/api/data' });

      // 第一次：Capture
      const result1 = await cache.handle(route1, request1, 'role-A');
      expect(result1.handled).toBe(true);
      expect(route1.fetch).toHaveBeenCalled();
      expect(route1.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({
          body: '{"data":1}',
        })
      );

      // 第二次：Replay
      const route2 = createMockRoute();
      const request2 = createMockRequest({ url: 'https://example.com/api/data' });
      const result2 = await cache.handle(route2, request2, 'role-A');
      expect(result2.handled).toBe(true);
      expect(route2.fetch).not.toHaveBeenCalled();
      expect(route2.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({
          body: '{"data":1}',
        })
      );
    });

    it('如果接口返回敏感头部 (set-cookie)，应该判定为非共享响应，并沉降为 role-only', async () => {
      const cache = new SharedStaticBootstrapCache({
        cacheFilePath,
        baseUrl: 'https://example.com',
        include: ['/api/*'],
        readCache: false,
        captureRunId: 'test-run',
      });

      const route = createMockRoute({
        headers: { 'set-cookie': 'session=abc' },
        body: '{"sensitive":true}',
      });
      const request = createMockRequest({ url: 'https://example.com/api/user' });

      const result = await cache.handle(route, request, 'role-A');
      expect(result.handled).toBe(false); // 不被共享缓存接管
      expect(result.prefetchedResponse).toBeDefined();

      // 验证生成了 role-only.json
      const roleOnlyPath = path.join(tmpDir, 'role-only.json');
      expect(fs.existsSync(roleOnlyPath)).toBe(true);
    });
  });
});
