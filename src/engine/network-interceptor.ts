// ============================================================
// network-interceptor.ts — API 拦截采集与响应回放
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { BrowserContext, Page, Route, Request } from '@playwright/test';
import type {
  ApiCacheEntry,
  ApiCacheMetadata,
  ApiRequestJournal,
  ApiReplaySummary,
} from '../types/engine.types.js';

const NON_IDEMPOTENT = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const SAFE_REPLAY_FALLBACK = new Set(['GET', 'HEAD', 'OPTIONS']);
const MATCH_KEY_VERSION = 2;

const VOLATILE_QUERY_PARAMS = new Set([
  't', 'timestamp', '_t', 'ts', '_', 'cb', 'cachebust', 'random', 'rand', '_r', 'v', '_v',
  'globalid', 'cachetoken',
]);

const UNSAFE_REPLAY_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

type CacheMode = 'capture' | 'replay' | 'legacy';

export interface NetworkInterceptorOptions {
  cacheGet?: boolean;
  readCache?: boolean;
  stepId?: string;
  captureRunId?: string;
  captureDocuments?: boolean;
  methods?: string[];
  ignoreBareNumericQuery?: boolean;
  sharedStaticCache?: SharedStaticBootstrapCache;
  roleName?: string;
  requestJournalFilePath?: string;
}

type RouteTarget = Pick<Page | BrowserContext, 'route' | 'unroute'>;
type FetchedResponse = Awaited<ReturnType<Route['fetch']>>;
type ResponseData = { body: string; encoding: 'utf8' | 'base64' };

const SHARED_STATIC_SCOPE = 'bootstrap::shared::static';

export interface SharedStaticBootstrapCacheOptions {
  cacheFilePath: string;
  baseUrl: string;
  include: string[];
  exclude?: string[];
  readCache: boolean;
  captureRunId: string;
  ignoreBareNumericQuery?: boolean;
  requestJournalFilePath?: string;
}

type SharedStaticRouteResult =
  | { handled: true }
  | { handled: false; prefetchedResponse?: FetchedResponse; responseData?: ResponseData };

type SharedFetchOutcome =
  | { kind: 'shared'; entry: ApiCacheEntry }
  | { kind: 'role'; response: FetchedResponse; responseData: ResponseData };

/**
 * 同一个 Case 内的角色共享静态启动缓存。
 * 与业务 API 的顺序缓存不同，这里按 fingerprint 唯一存储一份响应，
 * occurrence/sequence 只保留在本次运行 journal 中用于诊断。
 */
export class SharedStaticBootstrapCache {
  private readonly metadataFilePath: string;
  private readonly requestJournalFilePath: string;
  private readonly roleOnlyFilePath: string;
  private readonly captureRunId: string;
  private readonly baseOrigin: string;
  private cache: ApiCacheEntry[] = [];
  private metadata: ApiCacheMetadata = { version: 1, activeAttempts: {} };
  private requestJournal: ApiRequestJournal;
  private occurrenceCounts = new Map<string, number>();
  private sequence = 0;
  private inFlight = new Map<string, Promise<SharedFetchOutcome>>();
  private roleOnlyFingerprints = new Set<string>();

  constructor(private readonly opts: SharedStaticBootstrapCacheOptions) {
    this.metadataFilePath = opts.cacheFilePath.endsWith('.json')
      ? opts.cacheFilePath.slice(0, -5) + '.meta.json'
      : `${opts.cacheFilePath}.meta.json`;
    this.requestJournalFilePath = opts.requestJournalFilePath
      ?? path.join(path.dirname(opts.cacheFilePath), 'api-requests.json');
    this.roleOnlyFilePath = path.join(path.dirname(opts.cacheFilePath), 'role-only.json');
    this.captureRunId = opts.captureRunId;
    try {
      this.baseOrigin = new URL(opts.baseUrl).origin;
    } catch {
      this.baseOrigin = '';
    }
    this.loadRoleOnlyFingerprints();
    this.loadCache();
    this.requestJournal = this.initializeRequestJournal();
  }

  matches(method: string, rawUrl: string): boolean {
    if (!SAFE_REPLAY_FALLBACK.has(method.toUpperCase()) || !this.baseOrigin) return false;
    try {
      const url = new URL(rawUrl);
      if (url.origin !== this.baseOrigin) return false;
      const pathname = url.pathname || '/';
      if ((this.opts.exclude ?? []).some((pattern) => matchPathPattern(pathname, pattern))) {
        return false;
      }
      if (this.opts.include.some((pattern) => matchPathPattern(pathname, pattern))) {
        const fingerprint = createFingerprint(method, rawUrl, this.opts.ignoreBareNumericQuery);
        return !this.roleOnlyFingerprints.has(fingerprint);
      }
    } catch {
      return false;
    }
    return false;
  }

  async handle(
    route: Route,
    request: Request,
    roleName?: string
  ): Promise<SharedStaticRouteResult> {
    const method = request.method().toUpperCase();
    const url = request.url();
    if (!this.matches(method, url)) return { handled: false };

    const fingerprint = createFingerprint(method, url, this.opts.ignoreBareNumericQuery);
    const occurrence = (this.occurrenceCounts.get(fingerprint) || 0) + 1;
    this.occurrenceCounts.set(fingerprint, occurrence);
    const sequence = ++this.sequence;
    const existing = this.cache.find((entry) => entry.fingerprint === fingerprint);

    if (existing) {
      await this.fulfillFromEntry(route, existing);
      this.recordRequestEvent(existing, roleName, occurrence, sequence, true);
      console.log(`[shared-bootstrap-cache] 🎯 Cache HIT: ${method} ${url}`);
      return { handled: true };
    }

    // 回放时共享 miss 不预取真实响应；交回角色缓存匹配，最终沿用现有 GET live fallback。
    // 共享静态快照只在显式普通采集运行中建立。
    if (this.opts.readCache) return { handled: false };

    const pending = this.inFlight.get(fingerprint);
    if (pending) {
      const outcome = await pending;
      if (outcome.kind === 'shared') {
        await this.fulfillFromEntry(route, outcome.entry);
        this.recordRequestEvent(outcome.entry, roleName, occurrence, sequence, true);
        console.log(`[shared-bootstrap-cache] 🎯 In-flight reuse: ${method} ${url}`);
        return { handled: true };
      }
      return { handled: false };
    }

    const fetchPromise = this.fetchSharedCandidate(route, request, fingerprint);
    this.inFlight.set(fingerprint, fetchPromise);
    let outcome: SharedFetchOutcome;
    try {
      outcome = await fetchPromise;
    } finally {
      this.inFlight.delete(fingerprint);
    }

    if (outcome.kind === 'role') {
      console.log(`[shared-bootstrap-cache] Personalized response demoted to role cache: ${method} ${url}`);
      return {
        handled: false,
        prefetchedResponse: outcome.response,
        responseData: outcome.responseData,
      };
    }

    await this.fulfillFromEntry(route, outcome.entry);
    this.recordRequestEvent(outcome.entry, roleName, occurrence, sequence, false);
    return { handled: true };
  }

  private async fetchSharedCandidate(
    route: Route,
    request: Request,
    fingerprint: string
  ): Promise<SharedFetchOutcome> {
    const method = request.method().toUpperCase();
    const url = request.url();
    console.log(`[shared-bootstrap-cache] 🌐 Forwarding once: ${method} ${url}`);
    const response = await route.fetch();
    const responseData = await readResponseBody(response);
    const headers = response.headers() as Record<string, string>;

    if (!isShareableResponse(headers)) {
      this.roleOnlyFingerprints.add(fingerprint);
      this.persistRoleOnlyFingerprints();
      return { kind: 'role', response, responseData };
    }

    const entry: ApiCacheEntry = {
      fingerprint,
      method,
      url,
      status: response.status(),
      headers,
      body: responseData.body,
      bodyEncoding: responseData.encoding,
      cachedAt: new Date().toISOString(),
      stepId: 'bootstrap::shared',
      scopeId: SHARED_STATIC_SCOPE,
      occurrence: 1,
      sequence: this.cache.length + 1,
      attemptId: 'shared-static',
      captureRunId: this.captureRunId,
      matchKeyVersion: MATCH_KEY_VERSION,
      responseKind: 'http',
      isActiveSnapshot: true,
    };

    // 共享静态快照只在采集模式生成；后续角色直接复用这一份。
    this.cache.push(entry);
    this.metadata.activeAttempts[SHARED_STATIC_SCOPE] = {
      attemptId: 'shared-static',
      captureRunId: this.captureRunId,
      entryCount: this.cache.length,
      completedAt: new Date().toISOString(),
    };
    this.persistCache();
    console.log(`[shared-bootstrap-cache] 💾 Cached once: ${method} ${url}`);

    return { kind: 'shared', entry };
  }

  private async fulfillFromEntry(route: Route, entry: ApiCacheEntry): Promise<void> {
    await route.fulfill({
      status: entry.status,
      headers: sanitizeReplayHeaders(entry.headers),
      body: entry.bodyEncoding === 'base64' ? Buffer.from(entry.body, 'base64') : entry.body,
    });
  }

  private loadCache(): void {
    try {
      if (!fs.existsSync(this.opts.cacheFilePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.opts.cacheFilePath, 'utf-8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Shared cache file must contain a JSON array');
      const unique = new Map<string, ApiCacheEntry>();
      for (const rawEntry of parsed as ApiCacheEntry[]) {
        const fingerprint = createFingerprint(
          rawEntry.method,
          rawEntry.url,
          this.opts.ignoreBareNumericQuery
        );
        if (
          unique.has(fingerprint) ||
          this.roleOnlyFingerprints.has(fingerprint) ||
          !isShareableResponse(rawEntry.headers || {})
        ) {
          continue;
        }
        unique.set(fingerprint, {
          ...rawEntry,
          fingerprint,
          stepId: 'bootstrap::shared',
          scopeId: SHARED_STATIC_SCOPE,
          occurrence: 1,
          attemptId: 'shared-static',
          matchKeyVersion: MATCH_KEY_VERSION,
          isActiveSnapshot: true,
        });
      }
      this.cache = [...unique.values()];
      if (this.cache.length > 0) {
        this.metadata.activeAttempts[SHARED_STATIC_SCOPE] = {
          attemptId: 'shared-static',
          captureRunId: this.captureRunId,
          entryCount: this.cache.length,
          completedAt: this.cache.at(-1)?.cachedAt ?? new Date().toISOString(),
        };
      }
      console.log(`[shared-bootstrap-cache] Loaded ${this.cache.length} shared static responses`);
    } catch (err) {
      console.warn(`[shared-bootstrap-cache] Failed to load cache: ${String(err)}`);
      this.cache = [];
    }
  }

  private initializeRequestJournal(): ApiRequestJournal {
    try {
      if (fs.existsSync(this.requestJournalFilePath)) {
        const existing = JSON.parse(
          fs.readFileSync(this.requestJournalFilePath, 'utf-8')
        ) as ApiRequestJournal;
        if (existing.version === 3 && existing.runId === this.captureRunId) return existing;
      }
    } catch { /* 使用新的运行记录覆盖损坏或过期文件 */ }

    const journal: ApiRequestJournal = { version: 3, runId: this.captureRunId, entries: [] };
    fs.mkdirSync(path.dirname(this.requestJournalFilePath), { recursive: true });
    writeJsonAtomic(this.requestJournalFilePath, journal);
    return journal;
  }

  private loadRoleOnlyFingerprints(): void {
    try {
      if (!fs.existsSync(this.roleOnlyFilePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.roleOnlyFilePath, 'utf-8')) as unknown;
      if (Array.isArray(parsed)) {
        this.roleOnlyFingerprints = new Set(
          parsed.filter((value): value is string => typeof value === 'string')
        );
      }
    } catch (err) {
      console.warn(`[shared-bootstrap-cache] Failed to load role-only markers: ${String(err)}`);
    }
  }

  private persistRoleOnlyFingerprints(): void {
    fs.mkdirSync(path.dirname(this.roleOnlyFilePath), { recursive: true });
    writeJsonAtomic(this.roleOnlyFilePath, [...this.roleOnlyFingerprints]);
  }

  private recordRequestEvent(
    entry: ApiCacheEntry,
    roleName: string | undefined,
    occurrence: number,
    sequence: number,
    fromCache: boolean
  ): void {
    this.requestJournal.entries.push({
      runId: this.captureRunId,
      method: entry.method,
      url: entry.url,
      status: entry.status,
      headers: entry.headers,
      body: entry.body,
      bodyEncoding: entry.bodyEncoding,
      requestedAt: new Date().toISOString(),
      stepId: 'bootstrap::shared',
      scopeId: SHARED_STATIC_SCOPE,
      occurrence,
      sequence,
      attemptId: 'shared-static',
      fromCache,
      cacheAvailable: true,
      roleName,
    });
    writeJsonAtomic(this.requestJournalFilePath, this.requestJournal);
  }

  private persistCache(): void {
    fs.mkdirSync(path.dirname(this.opts.cacheFilePath), { recursive: true });
    writeJsonAtomic(this.opts.cacheFilePath, this.cache);
    writeJsonAtomic(this.metadataFilePath, this.metadata);
  }
}

export class CacheReplayMismatchError extends Error {
  constructor(
    message: string,
    public readonly method: string,
    public readonly url: string,
    public readonly occurrence: number
  ) {
    super(message);
    this.name = 'CacheReplayMismatchError';
  }
}

export class NetworkInterceptor {
  private cache: ApiCacheEntry[] = [];
  private metadata: ApiCacheMetadata = { version: 1, activeAttempts: {} };
  private attached = false;
  private readonly handler: (route: Route, request: Request) => Promise<void>;
  private readonly mode: CacheMode;
  private readonly metadataFilePath: string;
  private readonly requestJournalFilePath: string;
  private readonly captureRunId: string;
  private requestJournal: ApiRequestJournal;
  private activeAttemptId: string | null = null;
  private activeScopeId: string | null = null;
  private attemptCounter = 0;

  public activeSubStepId: string | null = null;

  private requestCounts = new Map<string, number>();
  private scopeSequenceCounts = new Map<string, number>();
  private cacheHits = new Map<string, number>();
  private liveFallbacks = new Map<string, number>();
  private fatalReplayError: CacheReplayMismatchError | null = null;
  private inFlightPromises = new Set<Promise<void>>();

  private fetchingRoutes = new Set<Route>();
  private isDetached = false;

  constructor(
    private readonly target: RouteTarget,
    private readonly cacheFilePath: string,
    private readonly opts: NetworkInterceptorOptions = {}
  ) {
    this.mode = opts.readCache === undefined
      ? 'legacy'
      : (opts.readCache ? 'replay' : 'capture');

    this.metadataFilePath = cacheFilePath.endsWith('.json')
      ? cacheFilePath.slice(0, -5) + '.meta.json'
      : `${cacheFilePath}.meta.json`;
    this.requestJournalFilePath = opts.requestJournalFilePath
      ?? path.join(path.dirname(cacheFilePath), 'api-requests.json');
    this.captureRunId = opts.captureRunId
      ?? `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.requestJournal = this.initializeRequestJournal();

    this.loadCache();
    this.handler = this.handleRoute.bind(this);
  }

  // ── Scope / attempt 生命周期 ──

  beginScopeAttempt(subStepId?: string, attemptId?: string): string {
    this.activeSubStepId = subStepId || null;
    this.activeScopeId = this.scopeIdFor(subStepId);
    this.activeAttemptId = attemptId
      ?? `${this.captureRunId}:${this.activeScopeId}:${++this.attemptCounter}`;
    this.resetCounts();
    this.fatalReplayError = null;
    console.log(
      `[network-interceptor] Begin ${this.mode} scope=${this.activeScopeId} attempt=${this.activeAttemptId}`
    );
    return this.activeAttemptId;
  }

  async completeScopeAttempt(): Promise<ApiReplaySummary> {
    await this.waitForInFlight();
    this.throwPendingReplayError();
    const scopeId = this.currentScopeId();

    if (this.mode === 'capture') {
      const attemptId = this.currentAttemptId();
      for (const entry of this.cache) {
        if (this.entryScopeId(entry) === scopeId) {
          entry.isActiveSnapshot = entry.attemptId === attemptId;
        }
      }
      const entryCount = this.cache.filter(
        (entry) => this.entryScopeId(entry) === scopeId && entry.attemptId === attemptId
      ).length;
      this.metadata.activeAttempts[scopeId] = {
        attemptId,
        captureRunId: this.captureRunId,
        entryCount,
        completedAt: new Date().toISOString(),
      };
      this.persistCache();
    }

    const summary = this.getReplaySummary(scopeId);
    this.logReplaySummary(summary);
    return summary;
  }

  async failScopeAttempt(): Promise<CacheReplayMismatchError | null> {
    await this.waitForInFlight();
    if (this.mode === 'capture' && this.activeAttemptId) {
      for (const entry of this.cache) {
        if (entry.attemptId === this.activeAttemptId) entry.isActiveSnapshot = false;
      }
      this.persistCache();
    }
    return this.fatalReplayError;
  }

  // ── 挂载 / 摘除 ──

  async attach(): Promise<void> {
    if (this.attached) return;
    this.isDetached = false;
    await this.target.route('**/*', this.handler);
    this.attached = true;
  }

  async detach(): Promise<void> {
    if (!this.attached) return;
    this.isDetached = true;
    await this.target.unroute('**/*', this.handler);
    this.attached = false;
    await this.waitForInFlight();
  }

  // ── 核心拦截逻辑 ──

  private async handleRoute(route: Route, request: Request): Promise<void> {
    const promise = this.handleRouteInternal(route, request);
    this.inFlightPromises.add(promise);
    try {
      await promise;
    } finally {
      this.inFlightPromises.delete(promise);
    }
  }

  private async handleRouteInternal(route: Route, request: Request): Promise<void> {
    if (this.isDetached) {
      try { await route.abort('aborted'); } catch { /* ignore */ }
      return;
    }

    try {
      const method = request.method().toUpperCase();
      const url = request.url();
      const isSharedStaticCandidate = this.opts.sharedStaticCache?.matches(method, url) === true;
      const type = request.resourceType();

      // 仅拦截和缓存 API 请求（XHR 或 Fetch），放行文档、图片、样式等静态资源
      if (type !== 'xhr' && type !== 'fetch') {
        const shouldCaptureDocument = this.opts.captureDocuments && type === 'document';
        if (type !== 'xhr' && type !== 'fetch' && !shouldCaptureDocument && !isSharedStaticCandidate) {
          await route.continue();
          return;
        }
      }

      if (this.opts.methods && !this.opts.methods.some((allowed) => allowed.toUpperCase() === method)) {
        await route.continue();
        return;
      }

      if (!NON_IDEMPOTENT.has(method) && !this.opts.cacheGet) {
        await route.continue();
        return;
      }

      const fingerprint = createFingerprint(method, url, this.opts.ignoreBareNumericQuery);
      let prefetchedResponse: FetchedResponse | undefined;
      let prefetchedResponseData: ResponseData | undefined;

      if (isSharedStaticCandidate && this.opts.sharedStaticCache) {
        const sharedResult = await this.opts.sharedStaticCache.handle(
          route,
          request,
          this.opts.roleName
        );
        if (sharedResult.handled) return;
        prefetchedResponse = sharedResult.prefetchedResponse;
        prefetchedResponseData = sharedResult.responseData;
      }

      const scopeId = this.currentScopeId();
      const countKey = `${scopeId}|${fingerprint}`;
      const occurrence = (this.requestCounts.get(countKey) || 0) + 1;
      this.requestCounts.set(countKey, occurrence);
      const sequence = (this.scopeSequenceCounts.get(scopeId) || 0) + 1;
      this.scopeSequenceCounts.set(scopeId, sequence);

      const matchedEntries = this.getReplayEntries(scopeId, fingerprint);
      let cached: ApiCacheEntry | undefined;
      if (this.mode === 'legacy') {
        cached = matchedEntries[0];
      } else {
        cached = matchedEntries.find((entry) => entry.occurrence === occurrence);
      }

      if (this.mode !== 'capture' && cached) {
        this.incrementMetric(this.cacheHits, scopeId);
        console.log(
          `[network-interceptor] 🎯 Cache HIT: ${method} ${url} (scope: ${scopeId}, occurrence: ${occurrence}, sequence: ${sequence}) -> ${cached.status}`
        );
        await route.fulfill({
          status: cached.status,
          headers: sanitizeReplayHeaders(cached.headers),
          body: cached.bodyEncoding === 'base64' ? Buffer.from(cached.body, 'base64') : cached.body,
        });
        this.recordRequestEvent({
          method,
          url,
          status: cached.status,
          headers: cached.headers,
          body: cached.body,
          bodyEncoding: cached.bodyEncoding,
          scopeId,
          occurrence,
          sequence,
          fromCache: true,
          cacheAvailable: true,
        });
        return;
      }

      if (this.mode === 'replay' && !SAFE_REPLAY_FALLBACK.has(method)) {
        const error = new CacheReplayMismatchError(
          `Missing ordered cache entry for ${method} ${url} ` +
            `(scope=${scopeId}, occurrence=${occurrence}). The write request was not sent.`,
          method,
          url,
          occurrence
        );
        try { await route.abort('failed'); } catch { /* ignore */ }
        this.fatalReplayError = error;
        console.error(`[network-interceptor] ${error.message}`);
        return;
      }

      if (this.mode === 'replay') {
        this.incrementMetric(this.liveFallbacks, scopeId);
        console.warn(
          `[network-interceptor] ⚠ Cache exhausted; using live fallback: ${method} ${url} ` +
            `(scope: ${scopeId}, occurrence: ${occurrence})`
        );
      }

      if (this.isDetached) {
        try { await route.abort('aborted'); } catch { /* ignore */ }
        return;
      }

      this.fetchingRoutes.add(route);
      let response: FetchedResponse;
      try {
        if (prefetchedResponse) {
          response = prefetchedResponse;
        } else {
          console.log(
            `[network-interceptor] 🌐 Forwarding: ${method} ${url} ` +
              `(scope: ${scopeId}, occurrence: ${occurrence}, sequence: ${sequence})`
          );
          response = await route.fetch();
        }
      } finally {
        this.fetchingRoutes.delete(route);
      }

      if (this.isDetached) return;

      const responseData = prefetchedResponseData ?? (await readResponseBody(response));

      if (response.status() >= 200 && response.status() < 300) {
        if (this.mode !== 'replay') {
          const entry: ApiCacheEntry = {
            fingerprint,
            method,
            url,
            status: response.status(),
            headers: response.headers() as Record<string, string>,
            body: responseData.body,
            bodyEncoding: responseData.encoding,
            requestBody: request.postData() || undefined,
            cachedAt: new Date().toISOString(),
            subStepId: this.activeSubStepId || undefined,
            stepId: this.opts.stepId,
            scopeId,
            occurrence,
            sequence,
            attemptId: this.currentAttemptId(),
            captureRunId: this.captureRunId,
            matchKeyVersion: MATCH_KEY_VERSION,
            responseKind: 'http',
            isActiveSnapshot: this.mode === 'legacy',
          };
          this.cache.push(entry);
          this.persistCache();
          console.log(
            `[network-interceptor] 💾 Cached: ${method} ${url} (${response.status()}), occurrence: ${occurrence}`
          );
        }
      }

      await route.fulfill({
        response,
        body: responseData.encoding === 'base64' ? Buffer.from(responseData.body, 'base64') : responseData.body,
      });

      this.recordRequestEvent({
        method,
        url,
        status: response.status(),
        headers: response.headers() as Record<string, string>,
        body: responseData.body,
        bodyEncoding: responseData.encoding,
        requestBody: request.postData() || undefined,
        scopeId,
        occurrence,
        sequence,
        fromCache: false,
        cacheAvailable: this.mode !== 'replay',
      });
    } catch (err: unknown) {
      const errMsg = String(err);
      if (this.isDetached) {
        console.warn(`[network-interceptor] 注销时路由错误（请求已被中断）: ${errMsg}`);
        return;
      }
      if (errMsg.includes('Route is already handled')) {
        console.warn(`[network-interceptor] Route is already handled warning: ${errMsg}`);
      } else {
        console.error(`[network-interceptor] Error handling route: ${errMsg}. Trying route.continue().`);
        try {
          await route.continue();
        } catch (contErr: unknown) {
          const contErrMsg = String(contErr);
          if (contErrMsg.includes('Route is already handled')) {
            console.warn(`[network-interceptor] Route is already handled when calling continue: ${contErrMsg}`);
          } else {
            console.error(`[network-interceptor] Failed to continue route after error: ${contErrMsg}`);
          }
        }
      }
    }
  }

  // ── 回放匹配与摘要 ──

  private getReplayEntries(scopeId: string, fingerprint: string): ApiCacheEntry[] {
    const activeAttempt = this.metadata.activeAttempts[scopeId]?.attemptId;
    return this.cache
      .filter((entry) => {
        if (this.entryScopeId(entry) !== scopeId || entry.fingerprint !== fingerprint) return false;
        if (activeAttempt) return entry.attemptId === activeAttempt;
        return entry.isActiveSnapshot !== false;
      })
      .sort((a, b) => (a.occurrence ?? 0) - (b.occurrence ?? 0));
  }

  getReplaySummary(scopeId = this.currentScopeId()): ApiReplaySummary {
    const activeAttempt = this.metadata.activeAttempts[scopeId]?.attemptId;
    const entries = this.cache.filter((entry) => {
      if (this.entryScopeId(entry) !== scopeId) return false;
      if (activeAttempt) return entry.attemptId === activeAttempt;
      return entry.isActiveSnapshot !== false;
    });

    let consumed = 0;
    const totals = new Map<string, number>();
    for (const entry of entries) {
      totals.set(entry.fingerprint, (totals.get(entry.fingerprint) || 0) + 1);
    }
    for (const [fingerprint, total] of totals) {
      consumed += Math.min(total, this.requestCounts.get(`${scopeId}|${fingerprint}`) || 0);
    }

    return {
      scopeId,
      cached: entries.length,
      consumed,
      cacheHits: this.cacheHits.get(scopeId) || 0,
      liveFallbacks: this.liveFallbacks.get(scopeId) || 0,
      unconsumed: Math.max(0, entries.length - consumed),
    };
  }

  private logReplaySummary(summary: ApiReplaySummary): void {
    if (this.mode !== 'replay') return;
    const message =
      `[network-interceptor] Replay summary scope=${summary.scopeId}: ` +
      `consumed ${summary.consumed}/${summary.cached}, hits=${summary.cacheHits}, ` +
      `liveFallbacks=${summary.liveFallbacks}, unconsumed=${summary.unconsumed}`;
    if (summary.unconsumed > 0 || summary.liveFallbacks > 0) console.warn(message);
    else console.log(message);
  }

  // ── 缓存持久化 ──

  private loadCache(): void {
    if (fs.existsSync(this.cacheFilePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf-8')) as unknown;
        if (!Array.isArray(parsed)) throw new Error('Cache file must contain a JSON array');
        this.cache = parsed as ApiCacheEntry[];
        this.migrateLegacyEntries();
        console.log(`[network-interceptor] Loaded ${this.cache.length} cached API responses`);
      } catch (err) {
        console.warn(`[network-interceptor] Failed to load cache: ${String(err)}`);
        this.cache = [];
      }
    }

    if (fs.existsSync(this.metadataFilePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.metadataFilePath, 'utf-8')) as ApiCacheMetadata;
        if (parsed?.version === 1 && parsed.activeAttempts && typeof parsed.activeAttempts === 'object') {
          this.metadata = parsed;
        }
      } catch (err) {
        console.warn(`[network-interceptor] Failed to load cache metadata: ${String(err)}`);
      }
    }

    if (Object.keys(this.metadata.activeAttempts).length === 0) {
      const byScope = new Map<string, ApiCacheEntry[]>();
      for (const entry of this.cache) {
        const scopeId = this.entryScopeId(entry);
        const entries = byScope.get(scopeId) ?? [];
        entries.push(entry);
        byScope.set(scopeId, entries);
      }
      for (const [scopeId, entries] of byScope) {
        const active = [...entries].reverse().find((entry) => entry.isActiveSnapshot !== false);
        if (!active?.attemptId) continue;
        this.metadata.activeAttempts[scopeId] = {
          attemptId: active.attemptId,
          captureRunId: active.captureRunId ?? '',
          entryCount: entries.filter((entry) => entry.attemptId === active.attemptId).length,
          completedAt: active.cachedAt,
        };
      }
    }
  }

  private migrateLegacyEntries(): void {
    const occurrenceCounts = new Map<string, number>();
    const sequenceCounts = new Map<string, number>();

    for (const entry of this.cache) {
      const scopeId = entry.scopeId || this.scopeIdFor(entry.subStepId);
      const needsMatchKeyMigration = entry.matchKeyVersion !== MATCH_KEY_VERSION;
      if (needsMatchKeyMigration) {
        entry.fingerprint = createFingerprint(
          entry.method,
          entry.url,
          this.opts.ignoreBareNumericQuery
        );
      }
      const countKey = `${scopeId}|${entry.fingerprint}`;
      const inferredOccurrence = (occurrenceCounts.get(countKey) || 0) + 1;
      occurrenceCounts.set(countKey, Math.max(inferredOccurrence, entry.occurrence ?? 0));
      const inferredSequence = (sequenceCounts.get(scopeId) || 0) + 1;
      sequenceCounts.set(scopeId, Math.max(inferredSequence, entry.sequence ?? 0));

      entry.scopeId = scopeId;
      entry.stepId ??= this.opts.stepId;
      if (needsMatchKeyMigration || entry.occurrence === undefined) {
        entry.occurrence = inferredOccurrence;
      }
      entry.sequence ??= inferredSequence;
      entry.attemptId ??= 'legacy';
      entry.matchKeyVersion ??= MATCH_KEY_VERSION;
      entry.responseKind ??= 'http';
      entry.bodyEncoding ??= 'utf8';
      entry.isActiveSnapshot ??= true;
    }
  }

  private persistCache(): void {
    const dir = path.dirname(this.cacheFilePath);
    fs.mkdirSync(dir, { recursive: true });
    writeJsonAtomic(this.cacheFilePath, this.cache);
    writeJsonAtomic(this.metadataFilePath, this.metadata);
  }

  private initializeRequestJournal(): ApiRequestJournal {
    try {
      if (fs.existsSync(this.requestJournalFilePath)) {
        const existing = JSON.parse(
          fs.readFileSync(this.requestJournalFilePath, 'utf-8')
        ) as ApiRequestJournal;
        if (existing.version === 3 && existing.runId === this.captureRunId) return existing;
      }
    } catch { /* 使用新的运行记录覆盖损坏或过期文件 */ }

    const journal: ApiRequestJournal = { version: 3, runId: this.captureRunId, entries: [] };
    fs.mkdirSync(path.dirname(this.requestJournalFilePath), { recursive: true });
    writeJsonAtomic(this.requestJournalFilePath, journal);
    return journal;
  }

  private recordRequestEvent(input: {
    method: string;
    url: string;
    status: number;
    headers: Record<string, string>;
    body: string;
    bodyEncoding?: 'utf8' | 'base64';
    requestBody?: string;
    scopeId: string;
    occurrence: number;
    sequence: number;
    fromCache: boolean;
    cacheAvailable: boolean;
  }): void {
    this.requestJournal.entries.push({
      runId: this.captureRunId,
      method: input.method,
      url: input.url,
      status: input.status,
      headers: input.headers,
      body: input.body,
      bodyEncoding: input.bodyEncoding,
      requestBody: input.requestBody || undefined,
      requestedAt: new Date().toISOString(),
      subStepId: this.activeSubStepId || undefined,
      stepId: this.opts.stepId,
      scopeId: input.scopeId,
      occurrence: input.occurrence,
      sequence: input.sequence,
      attemptId: this.currentAttemptId(),
      fromCache: input.fromCache,
      cacheAvailable: input.cacheAvailable,
      roleName: this.opts.roleName,
    });
    writeJsonAtomic(this.requestJournalFilePath, this.requestJournal);
  }

  clearCache(): void {
    this.cache = [];
    this.metadata = { version: 1, activeAttempts: {} };
    this.requestJournal.entries = [];
    for (const file of [this.cacheFilePath, this.metadataFilePath, this.requestJournalFilePath]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }

  getCacheSize(): number {
    return this.cache.length;
  }

  resetCounts(): void {
    this.requestCounts.clear();
    this.scopeSequenceCounts.clear();
    this.cacheHits.clear();
    this.liveFallbacks.clear();
  }

  private async waitForInFlight(): Promise<void> {
    if (this.inFlightPromises.size > 0) await Promise.all([...this.inFlightPromises]);
  }

  private currentScopeId(): string {
    const expected = this.scopeIdFor(this.activeSubStepId || undefined);
    if (this.activeScopeId !== expected) {
      this.activeScopeId = expected;
      this.activeAttemptId = null;
    }
    return this.activeScopeId;
  }

  private currentAttemptId(): string {
    if (this.mode === 'replay') {
      const scopeId = this.currentScopeId();
      this.activeAttemptId = this.metadata.activeAttempts[scopeId]?.attemptId ?? 'legacy';
    } else if (this.mode === 'legacy') {
      this.activeAttemptId = 'legacy';
    } else {
      if (!this.activeAttemptId) {
        const scopeId = this.currentScopeId();
        this.activeAttemptId = `${this.captureRunId}:${scopeId}:${++this.attemptCounter}`;
      }
    }
    return this.activeAttemptId;
  }

  private scopeIdFor(subStepId?: string): string {
    const localId = subStepId || '$step';
    return this.opts.stepId ? `${this.opts.stepId}::${localId}` : localId;
  }

  private entryScopeId(entry: ApiCacheEntry): string {
    return entry.scopeId || this.scopeIdFor(entry.subStepId);
  }

  private incrementMetric(map: Map<string, number>, scopeId: string): void {
    map.set(scopeId, (map.get(scopeId) || 0) + 1);
  }

  private throwPendingReplayError(): void {
    if (this.fatalReplayError) throw this.fatalReplayError;
  }
}

// ── 工具函数 ──

function md5(input: string): string {
  return crypto.createHash('md5').update(input, 'utf-8').digest('hex');
}

export function createFingerprint(
  method: string,
  rawUrl: string,
  ignoreBareNumericQuery = false
): string {
  return md5(`${method.toUpperCase()}|${normalizeUrl(rawUrl, ignoreBareNumericQuery)}`);
}

function normalizeUrl(rawUrl: string, ignoreBareNumericQuery = false): string {
  try {
    const url = new URL(rawUrl);
    for (const key of VOLATILE_QUERY_PARAMS) {
      url.searchParams.delete(key);
    }
    if (ignoreBareNumericQuery) {
      const entries = [...url.searchParams.entries()];
      if (
        entries.length === 1 &&
        entries[0][1] === '' &&
        /^\d{10,}$/.test(entries[0][0])
      ) {
        url.search = '';
      }
    }
    for (const key of [...url.searchParams.keys()]) {
      if (VOLATILE_QUERY_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    return url.pathname + url.search + url.hash;
  } catch {
    return rawUrl;
  }
}

async function readResponseBody(
  response: Awaited<ReturnType<Route['fetch']>>
): Promise<ResponseData> {
  const headers = response.headers() as Record<string, string>;
  const contentType = headers['content-type'] || headers['Content-Type'] || '';
  const isText = /(^text\/|json|javascript|xml|x-www-form-urlencoded|graphql)/i.test(contentType);

  if (!isText && typeof response.body === 'function') {
    const buffer = await response.body();
    return { body: buffer.toString('base64'), encoding: 'base64' };
  }
  return { body: await response.text(), encoding: 'utf8' };
}

function sanitizeReplayHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !UNSAFE_REPLAY_HEADERS.has(name.toLowerCase()))
  );
}

function isShareableResponse(headers: Record<string, string>): boolean {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  );
  if (normalized['set-cookie']) return false;
  const vary = (normalized['vary'] || '')
    .split(',')
    .map((value) => value.trim().toLowerCase());
  return !vary.includes('cookie') && !vary.includes('authorization');
}

function matchPathPattern(pathname: string, pattern: string): boolean {
  if (!pattern) return false;
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*';
        i++;
      } else {
        source += '[^/]*';
      }
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`).test(pathname);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}
