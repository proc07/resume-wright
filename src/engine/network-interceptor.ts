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
  private cache: Map<string, ApiCacheEntry> = new Map();
  private attached = false;
  private readonly handler: (route: Route, request: Request) => Promise<void>;
  public activeSubStepId: string | null = null;

  constructor(
    private readonly page: Page,
    private readonly cacheFilePath: string,
    private readonly opts: { cacheGet?: boolean } = {}
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

    // 命中缓存 → 直接 fulfill
    if (this.cache.has(fingerprint)) {
      const cached = this.cache.get(fingerprint)!;
      console.log(
        `[network-interceptor] 🎯 Cache HIT: ${method} ${url} → ${cached.status}`
      );
      await route.fulfill({
        status: cached.status,
        headers: cached.headers,
        body: cached.body,
      });
      return;
    }

    // 未命中缓存 → 真实发送
    console.log(`[network-interceptor] 🌐 Forwarding: ${method} ${url}`);
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
        cachedAt: new Date().toISOString(),
        subStepId: this.activeSubStepId || undefined,
      };
      this.cache.set(fingerprint, entry);
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
      const entries = JSON.parse(raw) as ApiCacheEntry[];
      for (const entry of entries) {
        this.cache.set(entry.fingerprint, entry);
      }
      console.log(
        `[network-interceptor] Loaded ${this.cache.size} cached API responses`
      );
    } catch (err) {
      console.warn(`[network-interceptor] Failed to load cache: ${String(err)}`);
    }
  }

  private persistCache(): void {
    const dir = path.dirname(this.cacheFilePath);
    fs.mkdirSync(dir, { recursive: true });
    const entries = Array.from(this.cache.values());
    const tmpPath = `${this.cacheFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.cacheFilePath);
  }

  /**
   * 清除缓存（Step 成功完成后可选调用）
   */
  clearCache(): void {
    this.cache.clear();
    if (fs.existsSync(this.cacheFilePath)) {
      fs.unlinkSync(this.cacheFilePath);
    }
  }

  getCacheSize(): number {
    return this.cache.size;
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
