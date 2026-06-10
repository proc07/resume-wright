// ============================================================
// tests/integration/dsl-executor.test.ts
// DSL 执行器集成测试（需要真实 Playwright 浏览器）
//
// 运行方式：npm run test:integration
// 此测试会启动本地静态文件服务器，对 test-app.html 执行真实 DSL 命令
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect as pwExpect, type Browser, type Page, type BrowserContext } from '@playwright/test';
import { ContextStore } from '../../src/engine/context-store.js';
import { executeScript } from '../../src/dsl/executor.js';

// ── 本地静态文件服务器 ────────────────────────────────────────

let server: http.Server;
let baseUrl: string;
let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  // 启动简单 HTTP 服务器提供 test-app.html
  server = http.createServer((req, res) => {
    const htmlPath = path.join(
      import.meta.dirname,
      'fixtures/test-app.html'
    );
    if (req.url === '/' || req.url?.startsWith('/workflow/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(htmlPath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // 启动浏览器
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  page = await context.newPage();
});

afterAll(async () => {
  await context.close();
  await browser.close();
  server.close();
});

// ── 工具函数 ──────────────────────────────────────────────────

function makeCtx() {
  const ctx = new ContextStore();
  ctx.set('base_url', baseUrl);
  return ctx;
}

// ── 测试用例 ──────────────────────────────────────────────────

describe('DSL 执行器集成测试', () => {

  describe('open — 页面导航', () => {
    it('打开页面并验证标题', async () => {
      const ctx = makeCtx();
      await executeScript(`open "$base_url"`, page, ctx, {});
      expect(page.url()).toContain('127.0.0.1');
      const title = await page.title();
      expect(title).toContain('ResumeWright');
    });
  });

  describe('input — 表单填写', () => {
    it('通过 label 填写输入框', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        input "Q3 办公设备采购" to "label:申请标题"
      `, page, ctx, {});
      const value = await page.getByLabel('申请标题').inputValue();
      expect(value).toBe('Q3 办公设备采购');
    });

    it('通过 testid 填写输入框', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        input "50000" to "testid:amount-input"
      `, page, ctx, {});
      const value = await page.getByTestId('amount-input').inputValue();
      expect(value).toBe('50000');
    });

    it('清空输入框（空字符串）', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        input "待清空内容" to "label:申请标题"
        input "" to "label:申请标题"
      `, page, ctx, {});
      const value = await page.getByLabel('申请标题').inputValue();
      expect(value).toBe('');
    });
  });

  describe('tap — 点击操作', () => {
    it('点击按钮并触发提交', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        input "集成测试申请" to "label:申请标题"
        input "9999" to "testid:amount-input"
        tap "role:button[提交申请]"
      `, page, ctx, {});
      // 提交后应显示成功消息
      await page.waitForTimeout(300);
      const resultEl = page.locator('#result');
      await pwExpect(resultEl).toBeVisible();
    });
  });

  describe('变量捕获', () => {
    it('$var = current_url 捕获当前 URL', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        input "URL 捕获测试" to "label:申请标题"
        input "100" to "testid:amount-input"
        tap "role:button[提交申请]"
        $workflow_url = current_url
      `, page, ctx, {});

      const capturedUrl = ctx.get('workflow_url') as string;
      expect(capturedUrl).toContain('workflow');
    });

    it('$var = url_match 提取 URL 路径段', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        input "URL Match 测试" to "label:申请标题"
        input "200" to "testid:amount-input"
        tap "role:button[提交申请]"
        $workflow_id = url_match "/workflow/([\\w-]+)"
      `, page, ctx, {});

      const wfId = ctx.get('workflow_id') as string;
      expect(wfId).toMatch(/^wf-[a-z0-9]+$/);
    });

    it('$var = "testid:xxx" 从元素提取文字', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        input "元素提取测试" to "label:申请标题"
        input "300" to "testid:amount-input"
        tap "role:button[提交申请]"
        $wf_id = "testid:workflow-id"
      `, page, ctx, {});

      const wfId = ctx.get('wf_id') as string;
      expect(wfId).toMatch(/^wf-/);
    });
  });

  describe('assert_exists — 断言', () => {
    it('断言元素存在', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        input "断言测试" to "label:申请标题"
        input "500" to "testid:amount-input"
        tap "role:button[提交申请]"
        assert_exists "申请已提交" 5s
      `, page, ctx, {});
      // 不抛出即为通过
    });

    it('断言模糊匹配元素存在', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        input "断言测试" to "label:申请标题"
        input "500" to "testid:amount-input"
        tap "role:button[提交申请]"
        assert_exists "*已提交*" 5s
      `, page, ctx, {});
    });

    it('断言不存在 — loading 消失', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        assert_not_exists "加载中" 3s
      `, page, ctx, {});
    });

    it('? 可选断言失败不中断流程', async () => {
      const ctx = makeCtx();
      await expect(executeScript(`
        open "$base_url"
        ? assert_exists "不存在的元素" 1s
        assert_exists "工作流申请表单" 3s
      `, page, ctx, {})).resolves.not.toThrow();
    });

    it('断言成功时自动截图', async () => {
      const ctx = makeCtx();
      const tempDir = path.join(import.meta.dirname, '../../.temp-assert-screenshots');
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      await executeScript(`
        open "$base_url"
        assert_exists "工作流申请表单" 3s
      `, page, ctx, {
        screenshotOnAssert: true,
        screenshotDir: tempDir,
        stepId: 'test_assert_step',
      });

      const files = fs.readdirSync(tempDir);
      expect(files.length).toBe(1);
      expect(files[0]).toBe('工作流申请表单-test_assert_step.png');
      expect(files[0]?.endsWith('.png')).toBe(true);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('assert_url — URL 断言', () => {
    it('能够成功匹配精确完整的 URL', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url/workflow/invoice-123"
        assert_url "$base_url/workflow/invoice-123" 3s
      `, page, ctx, {});
    });

    it('能够成功匹配相对路径 URL (带或不带前导斜杠)', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url/workflow/invoice-123"
        assert_url "/workflow/invoice-123" 3s
        assert_url "workflow/invoice-123" 3s
      `, page, ctx, {});
    });

    it('能够成功进行 * 通配符模糊匹配', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url/workflow/invoice-123"
        assert_url "*/workflow/*" 3s
        assert_url "*invoice-123" 3s
      `, page, ctx, {});
    });

    it('能够成功匹配 Hash 路由部分', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url/#/dashboard/overview"
        assert_url "#/dashboard/overview" 3s
        assert_url "/#/dashboard/overview" 3s
        assert_url "*#/dashboard/*" 3s
      `, page, ctx, {});
    });

    it('如果 URL 不匹配应抛出错误', async () => {
      const ctx = makeCtx();
      await expect(executeScript(`
        open "$base_url/workflow/invoice-123"
        assert_url "/wrong-path" 1s
      `, page, ctx, {})).rejects.toThrow('assert_url failed');
    });
  });

  describe('check — 复选框', () => {
    it('勾选复选框', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        check "加急申请"
      `, page, ctx, {});
      const checked = await page.getByTestId('urgent-checkbox').isChecked();
      expect(checked).toBe(true);
    });
  });

  describe('变量插值', () => {
    it('URL 中的变量被正确替换 (支持无引号与有引号两种形式)', async () => {
      const ctx = makeCtx();
      ctx.set('sub_path', '');
      // 1. 测试无引号变量
      await executeScript(`open $base_url`, page, ctx, {});
      expect(page.url()).toContain('127.0.0.1');

      // 2. 测试有引号变量
      await executeScript(`open "$base_url"`, page, ctx, {});
      expect(page.url()).toContain('127.0.0.1');
    });

    it('能够正确补全相对路径 URL (如果设置了 base_url)', async () => {
      const ctx = makeCtx();
      // 1. 以 / 开头的相对路径
      await executeScript(`open "/workflow/invoice-123"`, page, ctx, {});
      expect(page.url()).toContain('/workflow/invoice-123');

      // 2. 不以 / 开头的相对路径
      await executeScript(`open "workflow/invoice-123"`, page, ctx, {});
      expect(page.url()).toContain('/workflow/invoice-123');
    });

    it('能够正确解析内置的日期时间变量并支持动态格式控制', async () => {
      const ctx = makeCtx();
      
      const format = (d: Date, f: string) => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        if (f === 'YYYY/MM/DD') return `${yyyy}/${mm}/${dd}`;
        return `${yyyy}-${mm}-${dd}`;
      };

      const todayStr = format(new Date(), 'YYYY-MM-DD');
      const tomorrowSlashStr = format(new Date(Date.now() + 24 * 3600 * 1000), 'YYYY/MM/DD');

      await executeScript(`
        open $base_url
        input $today to "label:申请标题"
        
        $date_format = "YYYY/MM/DD"
        input $today+1d to "testid:reason-input"
      `, page, ctx, {});

      const titleVal = await page.getByLabel('申请标题').inputValue();
      const reasonVal = await page.getByTestId('reason-input').inputValue();

      expect(titleVal).toBe(todayStr);
      expect(reasonVal).toBe(tomorrowSlashStr);
    });

    it('能够正确解析 role 自定义属性和跨角色嵌套变量', async () => {
      const ctx = makeCtx();
      ctx.set('roles', {
        requester: { id: '123', username: 'req', custom_field: 'my-value' },
        manager: { id: '345', username: 'mgr', custom_field: 'other-value' }
      });
      ctx.set('id', '123');
      ctx.set('username', 'req');
      ctx.set('custom_field', 'my-value');

      await executeScript(`
        open "$base_url"
        input "$id" to "label:申请标题"
        input "$roles.manager.custom_field" to "testid:reason-input"
      `, page, ctx, {});

      const titleVal = await page.getByLabel('申请标题').inputValue();
      const reasonVal = await page.getByTestId('reason-input').inputValue();

      expect(titleVal).toBe('123');
      expect(reasonVal).toBe('other-value');
    });
  });

  describe('完整工作流场景', () => {
    it('提交 → 获取 ID → 审批通过', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        input "完整流程集成测试" to "label:申请标题"
        input "88888" to "testid:amount-input"
        input "集成测试原因" to "testid:reason-input"
        check "加急申请"
        tap "role:button[提交申请]"

        $workflow_url = current_url
        $workflow_id  = url_match "/workflow/([\\w-]+)"

        assert_exists "申请已提交" 5s

        tap "role:button[审批通过]"
        assert_exists "审批完成" 5s
      `, page, ctx, {});

      expect(ctx.get('workflow_id')).toMatch(/^wf-/);
      const statusBadge = page.getByTestId('workflow-status');
      await pwExpect(statusBadge).toHaveText('已审批');
    });
  });
});
