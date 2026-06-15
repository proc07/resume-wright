// ============================================================
// role-pool.ts — 角色 Session 复用池
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { RoleCredential } from '../types/case.types.js';
import type { RoleContext } from '../types/engine.types.js';
import { getDefaultRegistry } from '../adapters/elements-csv.js';
import { getDebuggerScript } from '../dsl/rw-debugger.js';
import { parseLocator, resolveLocator, resolveInputLocator, stripQuotes } from '../dsl/locator-resolver.js';



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
    await this.injectDebuggerToContext(context);
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
    const context = await this.browser.newContext({
      storageState: storageState as any,
      ignoreHTTPSErrors: true,
    });
    await this.injectDebuggerToContext(context);
    const page = await context.newPage();
    return { context, page };
  }

  private async injectDebuggerToContext(context: BrowserContext) {
    try {
      await context.exposeBinding('$$rw_node', async ({ page }, locatorStr: string) => {
        try {
          const parsed = parseLocator(locatorStr);
          let locator = resolveLocator(page, parsed);
          let count = await locator.count();
          let matchedType = 'standard';

          const isPlain = !/^(label:|placeholder:|testid:|title:|alt:|role:|\.|#|\/\/|@|\*.*\*|.*\|)/.test(stripQuotes(locatorStr));
          if (count === 0 && isPlain) {
            const inputLoc = resolveInputLocator(page, locatorStr);
            const inputCount = await inputLoc.count();
            if (inputCount > 0) {
              locator = inputLoc;
              count = inputCount;
              matchedType = 'input';
            }
          }

          if (count > 0) {
            const rwId = 'rw-' + Math.random().toString(36).slice(2);
            await locator.evaluateAll((elements, id) => {
              for (const el of elements) {
                el.setAttribute('data-rw-temp-id', id);
              }
            }, rwId);
            return { rwId, parsed, matchedType };
          }

          return { rwId: null, parsed, matchedType };
        } catch (err) {
          console.error(`[role-pool] Error in $$rw_node binding resolving "${locatorStr}":`, err);
          throw err;
        }
      });
    } catch (err) {
      console.warn(`[role-pool] Failed to expose $$rw_node binding to context:`, err);
    }

    try {
      const registry = getDefaultRegistry();
      const aliases: Record<string, string> = {};
      for (const a of registry.all()) {
        aliases[a.name] = a.locator;
      }
      const script = getDebuggerScript(aliases);
      await context.addInitScript(script);
    } catch (err) {
      console.warn(`[role-pool] Failed to inject $$rw debugger script to context:`, err);
    }
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

  // ── 已激活角色查询 ─────────────────────────────────────────

  /**
   * 获取所有已激活（已登录/已加载）的角色名称列表
   */
  getActiveRoles(): string[] {
    return Array.from(this.pages.keys());
  }

  /**
   * 获取已激活角色的 RoleContext（不触发登录）
   * 如果角色未激活，返回 null
   */
  getActiveRoleContext(roleName: string): RoleContext | null {
    const page = this.pages.get(roleName);
    const context = this.contexts.get(roleName);
    if (page && context) {
      return { context, page };
    }
    return null;
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
