// ============================================================
// network-interceptor.ts — API 拦截与响应缓存
// 防止崩溃重启后非幂等 API 被重复调用
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Page, Route, Request } from '@playwright/test';
import type { ApiCacheEntry } from '../types/engine.types.js';

const NON_IDEMPOTENT = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/** URL 中需要忽略的时间戳/随机参数名 */
const TIMESTAMP_PARAMS = new Set([
  't', 'timestamp', '_t', 'ts', '_', 'cb', 'cacheBust', 'random', 'rand', '_r', 'v', '_v'
]);

/** POST JSON body 中需要忽略的动态字段名 */
const TIMESTAMP_BODY_FIELDS = new Set([
  'timestamp', 'requestId', 'nonce', '_', 't', 'random', 'rand', 'ts', '_t', 'requestIdempotencyKey'
]);

/**
 * NetworkInterceptor — 拦截非幂等 API，响应缓存复用
 *
 * 使用流程：
 * 1. new NetworkInterceptor(page, cacheFilePath)
 * 2. await interceptor.attach()     — 开始拦截
 * 3. ... 执行 DSL 步骤 ...
 * 4. await interceptor.detach()     — 停止拦截
 */
export class NetworkInterceptor {
  private cache: ApiCacheEntry[] = [];
  private attached = false;
  private readonly handler: (route: Route, request: Request) => Promise<void>;
  public activeSubStepId: string | null = null;
  
  // 用于记录当前运行中（某个 subStepId 下）各个 fingerprint 被调用的次数
  private requestCounts: Map<string, number> = new Map();

  constructor(
    private readonly page: Page,
    private readonly cacheFilePath: string,
    private readonly opts: { cacheGet?: boolean; readCache?: boolean } = {}
  ) {
    // 加载已有缓存
    this.loadCache();

    // 绑定 handler（需保持引用以便 detach）
    this.handler = this.handleRoute.bind(this);
  }

  // ── 挂载 / 摘除 ───────────────────────────────────────────

  async attach(): Promise<void> {
    if (this.attached) return;
    await this.page.route('**/*', this.handler);
    this.attached = true;
  }

  async detach(): Promise<void> {
    if (!this.attached) return;
    await this.page.unroute('**/*', this.handler);
    this.attached = false;
  }

  // ── 核心拦截逻辑 ──────────────────────────────────────────

  private async handleRoute(route: Route, request: Request): Promise<void> {
    const type = request.resourceType();
    // 仅拦截和缓存 API 请求（XHR 或 Fetch），放行文档、图片、样式等静态资源
    if (type !== 'xhr' && type !== 'fetch') {
      await route.continue();
      return;
    }

    const method = request.method().toUpperCase();

    // GET 默认放行，除非开启了 cacheGet
    if (!NON_IDEMPOTENT.has(method) && !this.opts.cacheGet) {
      await route.continue();
      return;
    }

    // 生成请求指纹
    const url = request.url();
    let bodyText = '';
    try {
      const postData = request.postData();
      bodyText = postData ? postData.slice(0, 500) : '';
    } catch { /* ignore */ }

    const normalizedUrl = normalizeUrl(url);
    const normalizedBody = normalizeBody(bodyText);
    const fingerprint = md5(`${method}|${normalizedUrl}|${normalizedBody}`);

    // 计算当前子步骤下该指纹 of 请求次数序号
    const activeSubId = this.activeSubStepId || '';
    const countKey = `${activeSubId}|${fingerprint}`;
    const count = (this.requestCounts.get(countKey) || 0) + 1;
    this.requestCounts.set(countKey, count);

    // 过滤出该子步骤下、指纹匹配的缓存列表
    const matchedEntries = this.cache.filter(
      (entry) => entry.fingerprint === fingerprint && (entry.subStepId || '') === activeSubId
    );

    // 命中缓存 → 直接 fulfill（同 fingerprint 同 subStep 返回相同缓存）
    const readCache = this.opts.readCache !== false;
    if (readCache && matchedEntries.length > 0) {
      const cached = matchedEntries[0];
      console.log(
        `[network-interceptor] 🎯 Cache HIT: ${method} ${url} (subStep: ${activeSubId || 'none'}, seq: ${count}) → ${cached.status}`
      );
      await route.fulfill({
        status: cached.status,
        headers: cached.headers,
        body: cached.body,
      });
      return;
    }

    // 未命中缓存 → 真实发送
    console.log(`[network-interceptor] 🌐 Forwarding: ${method} ${url} (subStep: ${activeSubId || 'none'}, seq: ${count})`);
    const response = await route.fetch();
    const responseBody = await response.text();

    // 仅缓存成功响应（2xx）
    if (response.status() >= 200 && response.status() < 300) {
      const entry: ApiCacheEntry = {
        fingerprint,
        method,
        url,
        status: response.status(),
        headers: response.headers() as Record<string, string>,
        body: responseBody,
        requestBody: request.postData() || undefined,
        cachedAt: new Date().toISOString(),
        subStepId: this.activeSubStepId || undefined,
      };
      this.cache.push(entry);
      this.persistCache();
      console.log(
        `[network-interceptor] 💾 Cached: ${method} ${url} (${response.status()})`
      );
    }

    await route.fulfill({
      response,
      body: responseBody,
    });
  }

  // ── 缓存持久化 ────────────────────────────────────────────

  private loadCache(): void {
    if (!fs.existsSync(this.cacheFilePath)) return;
    try {
      const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
      this.cache = JSON.parse(raw) as ApiCacheEntry[];
      console.log(
        `[network-interceptor] Loaded ${this.cache.length} cached API responses`
      );
    } catch (err) {
      console.warn(`[network-interceptor] Failed to load cache: ${String(err)}`);
    }
  }

  private persistCache(): void {
    const dir = path.dirname(this.cacheFilePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.cacheFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.cache, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.cacheFilePath);
  }

  /**
   * 清除缓存（Step 成功完成后可选调用）
   */
  clearCache(): void {
    this.cache = [];
    if (fs.existsSync(this.cacheFilePath)) {
      fs.unlinkSync(this.cacheFilePath);
    }
  }

  getCacheSize(): number {
    return this.cache.length;
  }

  resetCounts(): void {
    this.requestCounts.clear();
  }
}

// ── 工具函数 ─────────────────────────────────────────────────

function md5(input: string): string {
  return crypto.createHash('md5').update(input, 'utf-8').digest('hex');
}

/**
 * 归一化 URL：移除时间戳/随机类 query 参数，使指纹稳定
 */
function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of TIMESTAMP_PARAMS) {
      url.searchParams.delete(key);
    }
    return url.pathname + url.search + url.hash;
  } catch {
    return rawUrl;
  }
}

/**
 * 归一化 POST body：移除 JSON 中的动态字段，使指纹稳定
 */
function normalizeBody(body: string): string {
  if (!body) return '';
  try {
    const obj = JSON.parse(body);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const key of TIMESTAMP_BODY_FIELDS) {
        if (key in obj) delete obj[key];
      }
      return JSON.stringify(obj);
    }
    return body;
  } catch {
    return body;
  }
}
