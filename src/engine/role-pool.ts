// ============================================================
// role-pool.ts — 角色 Session 复用池
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { RoleCredential } from '../types/case.types.js';
import type { RoleContext } from '../types/engine.types.js';

const STATES_DIR = '.resumewright/states';

export interface RolePoolOptions {
  /** 登录后校验 Session 有效性的 URL（GET 请求，非 401 视为有效）*/
  sessionCheckUrl?: string;
  /** 登录宏路径（默认 macros/login.macro）*/
  loginMacroPath?: string;
  headless?: boolean;
  enableTrace?: boolean;
  traceDir?: string;
}

/**
 * RolePool — 管理角色浏览器 Session，支持缓存复用
 *
 * - 首次使用：执行真实登录，持久化 storageState
 * - 后续使用：加载缓存 BrowserContext，秒级切换
 * - 每个 Case 拥有独立 RolePool 实例
 */
export class RolePool {
  /** 活跃的 BrowserContext，key 为 roleName */
  private contexts: Map<string, BrowserContext> = new Map();
  private pages: Map<string, Page> = new Map();

  constructor(
    private readonly browser: Browser,
    private readonly roles: Record<string, RoleCredential>,
    private readonly opts: RolePoolOptions = {},
    private readonly statesDir: string = STATES_DIR
  ) {}

  // ── 获取角色页面 ───────────────────────────────────────────

  /**
   * 获取指定角色的 Page（自动登录 / 复用缓存）
   */
  async getPage(roleName: string): Promise<Page> {
    // 校验角色是否定义
    const creds = this.roles[roleName];
    if (!creds) {
      throw new Error(
        `Role "${roleName}" not defined. Available roles: ${Object.keys(this.roles).join(', ')}`
      );
    }

    // 已有活跃上下文
    if (this.pages.has(roleName)) {
      const page = this.pages.get(roleName)!;
      // 校验 Session 是否仍有效
      if (await this.isSessionValid(page)) {
        return page;
      }
      // Session 失效：关闭旧上下文，重新登录
      console.log(`[role-pool] Session expired for "${roleName}", re-login...`);
      await this.closeRole(roleName);
    }

    // 尝试从磁盘加载缓存的 storageState
    const cachedState = this.loadCachedState(roleName);
    if (cachedState) {
      const { context, page } = await this.createContextFromState(cachedState);
      // 验证缓存 Session 是否有效
      if (await this.isSessionValid(page)) {
        this.contexts.set(roleName, context);
        this.pages.set(roleName, page);
        console.log(`[role-pool] Loaded cached session for "${roleName}"`);
        return page;
      }
      // 缓存 Session 失效，重新登录
      await context.close();
    }

    // 全新登录
    const displayVal = Object.values(creds).find(v => typeof v === 'string') || '';
    const userDisplay = displayVal ? ` (${displayVal})` : '';
    console.log(`[role-pool] Logging in as "${roleName}"${userDisplay}...`);
    const { context, page } = await this.performLogin(roleName, creds);
    this.contexts.set(roleName, context);
    this.pages.set(roleName, page);
    return page;
  }

  /**
   * 获取角色的完整 RoleContext（context + page）
   */
  async getRoleContext(roleName: string): Promise<RoleContext> {
    const page = await this.getPage(roleName);
    const context = this.contexts.get(roleName)!;
    return { context, page };
  }

  // ── 登录流程 ───────────────────────────────────────────────

  private async performLogin(
    roleName: string,
    creds: RoleCredential
  ): Promise<RoleContext> {
    const context = await this.browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    if (this.opts.loginMacroPath) {
      // 使用自定义登录宏
      const { loadMacro } = await import('../dsl/macro-loader.js');
      const { executeInstructions } = await import('../dsl/executor.js');
      const { ContextStore } = await import('./context-store.js');

      const macroArgs: Record<string, string> = {};
      for (const [key, value] of Object.entries(creds)) {
        if (typeof value === 'string' || typeof value === 'number') {
          macroArgs[key] = String(value);
        }
      }

      const macroScript = loadMacro(
        this.opts.loginMacroPath,
        macroArgs
      );
      const tempCtx = new ContextStore();
      tempCtx.set('roles', this.roles);
      for (const [key, value] of Object.entries(creds)) {
        tempCtx.set(key, value);
      }
      await executeInstructions(macroScript, page, tempCtx, {});
    } else {
      console.log(`[role-pool] No loginMacroPath provided for "${roleName}". Skipping auto-login.`);
    }

    // 持久化 storageState
    await this.saveState(roleName, context);
    console.log(`[role-pool] ✓ Login successful for "${roleName}"`);

    return { context, page };
  }

  // ── Session 校验 ──────────────────────────────────────────

  private async isSessionValid(page: Page): Promise<boolean> {
    if (!this.opts.sessionCheckUrl) return true;

    try {
      const response = await page.request.get(this.opts.sessionCheckUrl);
      return response.status() !== 401 && response.status() !== 403;
    } catch {
      return false;
    }
  }

  // ── State 持久化 ──────────────────────────────────────────

  private loadCachedState(roleName: string): unknown {
    const filePath = this.getStatePath(roleName);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      return data.storageState ?? null;
    } catch {
      return null;
    }
  }

  private async saveState(roleName: string, context: BrowserContext): Promise<void> {
    const filePath = this.getStatePath(roleName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const storageState = await context.storageState();
    const data = {
      roleName,
      storageState,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async createContextFromState(
    storageState: unknown
  ): Promise<RoleContext> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const context = await this.browser.newContext({
      storageState: storageState as any,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    return { context, page };
  }

  private getStatePath(roleName: string): string {
    const safe = roleName.replace(/[^\w-]/g, '_');
    return path.join(this.statesDir, `${safe}.json`);
  }

  /**
   * 获取所有角色的凭证信息
   */
  getRoles(): Record<string, RoleCredential> {
    return this.roles;
  }

  /**
   * 获取指定角色的凭证信息
   */
  getCredentials(roleName: string): RoleCredential | undefined {
    return this.roles[roleName];
  }

  // ── 清理 ─────────────────────────────────────────────────

  /**
   * 关闭指定角色的上下文
   */
  async closeRole(roleName: string): Promise<void> {
    const ctx = this.contexts.get(roleName);
    if (ctx) {
      await ctx.close().catch(() => {});
      this.contexts.delete(roleName);
      this.pages.delete(roleName);
    }
  }

  /**
   * 关闭所有角色上下文（Case 执行完成后调用）
   */
  async closeAll(): Promise<void> {
    const roles = Array.from(this.contexts.keys());
    await Promise.all(roles.map((r) => this.closeRole(r)));
  }
}
