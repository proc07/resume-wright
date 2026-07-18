// ============================================================
// tests/unit/engine/network-interceptor.test.ts
// NetworkInterceptor 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NetworkInterceptor } from '../../../src/engine/network-interceptor.js';
import type { Page, Route, Request } from '@playwright/test';
import type { ApiCacheEntry } from '../../../src/types/engine.types.js';

// ── Mock 工厂 ─────────────────────────────────────────────────

function createMockPage(): Page {
  const routes: Array<{ pattern: string; handler: (route: Route, request: Request) => Promise<void> }> = [];

  return {
    route: vi.fn(async (pattern: string, handler: (route: Route, request: Request) => Promise<void>) => {
      routes.push({ pattern, handler });
    }),
    unroute: vi.fn(async () => {}),
    __routes: routes,
  } as unknown as Page;
}

function createMockRequest(options: {
  url?: string;
  method?: string;
  resourceType?: string;
  postData?: string | null;
}): Request {
  const urlValue = options.url || 'https://api.example.com/users';
  const resourceTypeValue = options.resourceType || 'xhr';
  const methodValue = options.method || 'POST';
  const postDataValue = options.postData !== undefined ? options.postData : null;
  return {
    url: () => urlValue,
    method: () => methodValue,
    resourceType: () => resourceTypeValue,
    postData: () => postDataValue,
  } as unknown as Request;
}

function createMockRoute(response?: {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}): { route: Route; fulfillMock: ReturnType<typeof vi.fn>; fetchMock: ReturnType<typeof vi.fn>; continueMock: ReturnType<typeof vi.fn> } {
  const fulfillMock = vi.fn();
  const continueMock = vi.fn();
  const fetchMock = vi.fn();

  const statusValue = response?.status ?? 200;
  const headersValue = response?.headers ?? { 'content-type': 'application/json' };
  const bodyValue = response?.body ?? '{"success":true}';

  const mockResponse = {
    status: () => statusValue,
    headers: () => headersValue,
    text: vi.fn().mockResolvedValue(bodyValue),
  };

  fetchMock.mockResolvedValue(mockResponse);

  return {
    route: {
      fulfill: fulfillMock,
      continue: continueMock,
      fetch: fetchMock,
    } as unknown as Route,
    fulfillMock,
    fetchMock,
    continueMock,
  };
}

// ── 测试套件 ─────────────────────────────────────────────────

describe('NetworkInterceptor', () => {
  let tmpDir: string;
  let cacheFilePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-test-interceptor-'));
    cacheFilePath = path.join(tmpDir, 'api-cache.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 基础功能测试 ─────────────────────────────────────────

  describe('基础功能', () => {
    it('应该正确加载已有缓存文件', () => {
      const existingCache: ApiCacheEntry[] = [
        {
          fingerprint: 'abc123',
          method: 'POST',
          url: '/api/users',
          status: 200,
          headers: {},
          body: '{"id":1}',
          cachedAt: new Date().toISOString(),
          subStepId: 'step-1',
        },
      ];
      fs.writeFileSync(cacheFilePath, JSON.stringify(existingCache, null, 2));

      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);

      expect(interceptor.getCacheSize()).toBe(1);
    });

    it('应该在挂载时拦截所有请求', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);

      await interceptor.attach();

      expect(page.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    });
  });

  // ── 请求类型过滤测试 ─────────────────────────────────────

  describe('请求类型过滤', () => {
    it('应该放行静态资源请求', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const staticTypes = ['image', 'stylesheet', 'script', 'font', 'document', 'media'];
      for (const type of staticTypes) {
        const { route, continueMock } = createMockRoute();
        const request = createMockRequest({ resourceType: type });
        await handler(route, request);
        expect(continueMock).toHaveBeenCalled();
      }
    });

    it('应该拦截 xhr 和 fetch 请求', async () => {
      // 分别测试 xhr 和 fetch 类型
      const apiTypes = ['xhr', 'fetch'];

      for (const type of apiTypes) {
        // 每种类型使用独立的 interceptor 和缓存文件
        const typeCachePath = path.join(tmpDir, `api-cache-${type}.json`);
        const page = createMockPage();
        const interceptor = new NetworkInterceptor(page, typeCachePath);
        await interceptor.attach();

        const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

        const { route, fetchMock } = createMockRoute();
        const request = createMockRequest({ resourceType: type, method: 'POST' });
        await handler(route, request);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    });
  });

  // ── HTTP 方法过滤测试 ─────────────────────────────────────

  describe('HTTP 方法过滤', () => {
    it('应该缓存非幂等请求 (POST/PUT/DELETE/PATCH)', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const nonIdempotentMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
      for (const method of nonIdempotentMethods) {
        const { route, fetchMock } = createMockRoute();
        const request = createMockRequest({ method });
        await handler(route, request);
        expect(fetchMock).toHaveBeenCalled();
      }
    });

    it('默认情况下应该放行 GET 请求', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const { route, continueMock, fetchMock } = createMockRoute();
      const request = createMockRequest({ method: 'GET' });
      await handler(route, request);

      expect(continueMock).toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('开启 cacheGet 时应该缓存 GET 请求', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath, { cacheGet: true });
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const { route, fetchMock } = createMockRoute();
      const request = createMockRequest({ method: 'GET' });
      await handler(route, request);

      expect(fetchMock).toHaveBeenCalled();
    });
  });

  // ── 指纹生成与 URL 归一化测试 ─────────────────────────────

  describe('指纹生成', () => {
    it('应该忽略 URL 中的时间戳参数', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // 第一次请求：带 _t 参数
      const { route: route1, fetchMock: fetchMock1, fulfillMock: fulfillMock1 } = createMockRoute({ status: 200 });
      const request1 = createMockRequest({
        url: 'https://api.example.com/data?_t=1234567890',
        method: 'POST',
      });
      await handler(route1, request1);

      // 第二次请求：不同的 _t 参数，相同的基础 URL
      const { route: route2, fulfillMock: fulfillMock2 } = createMockRoute({ status: 200 });
      const request2 = createMockRequest({
        url: 'https://api.example.com/data?_t=9999999999',
        method: 'POST',
      });
      await handler(route2, request2);

      // 第二次应该命中缓存，不再调用 fetch
      expect(fetchMock1).toHaveBeenCalledTimes(1);
      expect(fulfillMock1).toHaveBeenCalled();
      expect(fulfillMock2).toHaveBeenCalled();
    });

    it('应该忽略多种时间戳/随机参数', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const timestampParams = ['t', 'timestamp', '_t', 'ts', '_', 'cb', 'cacheBust', 'random', 'rand', '_r', 'v', '_v'];
      const fetchMocks: ReturnType<typeof vi.fn>[] = [];

      for (const param of timestampParams) {
        const { route, fetchMock } = createMockRoute();
        fetchMocks.push(fetchMock);
        const request = createMockRequest({
          url: `https://api.example.com/data?${param}=abc123`,
          method: 'POST',
        });
        await handler(route, request);
        // 每个参数都应该生成相同的指纹，只有第一个会真正调用 fetch
      }

      // 只有第一次会调用 fetch，后续都命中缓存
      expect(fetchMocks[0]).toHaveBeenCalledTimes(1);
      // 后续的 fetchMock 不应该被调用（因为命中缓存后直接 fulfill，不会调用 fetch）
      for (let i = 1; i < fetchMocks.length; i++) {
        expect(fetchMocks[i]).not.toHaveBeenCalled();
      }
    });

    it('应该保持其他查询参数不变（不同参数产生不同指纹）', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath, { cacheGet: true });
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // 第一次请求：page=1
      const { route: route1, fetchMock: fetchMock1 } = createMockRoute({ status: 200, body: '{"page":1}' });
      const request1 = createMockRequest({
        url: 'https://api.example.com/users?page=1&limit=10',
        method: 'GET',
      });
      await handler(route1, request1);

      // 第二次请求：page=2（不同参数，应该生成不同指纹）
      const { route: route2, fetchMock: fetchMock2 } = createMockRoute({ status: 200, body: '{"page":2}' });
      const request2 = createMockRequest({
        url: 'https://api.example.com/users?page=2&limit=10',
        method: 'GET',
      });
      await handler(route2, request2);

      // 两次都应该真正发送（不同的指纹）
      expect(fetchMock1).toHaveBeenCalledTimes(1);
      expect(fetchMock2).toHaveBeenCalledTimes(1);
    });
  });

  // ── POST Body 归一化测试 ─────────────────────────────────

  describe('POST Body 归一化', () => {
    it('应该忽略 JSON body 中的时间戳字段', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // 第一次请求：带 timestamp 字段
      const { route: route1, fetchMock } = createMockRoute({ status: 200 });
      const body1 = JSON.stringify({ name: 'test', timestamp: '1234567890', requestId: 'req-001' });
      const request1 = createMockRequest({ method: 'POST', postData: body1 });
      await handler(route1, request1);

      // 第二次请求：不同的 timestamp 和 requestId，相同的核心数据
      const { route: route2, fulfillMock } = createMockRoute({ status: 200 });
      const body2 = JSON.stringify({ name: 'test', timestamp: '9999999999', requestId: 'req-002' });
      const request2 = createMockRequest({ method: 'POST', postData: body2 });
      await handler(route2, request2);

      // 第二次应该命中缓存
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fulfillMock).toHaveBeenCalled();
    });

    it('应该忽略多种动态字段', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const dynamicFields = ['timestamp', 'requestId', 'nonce', '_', 't', 'random', 'rand', 'ts', '_t', 'requestIdempotencyKey'];

      const baseData = { action: 'create', data: { id: 123 } };
      const fetchMocks: ReturnType<typeof vi.fn>[] = [];

      for (const field of dynamicFields) {
        const body = JSON.stringify({ ...baseData, [field]: `dynamic-value-${Math.random()}` });
        const { route, fetchMock } = createMockRoute();
        fetchMocks.push(fetchMock);
        const request = createMockRequest({ method: 'POST', postData: body });
        await handler(route, request);
      }

      // 所有请求都应该命中缓存（只有第一次真正发送）
      expect(fetchMocks[0]).toHaveBeenCalledTimes(1);
      // 后续的 fetchMock 不应该被调用
      for (let i = 1; i < fetchMocks.length; i++) {
        expect(fetchMocks[i]).not.toHaveBeenCalled();
      }
    });

    it('不同 body 核心数据在 capture/replay 模式下可以通过 occurrence 顺序匹配进行区分', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath, { readCache: false });
      await interceptor.attach();
      interceptor.beginScopeAttempt('step-1');

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // 第一次请求：name = 'alice'
      const { route: route1, fetchMock: fetchMock1 } = createMockRoute({ status: 200, body: '{"res":"alice"}' });
      const body1 = JSON.stringify({ name: 'alice' });
      const request1 = createMockRequest({ method: 'POST', postData: body1 });
      await handler(route1, request1);

      // 第二次请求：name = 'bob'
      const { route: route2, fetchMock: fetchMock2 } = createMockRoute({ status: 200, body: '{"res":"bob"}' });
      const body2 = JSON.stringify({ name: 'bob' });
      const request2 = createMockRequest({ method: 'POST', postData: body2 });
      await handler(route2, request2);

      expect(fetchMock1).toHaveBeenCalledTimes(1);
      expect(fetchMock2).toHaveBeenCalledTimes(1);

      // 切换回放模式测试有序回放
      await interceptor.completeScopeAttempt();
      await interceptor.detach();

      const replayInterceptor = new NetworkInterceptor(page, cacheFilePath, { readCache: true });
      await replayInterceptor.attach();
      replayInterceptor.beginScopeAttempt('step-1');
      const replayHandler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)[1];

      const { route: rRoute1, fulfillMock: fulfillMock1, fetchMock: rFetchMock1 } = createMockRoute({ status: 200, body: '{"res":"alice"}' });
      await replayHandler(rRoute1, request1);
      expect(fulfillMock1).toHaveBeenCalledWith(expect.objectContaining({ body: '{"res":"alice"}' }));
      expect(rFetchMock1).not.toHaveBeenCalled();

      const { route: rRoute2, fulfillMock: fulfillMock2, fetchMock: rFetchMock2 } = createMockRoute({ status: 200, body: '{"res":"bob"}' });
      await replayHandler(rRoute2, request2);
      expect(fulfillMock2).toHaveBeenCalledWith(expect.objectContaining({ body: '{"res":"bob"}' }));
      expect(rFetchMock2).not.toHaveBeenCalled();
    });
  });

  // ── 请求计数机制测试 ─────────────────────────────────────

  describe('请求计数机制', () => {
    it('同一 subStep 内多次调用同一 API 应按顺序返回缓存', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // 设置当前子步骤
      interceptor.activeSubStepId = 'step-1';

      // 第一次调用（cache miss，真正发送请求）
      const { route: route1, fulfillMock: fulfill1 } = createMockRoute({ status: 200, body: '{"call":1}' });
      const request = createMockRequest({ method: 'POST', postData: '{"action":"get"}' });
      await handler(route1, request);

      // 第二次调用（相同请求，应该命中缓存）
      const { route: route2, fulfillMock: fulfill2 } = createMockRoute({ status: 200, body: '{"call":2}' });
      await handler(route2, request);

      // 第三次调用（相同请求，应该命中缓存）
      const { route: route3, fulfillMock: fulfill3 } = createMockRoute({ status: 200, body: '{"call":3}' });
      await handler(route3, request);

      // 验证缓存内容
      expect(interceptor.getCacheSize()).toBe(1); // 只有一个缓存条目

      // 第一次调用是真正的请求，使用 route.fulfill({response, body}) 格式
      expect(fulfill1).toHaveBeenCalledTimes(1);

      // 第二、三次调用命中缓存，使用 route.fulfill({status, headers, body}) 格式
      expect(fulfill2).toHaveBeenCalledWith(
        expect.objectContaining({ status: 200 })
      );
      expect(fulfill3).toHaveBeenCalledWith(
        expect.objectContaining({ status: 200 })
      );
    });

    it('切换 subStep 后应该重新开始计数', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const request = createMockRequest({ method: 'POST', postData: '{"action":"submit"}' });

      // Step-1: 第一次调用
      interceptor.activeSubStepId = 'step-1';
      const { route: route1 } = createMockRoute({ status: 200, body: '{"step":"1"}' });
      await handler(route1, request);

      // Step-2: 重置计数后调用
      interceptor.activeSubStepId = 'step-2';
      interceptor.resetCounts();
      const { route: route2, fulfillMock } = createMockRoute({ status: 200, body: '{"step":"2"}' });
      await handler(route2, request);

      // 应该有 2 个缓存条目（不同 subStep）
      expect(interceptor.getCacheSize()).toBe(2);
    });

    it('应该正确处理多个不同的 API 端点', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      interceptor.activeSubStepId = 'step-1';

      // API 1: /users (使用 POST 以便缓存)
      const { route: route1 } = createMockRoute({ status: 200, body: '{"users":[]}' });
      const request1 = createMockRequest({ url: 'https://api.example.com/users', method: 'POST' });
      await handler(route1, request1);

      // API 2: /orders (使用 POST 以便缓存)
      const { route: route2 } = createMockRoute({ status: 200, body: '{"orders":[]}' });
      const request2 = createMockRequest({ url: 'https://api.example.com/orders', method: 'POST' });
      await handler(route2, request2);

      // API 1 再次调用（应该命中缓存）
      const { route: route3 } = createMockRoute({ status: 200, body: '{"users":[]}' });
      await handler(route3, request1);

      // 应该有 2 个缓存条目
      expect(interceptor.getCacheSize()).toBe(2);
    });
  });

  // ── subStepId 隔离测试 ──────────────────────────────────

  describe('subStepId 隔离', () => {
    it('相同请求在不同 subStep 下应该有独立的缓存', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const request = createMockRequest({ method: 'POST', postData: '{"action":"process"}' });

      // Step-1: 第一次调用
      interceptor.activeSubStepId = 'step-1';
      const { route: route1 } = createMockRoute({ status: 200, body: '{"result":"step1"}' });
      await handler(route1, request);

      // Step-2: 相同请求，不同 subStep
      interceptor.activeSubStepId = 'step-2';
      interceptor.resetCounts();
      const { route: route2, fetchMock } = createMockRoute({ status: 200, body: '{"result":"step2"}' });
      await handler(route2, request);

      // 应该有 2 个缓存条目，且第二次应该真正发送
      expect(interceptor.getCacheSize()).toBe(2);
      expect(fetchMock).toHaveBeenCalled();
    });

    it('恢复执行时应该命中之前 subStep 的缓存', async () => {
      // 计算正确的 fingerprint: md5('POST|/api/submit|')
      const crypto = await import('node:crypto');
      const correctFingerprint = crypto.createHash('md5').update('POST|/api/submit|', 'utf-8').digest('hex');

      // 模拟恢复场景：加载已有缓存
      const existingCache: ApiCacheEntry[] = [
        {
          fingerprint: correctFingerprint,
          method: 'POST',
          url: '/api/submit',
          status: 200,
          headers: {},
          body: '{"cached":true}',
          cachedAt: new Date().toISOString(),
          subStepId: 'step-1',
        },
      ];
      fs.writeFileSync(cacheFilePath, JSON.stringify(existingCache, null, 2));

      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // 设置与缓存相同的 subStepId
      interceptor.activeSubStepId = 'step-1';

      // 发送相同请求（需要计算出相同的 fingerprint）
      const { route, fulfillMock, fetchMock } = createMockRoute();
      const request = createMockRequest({ url: 'https://api.example.com/api/submit', method: 'POST' });
      await handler(route, request);

      // 应该命中缓存，不调用 fetch
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fulfillMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 200 })
      );
    });
  });

  // ── 缓存持久化测试 ──────────────────────────────────────

  describe('缓存持久化', () => {
    it('应该将新缓存写入文件', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const { route } = createMockRoute({ status: 200 });
      const request = createMockRequest({ method: 'POST', postData: '{"test":true}' });
      await handler(route, request);

      // 验证文件已写入
      expect(fs.existsSync(cacheFilePath)).toBe(true);
      const savedCache = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8')) as ApiCacheEntry[];
      expect(savedCache).toHaveLength(1);
      expect(savedCache[0].body).toBe('{"success":true}');
    });

    it('只应该缓存 2xx 响应', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // 4xx 响应
      const { route: route1 } = createMockRoute({ status: 400 });
      const request = createMockRequest({ method: 'POST', postData: '{"test":true}' });
      await handler(route1, request);

      // 5xx 响应
      const { route: route2 } = createMockRoute({ status: 500 });
      await handler(route2, request);

      // 应该没有缓存
      expect(interceptor.getCacheSize()).toBe(0);
      expect(fs.existsSync(cacheFilePath)).toBe(false);
    });

    it('clearCache 应该清除所有缓存', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // 添加一些缓存
      const { route } = createMockRoute({ status: 200 });
      const request = createMockRequest({ method: 'POST' });
      await handler(route, request);

      expect(interceptor.getCacheSize()).toBe(1);

      // 清除缓存
      interceptor.clearCache();
      expect(interceptor.getCacheSize()).toBe(0);
      expect(fs.existsSync(cacheFilePath)).toBe(false);
    });
  });

  // ── 复杂场景测试 ─────────────────────────────────────────

  describe('复杂场景：多次重复接口请求', () => {
    it('场景：表单提交流程，包含多个相同API的重复调用', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      interceptor.activeSubStepId = 'form-submit';

      // 模拟场景：用户提交表单，前端会发送多次验证请求

      // 1. 验证用户名是否已存在
      const { route: route1, fulfillMock: fulfill1 } = createMockRoute({
        status: 200,
        body: '{"available":true}',
      });
      const checkUsernameReq = createMockRequest({
        url: 'https://api.example.com/check-username',
        method: 'POST',
        postData: JSON.stringify({ username: 'newuser', timestamp: '1000' }),
      });
      await handler(route1, checkUsernameReq);

      // 2. 验证邮箱是否已存在（不同参数）
      const { route: route2, fulfillMock: fulfill2 } = createMockRoute({
        status: 200,
        body: '{"available":true}',
      });
      const checkEmailReq = createMockRequest({
        url: 'https://api.example.com/check-email',
        method: 'POST',
        postData: JSON.stringify({ email: 'user@example.com', nonce: 'abc123' }),
      });
      await handler(route2, checkEmailReq);

      // 3. 再次验证用户名（前端防抖触发）
      const { route: route3, fulfillMock: fulfill3 } = createMockRoute({
        status: 200,
        body: '{"available":true}',
      });
      await handler(route3, checkUsernameReq);

      // 4. 提交表单
      const { route: route4, fulfillMock: fulfill4 } = createMockRoute({
        status: 200,
        body: '{"id":12345}',
      });
      const submitReq = createMockRequest({
        url: 'https://api.example.com/submit',
        method: 'POST',
        postData: JSON.stringify({
          username: 'newuser',
          email: 'user@example.com',
          timestamp: '2000',
          requestId: 'req-001',
        }),
      });
      await handler(route4, submitReq);

      // 5. 提交后获取详情（相同请求）
      const { route: route5, fulfillMock: fulfill5 } = createMockRoute({
        status: 200,
        body: '{"detail":{}}',
      });
      await handler(route5, submitReq);

      // 验证结果
      expect(interceptor.getCacheSize()).toBe(3); // check-username, check-email, submit
      expect(fulfill1).toHaveBeenCalled(); // check-username 第1次
      expect(fulfill3).toHaveBeenCalled(); // check-username 第2次（命中缓存）
      expect(fulfill4).toHaveBeenCalled(); // submit 第1次
      expect(fulfill5).toHaveBeenCalled(); // submit 第2次（命中缓存）
    });

    it('场景：分页列表查询，相同接口不同参数', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath, { cacheGet: true });
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      interceptor.activeSubStepId = 'pagination';

      // 第1页
      const { route: route1, fulfillMock: fulfill1 } = createMockRoute({
        status: 200,
        body: JSON.stringify({ data: [1, 2, 3], total: 10 }),
      });
      const page1Req = createMockRequest({
        url: 'https://api.example.com/list?page=1&limit=3',
        method: 'GET',
      });
      await handler(route1, page1Req);

      // 第2页（不同参数）
      const { route: route2, fulfillMock: fulfill2 } = createMockRoute({
        status: 200,
        body: JSON.stringify({ data: [4, 5, 6], total: 10 }),
      });
      const page2Req = createMockRequest({
        url: 'https://api.example.com/list?page=2&limit=3',
        method: 'GET',
      });
      await handler(route2, page2Req);

      // 第3页（不同参数）
      const { route: route3, fulfillMock: fulfill3 } = createMockRoute({
        status: 200,
        body: JSON.stringify({ data: [7, 8, 9], total: 10 }),
      });
      const page3Req = createMockRequest({
        url: 'https://api.example.com/list?page=3&limit=3',
        method: 'GET',
      });
      await handler(route3, page3Req);

      // 再次查询第1页（应该命中缓存）
      const { route: route4, fulfillMock: fulfill4 } = createMockRoute();
      await handler(route4, page1Req);

      // 验证结果
      expect(interceptor.getCacheSize()).toBe(3); // 3 个不同的分页请求
      expect(fulfill1).toHaveBeenCalled();
      expect(fulfill2).toHaveBeenCalled();
      expect(fulfill3).toHaveBeenCalled();
      expect(fulfill4).toHaveBeenCalled(); // 第4次命中缓存
    });

    it('场景：多步骤流程，每步都有独立的缓存', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const submitReq = createMockRequest({
        url: 'https://api.example.com/submit',
        method: 'POST',
        postData: JSON.stringify({ action: 'create' }),
      });

      // Step-1: 创建
      interceptor.activeSubStepId = 'step-1';
      interceptor.resetCounts();
      const { route: route1 } = createMockRoute({ status: 200, body: '{"id":1}' });
      await handler(route1, submitReq);

      // Step-2: 更新（相同请求）
      interceptor.activeSubStepId = 'step-2';
      interceptor.resetCounts();
      const { route: route2 } = createMockRoute({ status: 200, body: '{"id":1,"updated":true}' });
      await handler(route2, submitReq);

      // Step-3: 再次更新（相同请求）
      interceptor.activeSubStepId = 'step-3';
      interceptor.resetCounts();
      const { route: route3 } = createMockRoute({ status: 200, body: '{"id":1,"final":true}' });
      await handler(route3, submitReq);

      // Step-1 恢复执行时应该命中缓存
      interceptor.activeSubStepId = 'step-1';
      interceptor.resetCounts();
      const { route: route1恢复, fulfillMock } = createMockRoute();
      await handler(route1恢复, submitReq);

      // 验证：每个 step 有独立的缓存
      expect(interceptor.getCacheSize()).toBe(3);
      expect(fulfillMock).toHaveBeenCalled(); // 命中 step-1 的缓存
    });

    it('场景：带时间戳的批量请求，应该正确归一化', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      interceptor.activeSubStepId = 'batch';

      // 模拟批量 API 调用，每次请求的时间戳都不同
      const baseData = { items: [1, 2, 3] };
      const requests = Array.from({ length: 5 }, (_, i) => ({
        url: `https://api.example.com/batch?t=${Date.now() + i}`,
        method: 'POST',
        postData: JSON.stringify({
          ...baseData,
          timestamp: `ts-${i}`,
          requestId: `req-${i}`,
        }),
      }));

      for (const reqOpts of requests) {
        const { route, fulfillMock } = createMockRoute({ status: 200 });
        const request = createMockRequest(reqOpts);
        await handler(route, request);
        expect(fulfillMock).toHaveBeenCalled();
      }

      // 应该只有 1 个缓存条目（所有请求的指纹相同）
      expect(interceptor.getCacheSize()).toBe(1);
    });
  });

  // ── 边界情况测试 ─────────────────────────────────────────

  describe('边界情况', () => {
    it('应该处理空 body 的请求', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const { route, fulfillMock } = createMockRoute();
      const request = createMockRequest({ method: 'POST', postData: null });
      await handler(route, request);

      expect(fulfillMock).toHaveBeenCalled();
    });

    it('应该处理非 JSON body', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const { route, fulfillMock } = createMockRoute();
      const request = createMockRequest({
        method: 'POST',
        postData: 'plain text body',
      });
      await handler(route, request);

      expect(fulfillMock).toHaveBeenCalled();
    });

    it('应该处理无效 URL', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const { route, fulfillMock } = createMockRoute();
      const request = createMockRequest({
        url: 'not-a-valid-url',
        method: 'POST',
      });
      await handler(route, request);

      expect(fulfillMock).toHaveBeenCalled();
    });

    it('detach 后应该停止拦截', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();
      await interceptor.detach();

      expect(page.unroute).toHaveBeenCalledWith('**/*', expect.any(Function));
    });
  });

  // ── 防护与等待测试 ─────────────────────────────────────────

  describe('防护与等待', () => {
    it('应该捕获 "Route is already handled" 异常而不崩溃进程', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const { route } = createMockRoute();
      route.fulfill = vi.fn().mockRejectedValue(new Error('Route is already handled!'));

      const request = createMockRequest({ method: 'POST' });

      // 应正常 resolve，不向上抛出异常
      await expect(handler(route, request)).resolves.not.toThrow();
      expect(route.fulfill).toHaveBeenCalled();
    });

    it('发生其他 API 异常时应该尝试 route.continue() 避免请求挂住', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const { route } = createMockRoute();
      route.fetch = vi.fn().mockRejectedValue(new Error('Some network failure'));
      route.continue = vi.fn().mockResolvedValue(undefined);

      const request = createMockRequest({ method: 'POST' });

      // 应正常 resolve，不向上抛出异常，并触发 continue()
      await expect(handler(route, request)).resolves.not.toThrow();
      expect(route.fetch).toHaveBeenCalled();
      expect(route.continue).toHaveBeenCalled();
    });

    it('detach 时应该等待所有 in-flight 的 route handler 执行完成', async () => {
      const page = createMockPage();
      const interceptor = new NetworkInterceptor(page, cacheFilePath);
      await interceptor.attach();

      const handler = (page.route as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const { route } = createMockRoute();
      let resolveFetch!: (res: any) => void;
      
      route.fetch = vi.fn().mockImplementation(async () => {
        return new Promise<any>((resolve) => { resolveFetch = resolve; });
      });

      const request = createMockRequest({ method: 'POST' });

      // 启动请求，此时 handlerPromise 处于 pending 状态
      const handlerPromise = handler(route, request);

      // 在 50ms 后模拟 fetch 完成
      setTimeout(() => {
        const mockResponse = {
          status: () => 200,
          headers: () => ({ 'content-type': 'application/json' }),
          text: vi.fn().mockResolvedValue('{"success":true}'),
        };
        resolveFetch(mockResponse);
      }, 50);

      const startTime = Date.now();
      await interceptor.detach();
      const duration = Date.now() - startTime;

      // 验证 detach() 确实等待了 handlerPromise 完成
      expect(duration).toBeGreaterThanOrEqual(40);
      await handlerPromise;
    });
  });
});
