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

    it('支持 fast 模式快速跳过网络空闲等待', async () => {
      const ctx = makeCtx();
      const start = Date.now();
      await executeScript(`open "$base_url" fast`, page, ctx, {});
      const duration = Date.now() - start;
      // 快速模式不应触发 500ms 的网络空闲稳定延迟，通常在几十毫秒内返回
      expect(duration).toBeLessThan(1000);
    });

    it('支持指定自定义网络超时时间', async () => {
      const ctx = makeCtx();
      await executeScript(`open "$base_url" 1.5s`, page, ctx, {});
      expect(page.url()).toContain('127.0.0.1');
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

  describe('near — 近邻定位修饰符', () => {
    it('基础 near 定位：区分相同文本的按钮', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        tap "删除" near "张三"
      `, page, ctx, {});
      const resVal = await page.locator('#near-result').textContent();
      expect(resVal).toBe('张三 - 删除');

      await executeScript(`
        tap "删除" near "李四"
      `, page, ctx, {});
      const resVal2 = await page.locator('#near-result').textContent();
      expect(resVal2).toBe('李四 - 删除');
    });

    it('双锚点 & 方向定位', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        tap "编辑" near "李四" right
      `, page, ctx, {});
      const resVal = await page.locator('#near-result').textContent();
      expect(resVal).toBe('李四 - 编辑');
    });

    it('基于角度的方向过滤定位', async () => {
      const ctx = makeCtx();
      // 测试右边按钮
      await executeScript(`
        open "$base_url"
        tap "目标" near "中心" right
      `, page, ctx, {});
      expect(await page.locator('#near-result').textContent()).toBe('右边按钮');

      // 测试左边按钮
      await executeScript(`
        tap "目标" near "中心" left
      `, page, ctx, {});
      expect(await page.locator('#near-result').textContent()).toBe('左边按钮');

      // 测试上边按钮
      await executeScript(`
        tap "目标" near "中心" top
      `, page, ctx, {});
      expect(await page.locator('#near-result').textContent()).toBe('上边按钮');

      // 测试下边按钮
      await executeScript(`
        tap "目标" near "中心" bottom
      `, page, ctx, {});
      expect(await page.locator('#near-result').textContent()).toBe('下边按钮');
    });

    it('Modal 遮挡 reachability 可达性检测过滤', async () => {
      const ctx = makeCtx();
      // 1. 未打开 Modal 时点击确认，应该点击到背景确认
      await executeScript(`
        open "$base_url"
        tap "确认" near "加急申请"
      `, page, ctx, {});
      expect(await page.locator('#near-result').textContent()).toBe('背景确认');

      // 2. 打开 Modal 后点击确认，背景确认虽然离加急申请近但被遮挡，应该点击 Modal 确认
      await executeScript(`
        tap "打开Modal"
        tap "确认" near "用户名"
      `, page, ctx, {});
      expect(await page.locator('#near-result').textContent()).toBe('Modal确认');
    });
  });

  describe('含斜杠 / 的定位器与修饰符', () => {
    it('应该正确点击包含斜杠的文字定位和带有索引修饰符的点击', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        tap "name/id"/0
      `, page, ctx, {});
      expect(await page.locator('#near-result').textContent()).toBe('点击了第一个按钮');

      await executeScript(`
        open "$base_url"
        tap "name/id"/-1
      `, page, ctx, {});
      expect(await page.locator('#near-result').textContent()).toBe('点击了第二个按钮');
    });

    it('应该正确输入到包含斜杠的输入框中，并支持修饰符', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        input "hello_first" to "please user by name/id"/0
      `, page, ctx, {});
      expect(await page.locator('#near-result').textContent()).toBe('输入了第一个: hello_first');

      await executeScript(`
        open "$base_url"
        input "hello_second" to "please user by name/id"/-1
      `, page, ctx, {});
      expect(await page.locator('#near-result').textContent()).toBe('输入了第二个: hello_second');
    });
  });

  describe('css: 和 xpath: 前缀定位器', () => {
    it('应该能够正确通过 css: 前缀和 xpath: 前缀定位并操作元素', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        tap "css:#open-modal-btn"
      `, page, ctx, {});
      expect(await page.locator('#test-modal').isVisible()).toBe(true);

      await executeScript(`
        tap "xpath://button[@id='close-modal-btn']"
      `, page, ctx, {});
      expect(await page.locator('#test-modal').isVisible()).toBe(false);
    });

    it('应该能够正确通过 css:input 和 css:textarea 定位输入框并填充内容', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        input "测试标题内容" to "css:input#title-input"
        input "测试原因内容" to "css:textarea#reason-input"
      `, page, ctx, {});
      expect(await page.locator('#title-input').inputValue()).toBe('测试标题内容');
      expect(await page.locator('#reason-input').inputValue()).toBe('测试原因内容');

      // 清空并使用 index 索引修饰符进行测试
      await executeScript(`
        input "索引输入标题" to "css:input"/0
        input "索引输入原因" to "css:textarea"/0
      `, page, ctx, {});
      expect(await page.locator('#title-input').inputValue()).toBe('索引输入标题');
      expect(await page.locator('#reason-input').inputValue()).toBe('索引输入原因');
    });

    it('应该能够正确通过包含斜杠的 near 锚点定位元素', async () => {
      const ctx = makeCtx();
      // 1. 使用 placeholder: 前缀包含斜杠作为近邻锚点
      await executeScript(`
        open "$base_url"
        input "测试输入斜杠内容" to "css:input" near "placeholder:please user by name/id"
      `, page, ctx, {});
      expect(await page.locator('#slash-input-1').inputValue()).toBe('测试输入斜杠内容');

      // 2. 使用纯文本包含斜杠作为近邻锚点
      await executeScript(`
        open "$base_url"
        tap "css:button.slash-btn" near "name/id"
      `, page, ctx, {});
      expect(await page.locator('#near-result').textContent()).toBe('点击了第一个按钮');
    });
  });

  describe('可选指令的执行控制流（? 语法增强）', () => {
    it('可选断言指令报错时，应该只跳过本身并继续执行后续指令', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        ? assert_exists "non_existent_text_xyz" 1s
        tap "打开Modal"
      `, page, ctx, {});
      expect(await page.locator('#test-modal').isVisible()).toBe(true);
      await page.locator('#close-modal-btn').click();
    });

    it('可选操作指令报错时，应该跳过当前 step 的剩余所有指令', async () => {
      const ctx = makeCtx();
      await executeScript(`
        open "$base_url"
        ? tap "non_existent_btn_abc"
        tap "打开Modal"
      `, page, ctx, {});
      expect(await page.locator('#test-modal').isVisible()).toBe(false);
    });
  });

  describe('assertTimeout — 全局/定制超时覆盖规则', () => {
    it('当配置了 assertTimeout 时，不带时间参数的断言应使用该默认超时时长', async () => {
      const ctx = makeCtx();
      await executeScript(`open "$base_url"`, page, ctx, {});
      const start = Date.now();
      let err: any;
      try {
        await executeScript(`assert_exists "non_existent_text_xyz"`, page, ctx, {
          assertTimeout: '600ms',
        });
      } catch (e) {
        err = e;
      }
      const duration = Date.now() - start;
      expect(err).toBeDefined();
      expect(err.message).toContain('toBeVisible');
      expect(duration).toBeLessThan(2500); // 应该由 600ms 决定，远小于默认的 5000ms
    });

    it('行内指定的超时应该覆盖全局 assertTimeout 配置', async () => {
      const ctx = makeCtx();
      await executeScript(`open "$base_url"`, page, ctx, {});
      const start = Date.now();
      let err: any;
      try {
        await executeScript(`assert_exists "non_existent_text_xyz" 300ms`, page, ctx, {
          assertTimeout: '8s',
        });
      } catch (e) {
        err = e;
      }
      const duration = Date.now() - start;
      expect(err).toBeDefined();
      expect(duration).toBeLessThan(3000); // 应该由 300ms 决定，远小于 8s
    });
  });

  describe('persistent_variables — 声明式长效持久化变量', () => {
    const tempCaseDir = path.join(process.cwd(), 'cases', 'temp-persist-test');
    const tempYamlPath = path.join(tempCaseDir, 'persist_test_case.yaml');
    const persistentJsonPath = path.join(process.cwd(), 'config', 'persistent', 'temp-persist-test', 'persist_test_case.json');

    beforeAll(() => {
      fs.mkdirSync(tempCaseDir, { recursive: true });
      const cpDir = path.join(process.cwd(), '.resumewright', 'temp-persist-test');
      if (fs.existsSync(cpDir)) {
        fs.rmSync(cpDir, { recursive: true, force: true });
      }
    });

    afterAll(() => {
      try {
        if (fs.existsSync(tempYamlPath)) fs.unlinkSync(tempYamlPath);
        if (fs.existsSync(tempCaseDir)) fs.rmdirSync(tempCaseDir);
        const cpDir = path.join(process.cwd(), '.resumewright', 'temp-persist-test');
        if (fs.existsSync(cpDir)) {
          fs.rmSync(cpDir, { recursive: true, force: true });
        }
        if (fs.existsSync(persistentJsonPath)) {
          fs.unlinkSync(persistentJsonPath);
          fs.rmdirSync(path.dirname(persistentJsonPath));
          fs.rmdirSync(path.dirname(path.dirname(persistentJsonPath)));
        }
      } catch (err) { /* ignore */ }
    });

    it('执行包含 persistent_variables 的用例应该自动将其写盘，并在二次执行时恢复', async () => {
      const { WorkflowRunner } = await import('../../src/engine/workflow-runner.js');
      
      // 1. 创建并执行写盘的用例
      const writeDef = {
        name: 'persist_test_case',
        persistent_variables: ['my_persist_token'],
        roles: { requester: { username: 'req', password: 'req' } },
        steps: [
          {
            id: 'step_save',
            role: 'requester',
            script: `$my_persist_token = "token_value_xyz"`,
          },
        ],
      };

      fs.writeFileSync(tempYamlPath, JSON.stringify(writeDef), 'utf-8');
      
      const runner1 = new WorkflowRunner(writeDef, tempYamlPath, { headless: true });
      const res1 = await runner1.run();
      expect(res1.status).toBe('passed');

      // 验证是否写盘成功
      expect(fs.existsSync(persistentJsonPath)).toBe(true);
      const savedData = JSON.parse(fs.readFileSync(persistentJsonPath, 'utf-8'));
      expect(savedData.my_persist_token).toBe('token_value_xyz');

      // 2. 创建并执行读盘校验的用例
      const readDef = {
        name: 'persist_test_case',
        persistent_variables: ['my_persist_token'],
        roles: { requester: { username: 'req', password: 'req' } },
        steps: [
          {
            id: 'step_verify',
            role: 'requester',
            script: `assert_text_equal "$my_persist_token" "token_value_xyz"`,
          },
        ],
      };

      const runner2 = new WorkflowRunner(readDef, tempYamlPath, { headless: true });
      const res2 = await runner2.run();
      expect(res2.status).toBe('passed');
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
