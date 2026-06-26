import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { chromium, type Browser, type Page, type BrowserContext } from '@playwright/test';
import { ContextStore } from '../../src/engine/context-store.js';
import { executeScript } from '../../src/dsl/executor.js';

let server: http.Server;
let baseUrl: string;
let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Wait API Test</title></head>
        <body>
          <button id="btn-trigger" onclick="triggerApi()">Trigger API</button>
          <button id="btn-trigger-parallel" onclick="triggerParallelApis()">Trigger Parallel APIs</button>
          <script>
            function triggerApi() {
              setTimeout(() => {
                fetch('/api/submit');
              }, 50);
            }
            function triggerParallelApis() {
              setTimeout(() => {
                fetch('/api/parallel?q=1');
                fetch('/api/parallel?q=2');
                fetch('/api/parallel?q=3');
              }, 50);
            }
          </script>
        </body>
        </html>
      `);
    } else if (req.url?.startsWith('/api/submit')) {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      }, 100);
    } else if (req.url?.startsWith('/api/parallel')) {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      }, 100);
    } else if (req.url?.startsWith('/api/already')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
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

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  page = await context.newPage();
});

afterAll(async () => {
  await context.close();
  await browser.close();
  server.close();
});

describe('wait_api DSL 指令集成测试', () => {

  it('should wait for a future request to complete', async () => {
    const ctx = new ContextStore();
    ctx.set('base_url', baseUrl);

    await executeScript(`
      open "$base_url"
      tap "css:#btn-trigger"
      wait_api "/api/submit" 5s 100ms
    `, page, ctx, {});
  });

  it('should support wildcard matching and partial paths', async () => {
    const ctx = new ContextStore();
    ctx.set('base_url', baseUrl);

    // 测试部分路径匹配
    await executeScript(`
      open "$base_url"
      tap "css:#btn-trigger"
      wait_api "submit" 5s 100ms
    `, page, ctx, {});

    // 测试通配符匹配
    await executeScript(`
      open "$base_url"
      tap "css:#btn-trigger"
      wait_api "*/api/sub*" 5s 100ms
    `, page, ctx, {});
  });

  it('should wait for all parallel in-flight matching requests', async () => {
    const ctx = new ContextStore();
    ctx.set('base_url', baseUrl);

    const start = Date.now();
    await executeScript(`
      open "$base_url"
      tap "css:#btn-trigger-parallel"
      wait_api "/api/parallel" 5s 100ms
    `, page, ctx, {});
    const elapsed = Date.now() - start;
    // 触发延时 50ms，请求执行 100ms，渲染额外等待 100ms，总耗时应至少大于等于 250ms
    expect(elapsed).toBeGreaterThanOrEqual(230);
  });

  it('should directly pass if request already completed', async () => {
    const ctx = new ContextStore();
    ctx.set('base_url', baseUrl);

    // 第一回触发并等待
    await executeScript(`
      open "$base_url"
      execute_script
      """
      fetch('/api/already')
      """
      wait_api "/api/already" 5s 100ms
    `, page, ctx, {});

    // 第二回再次执行 wait_api，应检测到已在当前会话完成并秒过，总延迟约等于 100ms 渲染等待
    const start = Date.now();
    await executeScript(`
      wait_api "/api/already" 5s 100ms
    `, page, ctx, {});
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(250);
  });

  it('should throw an error on timeout', async () => {
    const ctx = new ContextStore();
    ctx.set('base_url', baseUrl);

    await expect(executeScript(`
      open "$base_url"
      wait_api "/api/nonexistent" 300ms 100ms
    `, page, ctx, {})).rejects.toThrow(/Timeout/);
  });
});
