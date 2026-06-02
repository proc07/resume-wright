// ============================================================
// server.ts — Web Dashboard 微型服务端
// ============================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCase } from '../adapters/yaml-loader.js';
import { Checkpoint, listCheckpoints, resetAllCheckpoints, resetCaseRuntime, resetAllRuntimes } from '../engine/checkpoint.js';

// 获取当前目录路径（ESM 规范下替代 __dirname）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 缓存当前正在执行的进程及状态
let activeProcess: any = null;
const lastRunStatuses: Record<string, 'passed' | 'failed' | 'running'> = {};

const SETTINGS_FILE = path.join(process.cwd(), '.resumewright', 'dashboard-settings.json');

interface DashboardSettings {
  headed: boolean;
  trace: boolean;
  screenshotOnAssert: boolean;
}

function loadDashboardSettings(): DashboardSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[dashboard] Failed to load settings:', err);
  }
  return {
    headed: true,
    trace: true,
    screenshotOnAssert: true
  };
}

function markHistoryAsTerminated(caseName: string, exitCode: number | null): void {
  try {
    const safeCaseName = caseName.replace(/[/?<>\\:*|"]/g, '_');
    const historyFile = path.join('.resumewright', safeCaseName, 'history', 'history.json');
    if (fs.existsSync(historyFile)) {
      const history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
      let modified = false;
      for (const run of history) {
        if (run.status === 'running') {
          run.status = 'failed';
          run.error = `进程终止 (退出码: ${exitCode ?? '未知'})`;
          modified = true;
        }
      }
      if (modified) {
        fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf-8');
      }
    }
  } catch { /* ignore */ }
}

function saveDashboardSettings(settings: DashboardSettings): void {
  try {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('[dashboard] Failed to save settings:', err);
  }
}

export async function startDashboardServer(requestedPort: number): Promise<void> {
  const server = http.createServer(handleRequest);

  let port = requestedPort;
  const maxPortAttempts = 20;

  for (let attempt = 0; attempt < maxPortAttempts; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.listen(port, '127.0.0.1');
        server.once('listening', () => resolve());
        server.once('error', (err) => reject(err));
      });

      console.log(`\n==========================================================`);
      console.log(`  🚀 ResumeWright Dashboard running at: http://127.0.0.1:${port}/`);
      console.log(`==========================================================\n`);

      // 自动打开浏览器
      try {
        const openCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        spawn(openCmd, [`http://127.0.0.1:${port}/`]);
      } catch { /* ignore open browser errors */ }
      
      return;
    } catch (err: any) {
      if (err.code === 'EADDRINUSE') {
        port++;
      } else {
        throw err;
      }
    }
  }

  throw new Error(`Could not find a free port for Dashboard Server after ${maxPortAttempts} attempts.`);
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = url.pathname;

  // 允许跨域（本地调试用）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── REST API: GET /api/cases — 获取用例列表 ──
  if (pathname === '/api/cases' && req.method === 'GET') {
    try {
      const casesDir = path.resolve(process.cwd(), 'cases');
      if (!fs.existsSync(casesDir)) {
        return jsonRes(res, 200, { cases: [] });
      }

      const { default: fg } = await import('fast-glob');
      const pattern = path.join(casesDir, '**/*.{yaml,yml}').replace(/\\/g, '/');
      const files = await fg(pattern);
      const checkpoints = listCheckpoints();

      const cases = files.map((file) => {
        const filePath = path.resolve(file);
        const relativePath = path.relative(process.cwd(), file).replace(/\\/g, '/');
        try {
          const definition = loadCase(filePath);
          const cp = new Checkpoint(definition.name);
          cp.load();

          // 结合内存中最后运行的状态
          const completed = cp.completedCount();
          const total = definition.steps.length;
          let status: 'passed' | 'failed' | 'paused' | 'never_run' | 'running' = 'never_run';

          if (completed === total && total > 0) {
            status = 'passed';
          } else if (lastRunStatuses[definition.name] === 'running') {
            status = 'running';
          } else if (lastRunStatuses[definition.name] === 'failed') {
            status = 'failed';
          } else if (completed > 0) {
            status = 'paused';
          }

          return {
            name: definition.name,
            description: definition.description || '',
            filePath: relativePath,
            steps: definition.steps.map((s) => ({
              id: s.id,
              role: s.role,
              completed: cp.isCompleted(s.id),
              subStepsCount: s.sub_steps?.length || 0,
            })),
            status,
            completedCount: cp.completedCount(),
            totalSteps: definition.steps.length,
          };
        } catch (err) {
          return {
            name: path.basename(file),
            description: `解析失败: ${String(err)}`,
            filePath: relativePath,
            steps: [],
            status: 'failed',
            completedCount: 0,
            totalSteps: 0,
          };
        }
      });

      return jsonRes(res, 200, { cases });
    } catch (err: any) {
      return jsonRes(res, 500, { error: err.message });
    }
  }

  // ── REST API: GET /api/settings — 获取设置 ──
  if (pathname === '/api/settings' && req.method === 'GET') {
    try {
      const settings = loadDashboardSettings();
      return jsonRes(res, 200, settings);
    } catch (err: any) {
      return jsonRes(res, 500, { error: err.message });
    }
  }

  // ── REST API: POST /api/settings — 保存设置 ──
  if (pathname === '/api/settings' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const settings = {
        headed: !!body.headed,
        trace: !!body.trace,
        screenshotOnAssert: !!body.screenshotOnAssert
      };
      saveDashboardSettings(settings);
      return jsonRes(res, 200, { success: true, settings });
    } catch (err: any) {
      return jsonRes(res, 500, { error: err.message });
    }
  }

  // ── REST API: GET /api/case/:caseName/details — 获取单用例详情 ──
  if (pathname.startsWith('/api/case/') && pathname.endsWith('/details') && req.method === 'GET') {
    try {
      const segments = pathname.split('/');
      const encodedCaseName = segments[3];
      if (!encodedCaseName) return jsonRes(res, 400, { error: 'Missing caseName' });

      const caseName = decodeURIComponent(encodedCaseName);
      const safeCaseName = caseName.replace(/[/?<>\\:*|"]/g, '_');
      const caseDir = path.join('.resumewright', safeCaseName);

      // 读取 screenshots
      const screenshots: string[] = [];
      const ssDir = path.join(caseDir, 'screenshots');
      if (fs.existsSync(ssDir)) {
        try {
          fs.readdirSync(ssDir)
            .filter((f) => f.endsWith('.png'))
            .forEach((f) => screenshots.push(`/api/screenshots/${encodedCaseName}/${f}`));
        } catch { /* ignore */ }
      }

      // 读取 traces
      const traces: string[] = [];
      const tracesDir = path.join(caseDir, 'traces');
      if (fs.existsSync(tracesDir)) {
        try {
          fs.readdirSync(tracesDir)
            .filter((f) => f.endsWith('.zip'))
            .forEach((f) => traces.push(f));
        } catch { /* ignore */ }
      }

      // 读取 sub-steps 状态
      const subStepsData: Record<string, any> = {};
      const subStepsDir = path.join(caseDir, 'sub-steps');
      if (fs.existsSync(subStepsDir)) {
        try {
          const stepDirs = fs.readdirSync(subStepsDir);
          for (const sDir of stepDirs) {
            const statePath = path.join(subStepsDir, sDir, 'state.json');
            if (fs.existsSync(statePath)) {
              try {
                subStepsData[sDir] = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
              } catch { /* ignore */ }
            }
          }
        } catch { /* ignore */ }
      }

      return jsonRes(res, 200, {
        caseName,
        screenshots,
        subSteps: subStepsData,
        traces,
      });
    } catch (err: any) {
      return jsonRes(res, 500, { error: err.message });
    }
  }

  // ── REST API: GET /api/case/:caseName/history — 获取运行历史记录 ──
  if (pathname.startsWith('/api/case/') && pathname.endsWith('/history') && req.method === 'GET') {
    try {
      const segments = pathname.split('/');
      const encodedCaseName = segments[3];
      if (!encodedCaseName) return jsonRes(res, 400, { error: 'Missing caseName' });

      const caseName = decodeURIComponent(encodedCaseName);
      const safeCaseName = caseName.replace(/[/?<>\\:*|"]/g, '_');
      const historyFile = path.join('.resumewright', safeCaseName, 'history', 'history.json');

      if (fs.existsSync(historyFile)) {
        const data = fs.readFileSync(historyFile, 'utf-8');
        return jsonRes(res, 200, JSON.parse(data));
      }
      return jsonRes(res, 200, []);
    } catch (err: any) {
      return jsonRes(res, 500, { error: err.message });
    }
  }

  // ── REST API: GET /api/case/:caseName/history/:runId/log — 获取特定运行日志 ──
  if (pathname.startsWith('/api/case/') && pathname.includes('/history/') && pathname.endsWith('/log') && req.method === 'GET') {
    try {
      const segments = pathname.split('/');
      const encodedCaseName = segments[3];
      const runId = segments[5];
      if (!encodedCaseName || !runId) return jsonRes(res, 400, { error: 'Missing caseName or runId' });

      const caseName = decodeURIComponent(encodedCaseName);
      const safeCaseName = caseName.replace(/[/?<>\\:*|"]/g, '_');
      const logFile = path.join('.resumewright', safeCaseName, 'history', `${runId}.log`);

      if (fs.existsSync(logFile)) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        fs.createReadStream(logFile).pipe(res);
        return;
      }
      return jsonRes(res, 404, { error: 'Log file not found' });
    } catch (err: any) {
      return jsonRes(res, 500, { error: err.message });
    }
  }

  // ── REST API: POST /api/reset — 重置 Checkpoint ──
  if (pathname === '/api/reset' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (body.all) {
        resetAllRuntimes();
        // 清除内存缓存
        for (const k of Object.keys(lastRunStatuses)) {
          delete lastRunStatuses[k];
        }
        return jsonRes(res, 200, { success: true, message: 'All checkpoints and runtime directories reset (history preserved)' });
      }

      if (body.caseName) {
        const cp = new Checkpoint(body.caseName);
        cp.reset();
        delete lastRunStatuses[body.caseName];
        // 清空其所在的 caseRuntimeDir 下的 screenshots 等，保留 history 目录
        const safeCaseName = body.caseName.replace(/[/?<>\\:*|"]/g, '_');
        const caseDir = path.join('.resumewright', safeCaseName);
        resetCaseRuntime(caseDir);

        return jsonRes(res, 200, { success: true, message: `Reset case: ${body.caseName} (history preserved)` });
      }

      return jsonRes(res, 400, { error: 'Provide caseName or all: true' });
    } catch (err: any) {
      return jsonRes(res, 500, { error: err.message });
    }
  }

  // ── Server-Sent Events (SSE): GET /api/run-stream — 执行流式日志 ──
  if (pathname === '/api/run-stream' && req.method === 'GET') {
    const caseFiles = url.searchParams.get('cases')?.split(',') || [];
    const headed = url.searchParams.get('headed') === 'true';
    const trace = url.searchParams.get('trace') === 'true';
    const screenshotOnAssert = url.searchParams.get('screenshotOnAssert') === 'true';

    if (caseFiles.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No cases selected' }));
      return;
    }

    if (activeProcess) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Another runner is already active' }));
      return;
    }

    // 设置 SSE Header
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // 解析运行脚本文件名是 .ts 还是 .js
    const runScript = process.argv[1]!;
    const isTs = runScript.endsWith('.ts');

    const cmdArgs = isTs ? [runScript, 'run'] : [runScript, 'run'];
    // 添加用例路径
    cmdArgs.push(...caseFiles);

    if (headed) {
      cmdArgs.push('--headed');
    }
    if (trace) {
      cmdArgs.push('--trace');
    }
    if (screenshotOnAssert) {
      cmdArgs.push('--screenshot-on-assert');
    }

    const command = isTs ? 'npx' : 'node';
    const finalArgs = isTs ? ['tsx', ...cmdArgs] : cmdArgs;

    // 标记状态为 running
    caseFiles.forEach((f) => {
      try {
        const absolute = path.resolve(process.cwd(), f);
        const def = loadCase(absolute);
        lastRunStatuses[def.name] = 'running';
      } catch { /* ignore */ }
    });

    sendEvent('log', { text: `[system] Starting process: ${command} ${finalArgs.join(' ')}\n` });

    const proc = spawn(command, finalArgs, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '1' }, // 保持彩色输出
    });
    activeProcess = proc;

    let buffer = '';
    const handleLogData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const match = line.match(/^\[case:([^\]]+)\](.*)$/);
        if (match) {
          const safeCaseName = match[1]!;
          const text = match[2]!;
          sendEvent('log', { case: safeCaseName, text: text + '\n' });
        } else {
          sendEvent('log', { text: line + '\n' });
        }
      }
    };

    proc.stdout.on('data', handleLogData);
    proc.stderr.on('data', handleLogData);

    proc.on('close', (code) => {
      if (buffer) {
        const match = buffer.match(/^\[case:([^\]]+)\](.*)$/);
        if (match) {
          sendEvent('log', { case: match[1]!, text: match[2]! });
        } else {
          sendEvent('log', { text: buffer });
        }
      }
      activeProcess = null;
      const status = code === 0 ? 'passed' : 'failed';

      // 刷新用例状态
      caseFiles.forEach((f) => {
        try {
          const absolute = path.resolve(process.cwd(), f);
          const def = loadCase(absolute);
          lastRunStatuses[def.name] = status;
          markHistoryAsTerminated(def.name, code);
        } catch { /* ignore */ }
      });

      sendEvent('finish', { exitCode: code, status });
      res.end();
    });

    req.on('close', () => {
      if (activeProcess === proc) {
        console.log('[dashboard] Client disconnected, killing process...');
        proc.kill();
        activeProcess = null;
      }
    });

    return;
  }

  // ── POST /api/stop — 终止当前正在运行的测试 ──
  if (pathname === '/api/stop' && req.method === 'POST') {
    if (activeProcess) {
      activeProcess.kill();
      activeProcess = null;
      // 重置所有 running 状态为 failed并标记运行历史为终止
      for (const k of Object.keys(lastRunStatuses)) {
        if (lastRunStatuses[k] === 'running') {
          lastRunStatuses[k] = 'failed';
          markHistoryAsTerminated(k, -1);
        }
      }
      return jsonRes(res, 200, { success: true, message: 'Process terminated' });
    }
    return jsonRes(res, 200, { success: false, message: 'No process is currently running' });
  }

  // ── POST /api/play-trace — 运行 Playwright show-trace ──
  if (pathname === '/api/play-trace' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { caseName, traceFile } = body;
      if (!caseName || !traceFile) {
        return jsonRes(res, 400, { error: 'Missing caseName or traceFile' });
      }

      const safeCaseName = caseName.replace(/[/?<>\\:*|"]/g, '_');
      const tracePath = path.join('.resumewright', safeCaseName, 'traces', traceFile);

      if (!fs.existsSync(tracePath)) {
        return jsonRes(res, 404, { error: 'Trace file not found' });
      }

      // 异步执行 npx playwright show-trace <tracePath>
      const proc = spawn('npx', ['playwright', 'show-trace', tracePath], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();

      return jsonRes(res, 200, { success: true, message: `Launching trace viewer for ${traceFile}` });
    } catch (err: any) {
      return jsonRes(res, 500, { error: err.message });
    }
  }

  // ── 静态资源映射: 错误截图预览 ──
  if (pathname.startsWith('/api/screenshots/') && req.method === 'GET') {
    try {
      const segments = pathname.split('/');
      const encodedCaseName = segments[3];
      const fileName = segments[4];

      if (!encodedCaseName || !fileName) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const caseName = decodeURIComponent(encodedCaseName);
      const safeCaseName = caseName.replace(/[/?<>\\:*|"]/g, '_');
      const decodedFileName = decodeURIComponent(fileName);
      const filePath = path.join('.resumewright', safeCaseName, 'screenshots', decodedFileName);

      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    } catch { /* ignore */ }

    res.writeHead(404);
    res.end('Not found');
    return;
  }

  // ── 静态资源托管: UI Dashboard 前端网页 ──
  let fileRelativePath = pathname;
  if (pathname === '/' || pathname === '/index.html') {
    fileRelativePath = '/index.html';
  }

  let staticFilePath = path.join(__dirname, 'assets', fileRelativePath.slice(1));
  if (!fs.existsSync(staticFilePath)) {
    // 兼容从 dist/src/dashboard/server.js 运行时寻找 src/dashboard/assets/ 的相对路径
    staticFilePath = path.join(__dirname, '../../../src/dashboard/assets', fileRelativePath.slice(1));
  }

  if (fs.existsSync(staticFilePath) && !fs.statSync(staticFilePath).isDirectory()) {
    const ext = path.extname(staticFilePath);
    let contentType = 'text/plain';
    if (ext === '.html') contentType = 'text/html; charset=utf-8';
    else if (ext === '.css') contentType = 'text/css';
    else if (ext === '.js') contentType = 'application/javascript';
    else if (ext === '.ico') contentType = 'image/x-icon';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    fs.createReadStream(staticFilePath).pipe(res);
    return;
  }

  // ── Route fallback
  res.writeHead(404);
  res.end('Not Found');
}

// ── 辅助解析函数 ──────────────────────────────────────────────

function jsonRes(res: http.ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (err) {
        reject(err);
      }
    });
  });
}
