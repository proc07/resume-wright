// ============================================================
// demo/tests/integration/workflow.test.ts
//
// 真实项目演示：使用 resumewright 作为插件，对 demo-app.html
// 模拟完整的「采购申请 → 主管审批 → 财务确认」三角色工作流
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect as pwExpect, type Browser, type BrowserContext, type Page } from '@playwright/test';

// 以标准包名导入（与真实项目用法完全一致）
// vitest.config.ts 中的 alias 在开发时将其解析到 ../src/index.ts
// 生产环境安装发布包后，直接解析到 dist/index.js
import { executeScript, ContextStore, Checkpoint, loadCase } from 'resumewright';

// ════════════════════════════════════════════════════════════
//  服务端共享状态（跨 BrowserContext 共享）
// ════════════════════════════════════════════════════════════

interface Purchase {
  id: string;
  title: string;
  amount: number;
  reason: string;
  urgent: boolean;
  createdBy: string;
  status: 'pending_manager' | 'pending_finance' | 'approved' | 'rejected';
  mgrComment?: string;
  finComment?: string;
  createdAt: string;
}

const serverDB: { purchases: Record<string, Purchase> } = { purchases: {} };

// ════════════════════════════════════════════════════════════
//  HTTP 服务器（同时提供 HTML + REST API）
// ════════════════════════════════════════════════════════════

let server: http.Server;
let baseUrl: string;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

function jsonRes(res: http.ServerResponse, code: number, data: unknown) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function startServer(): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const pathname = url.pathname;

      // ── CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH', 'Access-Control-Allow-Headers': 'Content-Type' });
        res.end(); return;
      }

      // ── GET /api/purchases — 列表
      if (pathname === '/api/purchases' && req.method === 'GET') {
        return jsonRes(res, 200, Object.values(serverDB.purchases));
      }

      // ── POST /api/purchases — 创建
      if (pathname === '/api/purchases' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const id = 'PO-' + Date.now().toString(36).toUpperCase();
        const purchase: Purchase = {
          id, status: 'pending_manager', createdAt: new Date().toISOString(), ...body,
        };
        serverDB.purchases[id] = purchase;
        return jsonRes(res, 201, purchase);
      }

      // ── GET /api/purchases/:id
      if (pathname.startsWith('/api/purchases/') && req.method === 'GET') {
        const id = pathname.split('/')[3]!;
        const p = serverDB.purchases[id];
        if (!p) { res.writeHead(404); res.end('Not found'); return; }
        return jsonRes(res, 200, p);
      }

      // ── PATCH /api/purchases/:id — 更新状态
      if (pathname.startsWith('/api/purchases/') && req.method === 'PATCH') {
        const id = pathname.split('/')[3]!;
        const body = JSON.parse(await readBody(req));
        if (!serverDB.purchases[id]) { res.writeHead(404); res.end('Not found'); return; }
        Object.assign(serverDB.purchases[id]!, body);
        return jsonRes(res, 200, serverDB.purchases[id]);
      }

      // ── Serve HTML for all other routes
      if (pathname === '/near-demo') {
        const htmlPath = path.join(import.meta.dirname, 'fixtures/near-demo.html');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(htmlPath).pipe(res);
        return;
      }

      const htmlPath = path.join(import.meta.dirname, 'fixtures/demo-app.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(htmlPath).pipe(res);
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

// ════════════════════════════════════════════════════════════
//  浏览器设置（3 个独立 Context 模拟 3 个用户）
// ════════════════════════════════════════════════════════════

let browser: Browser;
let requesterCtx: BrowserContext;
let managerCtx: BrowserContext;
let financeCtx: BrowserContext;
let requesterPage: Page;
let managerPage: Page;
let financePage: Page;

beforeAll(async () => {
  baseUrl = await startServer();
  browser = await chromium.launch({ headless: true });
  requesterCtx  = await browser.newContext();
  managerCtx    = await browser.newContext();
  financeCtx    = await browser.newContext();
  requesterPage = await requesterCtx.newPage();
  managerPage   = await managerCtx.newPage();
  financePage   = await financeCtx.newPage();
});

afterAll(async () => {
  await requesterCtx.close();
  await managerCtx.close();
  await financeCtx.close();
  await browser.close();
  server.close();
});

function makeCtx(extra: Record<string, unknown> = {}): ContextStore {
  const ctx = new ContextStore();
  ctx.set('base_url', baseUrl);
  for (const [k, v] of Object.entries(extra)) ctx.set(k, v);
  return ctx;
}

// ════════════════════════════════════════════════════════════
//  套件 1：DSL 基础命令验证
// ════════════════════════════════════════════════════════════

describe('DSL 基础命令（插件用法验证）', () => {

  it('open + assert_exists：打开登录页', async () => {
    const ctx = makeCtx();
    await executeScript(`
      open "$base_url/login"
      assert_exists "用户登录" 5s
    `, requesterPage, ctx, {});
  });

  it('input + tap：登录为申请人', async () => {
    const ctx = makeCtx();
    await executeScript(`
      open "$base_url/login"
      input "requester" to "testid:login-username"
      input "req_pass"  to "testid:login-password"
      tap "role:button[登录]"
      assert_exists "已登录工作台" 5s
    `, requesterPage, ctx, {});
    await pwExpect(requesterPage.getByTestId('current-user')).toHaveText('张三（申请人）');
  });

  it('check：勾选加急复选框', async () => {
    const ctx = makeCtx();
    await executeScript(`
      open "$base_url/purchase/new"
      check "加急申请"
    `, requesterPage, ctx, {});
    expect(await requesterPage.getByTestId('purchase-urgent').isChecked()).toBe(true);
  });

  it('$var = current_url：捕获 URL', async () => {
    const ctx = makeCtx();
    await executeScript(`
      open "$base_url/dashboard"
      $current = current_url
    `, requesterPage, ctx, {});
    expect(ctx.get('current')).toContain('dashboard');
  });

  it('near — 近邻定位与可达性过滤', async () => {
    const ctx = makeCtx();
    await executeScript(`
      open "$base_url/near-demo"
      assert_exists "李四"
      
      # 1. 列表定位
      tap "编辑" near "李四"
      assert_exists "操作成功: 编辑了 李四"
      
      # 2. 方向定位
      tap "目标" near "中心点" right
      assert_exists "操作成功: 右侧目标按钮被点击"
      
      # 3. 模态层可达性过滤
      tap "打开模态框"
      input "admin" to "placeholder:请输入操作人账号"
      tap "确认" near "用户名"
      assert_exists "操作成功: 点击了弹窗里的 确认 按钮"

      # 4. 动态加载与高精度轴投影定位
      tap "开始加载 product-3 的图标"
      tap "图标" near "product - 3" right
      assert_exists "操作成功: 点击了 product-3 的图标"
    `, requesterPage, ctx, {});
  });
});

// ════════════════════════════════════════════════════════════
//  套件 2：完整三角色工作流
//  requesterCtx → managerCtx → financeCtx（共享服务端状态）
// ════════════════════════════════════════════════════════════

describe('完整工作流：申请人 → 主管 → 财务', () => {
  const sharedCtx = new ContextStore();

  it('Step 1 — 申请人：填写并提交采购申请', async () => {
    sharedCtx.set('base_url', baseUrl);
    await executeScript(`
      open "$base_url/login"
      input "requester" to "testid:login-username"
      input "req_pass"  to "testid:login-password"
      tap "role:button[登录]"
      assert_exists "已登录工作台" 5s

      open "$base_url/purchase/new"
      input "Q3 服务器采购"   to "label:申请标题"
      input "128000"           to "label:申请金额"
      input "扩容生产集群"     to "label:申请原因"
      check "加急申请"
      tap "role:button[提交申请]"

      assert_exists "采购申请详情" 5s

      $workflow_id  = url_match "/purchase/([A-Za-z0-9-]+)"
      $workflow_url = execute_script
      """
      return window.location.origin + window.location.pathname;
      """
    `, requesterPage, sharedCtx, {});

    const wfId  = sharedCtx.get('workflow_id') as string;
    const wfUrl = sharedCtx.get('workflow_url') as string;
    expect(wfId).toMatch(/^PO-/i);
    expect(wfUrl).toContain('/purchase/PO-');
    console.log(`    [workflow] ID=${wfId}  URL=${wfUrl}`);
  });

  it('Step 2 — 主管：审批通过', async () => {
    sharedCtx.set('base_url', baseUrl);
    await executeScript(`
      open "$base_url/login"
      input "manager"  to "testid:login-username"
      input "mgr_pass" to "testid:login-password"
      tap "role:button[登录]"
      assert_exists "已登录工作台" 5s

      open "$workflow_url"
      assert_exists "待主管审批" 5s
      input "预算合理，同意采购" to "label:审批意见"
      tap "role:button[审批通过]"
      assert_exists "审批完成" 5s
    `, managerPage, sharedCtx, {});

    await pwExpect(managerPage.getByTestId('purchase-status')).toHaveText('待财务审核');
  });

  it('Step 3 — 财务：确认通过', async () => {
    sharedCtx.set('base_url', baseUrl);
    await executeScript(`
      open "$base_url/login"
      input "finance"  to "testid:login-username"
      input "fin_pass" to "testid:login-password"
      tap "role:button[登录]"
      assert_exists "已登录工作台" 5s

      open "$workflow_url"
      assert_exists "待财务审核" 5s
      input "金额合规，财务确认" to "label:财务意见"
      tap "role:button[财务确认通过]"
      assert_exists "流程完成" 5s
    `, financePage, sharedCtx, {});

    await pwExpect(financePage.getByTestId('purchase-status')).toHaveText('已完成');
  });

  it('Step 4 — 申请人：确认流程已完成', async () => {
    sharedCtx.set('base_url', baseUrl);
    await executeScript(`
      open "$workflow_url"
      assert_exists "已完成" 5s
      $final_status = "testid:purchase-status"
      assert_text_equal "$final_status" "已完成"
    `, requesterPage, sharedCtx, {});

    expect(sharedCtx.get('final_status')).toBe('已完成');
  });
});

// ════════════════════════════════════════════════════════════
//  套件 3：Checkpoint 断点续跑演示
// ════════════════════════════════════════════════════════════

describe('Checkpoint 断点续跑演示', () => {
  const CASE_NAME = 'demo-checkpoint-test';
  const TMP_DIR = '/tmp/rw-demo-checkpoint';

  afterAll(() => { fs.rmSync(TMP_DIR, { recursive: true, force: true }); });

  it('Step 1 完成后崩溃，Step 2 从断点恢复', () => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const ctx1 = makeCtx();
    const cp = new Checkpoint(CASE_NAME, TMP_DIR);

    ctx1.set('workflow_url', `${baseUrl}/purchase/PO-DEMO`);
    ctx1.set('workflow_id', 'PO-DEMO');
    cp.markCompleted('step1_create', ctx1);

    // 模拟「崩溃重启」
    const ctx2 = new ContextStore();
    const resumed = new Checkpoint(CASE_NAME, TMP_DIR);
    resumed.load();
    resumed.restoreContext(ctx2);

    expect(resumed.isCompleted('step1_create')).toBe(true);
    expect(resumed.isCompleted('step2_manager')).toBe(false);
    expect(ctx2.get('workflow_url')).toContain('/purchase/');
    expect(ctx2.get('workflow_id')).toBe('PO-DEMO');
    console.log('    [checkpoint] Resume point:', resumed.getResumePoint());
  });
});

// ════════════════════════════════════════════════════════════
//  套件 4：YAML Case 文件校验
// ════════════════════════════════════════════════════════════

describe('YAML Case 文件验证（插件 loadCase API）', () => {
  const DIR = path.join(import.meta.dirname, '../../cases');

  it('purchase-approval.yaml 结构正确', () => {
    const def = loadCase(path.join(DIR, 'workflows/purchase-approval.yaml'));
    expect(def.name).toBe('purchase-approval');
    expect(def.steps).toHaveLength(4);
    expect(Object.keys(def.roles)).toEqual(['requester', 'manager', 'finance']);
  });

  it('near-demo.yaml 结构正确', () => {
    const def = loadCase(path.join(DIR, 'workflows/near-demo.yaml'));
    expect(def.name).toBe('near-demo');
    expect(def.steps).toHaveLength(1);
    expect(def.steps[0]!.script).toContain('near');
  });

  it('invoice-review-substeps.yaml 子步骤结构正确', () => {
    const def = loadCase(path.join(DIR, 'workflows/invoice/invoice-review-substeps.yaml'));
    expect(def.steps[0]!.sub_steps).toHaveLength(3);
    expect(def.steps[0]!.sub_steps![1]!.snapshot_before_submit).toBe(true);
  });

  it('use-step-test.yaml 结构展开与复用正确', () => {
    const def = loadCase(path.join(DIR, 'workflows/use-step-test.yaml'));
    expect(def.name).toBe('use-step-test');
    expect(def.steps).toHaveLength(6);
    // step 2 继承 step 1
    expect(def.steps[1]!.id).toBe('step2_login_reuse');
    expect(def.steps[1]!.role).toBe('requester');
    // step 3 有 3 个子步骤：两个本地，一个外部
    expect(def.steps[2]!.sub_steps).toHaveLength(3);
    expect(def.steps[2]!.sub_steps![0]!.id).toBe('fill_title_base');
    expect(def.steps[2]!.sub_steps![1]!.id).toBe('fill_title_reuse');
    expect(def.steps[2]!.sub_steps![2]!.id).toBe('submit_external');
    expect(def.steps[2]!.sub_steps![2]!.script).toContain('提交申请');
    // step 4 继承 manager_approve
    expect(def.steps[3]!.id).toBe('step4_manager_approve');
    expect(def.steps[3]!.role).toBe('manager');
    // step 4b is finance approve
    expect(def.steps[4]!.id).toBe('step4b_finance_approve');
    expect(def.steps[4]!.role).toBe('finance');
    // step 5 继承 verify_purchase_completed 并覆盖 role 为 requester
    expect(def.steps[5]!.id).toBe('step5_verify_completed');
    expect(def.steps[5]!.role).toBe('requester');
  });


  it('不存在的文件抛出有意义错误', () => {
    expect(() => loadCase('/nonexistent/path.yaml')).toThrow(/not found/i);
  });
});


