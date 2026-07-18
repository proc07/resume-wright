// ============================================================
// server.ts — Web Dashboard 微型服务端
// ============================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCase } from '../adapters/yaml-loader.js';
import { Checkpoint, listCheckpoints, resetAllCheckpoints, resetCaseRuntime, resetCaseKeepCache, resetAllRuntimes, getSafeCaseName } from '../engine/checkpoint.js';
import { createFingerprint } from '../engine/network-interceptor.js';
import fg from 'fast-glob';

// 获取当前目录路径（ESM 规范下替代 __dirname）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 缓存当前正在执行的进程及状态
let activeProcess: any = null;
let activeCaseFiles: string[] = [];
let activeSettings: any = null;
const activeClients = new Set<any>();
let activeLogsBuffer: Array<{ event: string; data: any }> = [];
const lastRunStatuses: Record<string, 'passed' | 'failed' | 'running' | 'never_run'> = {};

// 缓存 caseName -> safeCaseName 相对路径映射，避免重复扫描文件系统
const caseNameCache: Record<string, string> = {};



/**
 * 共享启动缓存是资源快照视图，而 api-requests.json 是逐次触发事件流。
 * Dashboard 按与缓存引擎相同的 fingerprint 折叠事件，同时保留 journal 原文件用于审计。
 */
function deduplicateSharedBootstrapEntries(entries: any[]): any[] {
  const resources = new Map<string, any>();
  for (const entry of entries) {
    const fingerprint = createFingerprint(entry.method, entry.url, true);
    const existing = resources.get(fingerprint);
    if (existing) {
      existing.fromCache = existing.fromCache === true || entry.fromCache === true;
      existing.cacheAvailable = existing.cacheAvailable === true || entry.cacheAvailable === true;
      continue;
    }

    const resource = { ...entry };
    delete resource.roleName;
    delete resource.occurrence;
    resources.set(fingerprint, resource);
  }
  return [...resources.values()];
}

function resolveSafeCaseName(caseName: string): string {
  if (caseNameCache[caseName]) {
    return caseNameCache[caseName];
  }

  const casesDir = path.resolve(process.cwd(), 'cases');
  if (fs.existsSync(casesDir)) {
    const pattern = path.join(casesDir, '**/*.{yaml,yml}').replace(/\\/g, '/');
    const files = fg.sync(pattern);
    for (const file of files) {
      try {
        const def = loadCase(file);
        const nameInFile = def.name;
        const filename = path.basename(file, path.extname(file));
        if (nameInFile === caseName || filename === caseName) {
          const safe = getSafeCaseName(caseName, file);
          caseNameCache[caseName] = safe;
          return safe;
        }
      } catch { /* ignore */ }
    }
  }

  // 兜底返回基本的安全名称
  return getSafeCaseName(caseName);
}

const SETTINGS_FILE = path.join(process.cwd(), '.resumewright', 'dashboard-settings.json');

interface DashboardSettings {
  headed: boolean;
  trace: boolean;
  screenshotOnAssert: boolean;
  apiCache: boolean;
  cacheGet: boolean;
  concurrency: number;
}

function loadDashboardSettings(): DashboardSettings {
  const defaults = {
    headed: true,
    trace: true,
    screenshotOnAssert: true,
    apiCache: true,
    cacheGet: true,
    concurrency: 3
  };
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return { ...defaults, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('[dashboard] Failed to load settings:', err);
  }
  return defaults;
}

function markHistoryAsTerminated(caseName: string, exitCode: number | null): void {
  try {
    const safeCaseName = resolveSafeCaseName(caseName);
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

export function getLocalNodeScript(...segments: string[]): string {
  const localPath = path.join(process.cwd(), ...segments);
  if (fs.existsSync(localPath)) {
    return localPath;
  }
  const parentPath = path.join(process.cwd(), '..', ...segments);
  if (fs.existsSync(parentPath)) {
    return parentPath;
  }
  return localPath;
}

export function openDashboardInBrowser(url: string): void {
  try {
    let proc;
    if (process.platform === 'win32') {
      proc = spawn('cmd', ['/c', 'start', url]);
    } else {
      const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
      proc = spawn(openCmd, [url]);
    }
    proc.on('error', (err) => {
      console.error('[dashboard] Failed to open browser automatically:', err);
    });
  } catch (err) {
    console.error('[dashboard] Error opening browser:', err);
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

      // 自动打开浏览器并进行错误监听以规避 Windows 兼容问题
      openDashboardInBrowser(`http://127.0.0.1:${port}/`);
      
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

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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
          const safeCaseName = getSafeCaseName(definition.name, filePath);
          const cp = new Checkpoint(definition.name, path.join('.resumewright', safeCaseName));
          cp.load();

          const durations = cp.getStepDurations();

          // 结合内存中最后运行的状态
          const completed = cp.completedCount();
          const total = definition.steps.length;
          let status: 'passed' | 'failed' | 'never_run' | 'running' = 'never_run';

          if (completed === total && total > 0) {
            status = 'passed';
          } else if (lastRunStatuses[definition.name] === 'running') {
            status = 'running';
          } else if (lastRunStatuses[definition.name] === 'failed') {
            status = 'failed';
          } else if (lastRunStatuses[definition.name] === 'never_run') {
            status = 'never_run';
          } else {
            // 从历史记录中恢复状态（如果内存中没有）
            let historicalStatus: string | null = null;
            try {
              const historyFile = path.join('.resumewright', safeCaseName, 'history', 'history.json');
              if (fs.existsSync(historyFile)) {
                const history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
                if (history && history.length > 0) {
                  historicalStatus = history[0].status;
                }
              }
            } catch { /* ignore */ }

            if (historicalStatus === 'failed' || completed > 0) {
              status = 'failed';
            }
          }

          let caseDuration = 0;
          let startTime: string | undefined;
          try {
            const historyFile = path.join('.resumewright', safeCaseName, 'history', 'history.json');
            if (fs.existsSync(historyFile)) {
              const history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
              if (history && history.length > 0) {
                if (history[0].status === 'running') {
                  startTime = history[0].timestamp;
                }
                caseDuration = history[0].duration || 0;
              }
            }
          } catch { /* ignore */ }

          if (!caseDuration) {
            caseDuration = Object.values(durations).reduce((sum, d) => sum + d, 0);
          }

          return {
            name: definition.name,
            description: definition.description || '',
            filePath: relativePath,
            safeCaseName,
            steps: definition.steps.map((s) => ({
              id: s.id,
              role: s.role,
              completed: cp.isCompleted(s.id),
              duration: durations[s.id] || 0,
              subStepsCount: s.sub_steps?.length || 0,
              isUseStep: s.is_use_step,
            })),
            status,
            completedCount: cp.completedCount(),
            totalSteps: definition.steps.length,
            duration: caseDuration,
            startTime,
          };
        } catch (err) {
          const safeCaseName = getSafeCaseName(path.basename(file), filePath);
          return {
            name: path.basename(file),
            description: `解析失败: ${String(err)}`,
            filePath: relativePath,
            safeCaseName,
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
       const parsedConcurrency = Number(body.concurrency);
      const concurrency = isNaN(parsedConcurrency)
        ? 3
        : Math.max(1, Math.min(10, parsedConcurrency));

      const settings = {
        headed: !!body.headed,
        trace: !!body.trace,
        screenshotOnAssert: !!body.screenshotOnAssert,
        apiCache: body.apiCache !== false,
        cacheGet: body.apiCache !== false,
        concurrency
      };
      saveDashboardSettings(settings);
      return jsonRes(res, 200, { success: true, settings });
    } catch (err: any) {
      return jsonRes(res, 500, { error: err.message });
    }
  }

  // ── REST API: POST /api/theme/sync — 同步配色到 VS Code settings.json ──
  if (pathname === '/api/theme/sync' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const rules = body.rules;
      if (!Array.isArray(rules)) {
        return jsonRes(res, 400, { error: 'rules must be an array' });
      }

      const getWorkspaceRoot = (): string => {
        let dir = process.cwd();
        while (true) {
          if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
            return dir;
          }
          const parent = path.dirname(dir);
          if (parent === dir) break;
          dir = parent;
        }
        return process.cwd();
      };

      const workspaceRoot = getWorkspaceRoot();
      const settingsPath = path.resolve(workspaceRoot, '.vscode', 'settings.json');
      const settingsDir = path.dirname(settingsPath);
      if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
      }

      let settingsObj: Record<string, any> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          const rawContent = fs.readFileSync(settingsPath, 'utf-8').trim();
          if (rawContent) {
            // 去除单行/多行注释以支持标准的 VS Code settings.json 语法解析
            const cleanJson = rawContent.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
            settingsObj = JSON.parse(cleanJson);
          }
        } catch (err) {
          console.warn(`[server] Warning: Failed to parse existing settings.json: ${err}`);
        }
      }

      settingsObj['editor.tokenColorCustomizations'] = {
        textMateRules: rules
      };

      fs.writeFileSync(settingsPath, JSON.stringify(settingsObj, null, 2), 'utf-8');
      console.log(`[server] Successfully synchronized DSL theme colors to ${settingsPath}`);
      return jsonRes(res, 200, { success: true });
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
      const safeCaseName = resolveSafeCaseName(caseName);
      const caseDir = path.join('.resumewright', safeCaseName);

      // 读取最新的 error 信息和运行状态信息
      let latestError: string | undefined;
      let latestRunId: string | undefined;
      let latestRunStatus: string | undefined;
      try {
        const historyFile = path.join(caseDir, 'history', 'history.json');
        if (fs.existsSync(historyFile)) {
          const history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
          if (history && history.length > 0) {
            const latest = history[0];
            latestRunId = latest.runId;
            latestRunStatus = latest.status;
            if (latest.status === 'failed') {
              latestError = latest.error || undefined;
            }
          }
        }
      } catch { /* ignore */ }

      // 读取 screenshots
      const screenshots: string[] = [];
      const ssDir = path.join(caseDir, 'screenshots');
      if (fs.existsSync(ssDir)) {
        try {
          fs.readdirSync(ssDir)
            .filter((f) => f.endsWith('.png'))
            .forEach((f) => screenshots.push(
              `/api/screenshots/${encodedCaseName}/${encodeURIComponent(f)}`,
            ));
        } catch { /* ignore */ }
      }

      const cacheRerunScreenshots: string[] = [];
      const cacheRerunSsDir = path.join(caseDir, 'cache-rerun-screenshots');
      if (fs.existsSync(cacheRerunSsDir)) {
        try {
          fs.readdirSync(cacheRerunSsDir)
            .filter((f) => f.endsWith('.png'))
            .forEach((f) => cacheRerunScreenshots.push(
              `/api/cache-rerun-screenshots/${encodedCaseName}/${encodeURIComponent(f)}`,
            ));
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
          const hasLatestRunJournal = stepDirs.some((sDir) => {
            const requestsPath = path.join(subStepsDir, sDir, 'api-requests.json');
            try {
              if (!fs.existsSync(requestsPath)) return false;
              const journal = JSON.parse(fs.readFileSync(requestsPath, 'utf-8'));
              return journal?.version === 1;
            } catch {
              return false;
            }
          });

          for (const sDir of stepDirs) {
            const statePath = path.join(subStepsDir, sDir, 'state.json');
            const cachePath = path.join(subStepsDir, sDir, 'api-cache.json');
            const requestsPath = path.join(subStepsDir, sDir, 'api-requests.json');
            if (!fs.existsSync(statePath) && !fs.existsSync(cachePath) && !fs.existsSync(requestsPath)) continue;

            try {
              const state = fs.existsSync(statePath)
                ? JSON.parse(fs.readFileSync(statePath, 'utf-8'))
                : {};
              let hasLatestRunRequests = false;
              if (fs.existsSync(requestsPath)) {
                try {
                  const journal = JSON.parse(fs.readFileSync(requestsPath, 'utf-8'));
                  if (journal?.version === 1) {
                    hasLatestRunRequests = true;
                    for (const entry of journal.entries || []) {
                      const subId = entry.subStepId || '$step';
                      if (!state[subId]) state[subId] = { status: 'completed' };
                      if (!state[subId].apiCache) state[subId].apiCache = [];
                      state[subId].apiCache.push({
                        method: entry.method,
                        url: entry.url,
                        status: entry.status,
                        body: entry.body,
                        bodyEncoding: entry.bodyEncoding,
                        requestBody: entry.requestBody || undefined,
                        occurrence: entry.occurrence,
                        sequence: entry.sequence,
                        attemptId: entry.attemptId,
                        captureRunId: entry.runId,
                        cachedAt: entry.requestedAt,
                        fromCache: entry.fromCache === true,
                        cacheAvailable: entry.cacheAvailable ?? true,
                      });
                    }
                  }
                } catch { /* ignore */ }
              }

              const mayUseLegacySnapshots = !hasLatestRunRequests
                && !hasLatestRunJournal
                && latestRunStatus !== 'running';
              if (mayUseLegacySnapshots && fs.existsSync(cachePath)) {
                try {
                  const cacheEntries = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as any[];
                  const metadataPath = path.join(subStepsDir, sDir, 'api-cache.meta.json');
                  const metadata = fs.existsSync(metadataPath)
                    ? JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
                    : { activeAttempts: {} };
                  for (const entry of cacheEntries) {
                    const subId = entry.subStepId || '$step';
                    const scopeId = entry.scopeId || subId;
                    const activeAttempt = metadata.activeAttempts?.[scopeId]?.attemptId;
                    const isActiveSnapshot = activeAttempt
                      ? entry.attemptId === activeAttempt
                      : entry.isActiveSnapshot !== false;
                    if (!isActiveSnapshot) continue;
                    if (!state[subId]) {
                      state[subId] = { status: 'completed' };
                    }
                    if (!state[subId].apiCache) state[subId].apiCache = [];
                    state[subId].apiCache.push({
                      method: entry.method,
                      url: entry.url,
                      status: entry.status,
                      body: entry.body,
                      bodyEncoding: entry.bodyEncoding,
                      requestBody: entry.requestBody || undefined,
                      occurrence: entry.occurrence,
                      sequence: entry.sequence,
                      attemptId: entry.attemptId,
                      captureRunId: entry.captureRunId,
                      cachedAt: entry.cachedAt,
                      isActiveSnapshot,
                      fromCache: undefined,
                      cacheAvailable: true,
                    });
                  }
                } catch { /* ignore */ }
              }
              subStepsData[sDir] = state;
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }

      // 读取 Case 内所有角色共用的静态启动缓存。
      const sharedBootstrapCacheData: any[] = [];
      const sharedBootstrapDir = path.join(caseDir, 'bootstrap-cache', 'shared-static');
      const sharedRequestsPath = path.join(sharedBootstrapDir, 'api-requests.json');
      const sharedCachePath = path.join(sharedBootstrapDir, 'api-cache.json');
      let hasLatestSharedJournal = false;
      if (fs.existsSync(sharedRequestsPath)) {
        try {
          const journal = JSON.parse(fs.readFileSync(sharedRequestsPath, 'utf-8'));
          if (journal?.version === 1) {
            hasLatestSharedJournal = true;
            for (const entry of journal.entries || []) {
              sharedBootstrapCacheData.push({
                method: entry.method,
                url: entry.url,
                status: entry.status,
                body: entry.body,
                bodyEncoding: entry.bodyEncoding,
                requestBody: entry.requestBody || undefined,
                occurrence: entry.occurrence,
                sequence: entry.sequence,
                attemptId: entry.attemptId,
                captureRunId: entry.runId,
                cachedAt: entry.requestedAt,
                fromCache: entry.fromCache === true,
                cacheAvailable: entry.cacheAvailable ?? true,
                roleName: entry.roleName,
              });
            }
          }
        } catch { /* ignore */ }
      }

      if (!hasLatestSharedJournal && latestRunStatus !== 'running' && fs.existsSync(sharedCachePath)) {
        try {
          const cacheEntries = JSON.parse(fs.readFileSync(sharedCachePath, 'utf-8')) as any[];
          for (const entry of cacheEntries) {
            if (entry.isActiveSnapshot === false) continue;
            sharedBootstrapCacheData.push({
              method: entry.method,
              url: entry.url,
              status: entry.status,
              body: entry.body,
              bodyEncoding: entry.bodyEncoding,
              requestBody: entry.requestBody || undefined,
              occurrence: 1,
              sequence: entry.sequence,
              attemptId: entry.attemptId,
              captureRunId: entry.captureRunId,
              cachedAt: entry.cachedAt,
              isActiveSnapshot: true,
              fromCache: undefined,
              cacheAvailable: true,
            });
          }
        } catch { /* ignore */ }
      }

      const uniqueSharedBootstrapCacheData = deduplicateSharedBootstrapEntries(
        sharedBootstrapCacheData,
      );

      // 读取每个角色的应用启动缓存。最新 run 的 api-requests.json 是请求来源权威数据；
      // 旧运行没有 journal 时才回退展示 active snapshot。
      const roleCachesData: Record<string, any[]> = {};
      const roleCacheDir = path.join(caseDir, 'role-cache');
      if (fs.existsSync(roleCacheDir)) {
        try {
          const roleDirs = fs.readdirSync(roleCacheDir).filter((roleDir) => {
            const roleDirPath = path.join(roleCacheDir, roleDir);
            return fs.statSync(roleDirPath).isDirectory();
          });
          const hasLatestRoleJournal = Boolean(latestRunId) && roleDirs.some((roleDir) => {
            const requestsPath = path.join(roleCacheDir, roleDir, 'api-requests.json');
            try {
              if (!fs.existsSync(requestsPath)) return false;
              const journal = JSON.parse(fs.readFileSync(requestsPath, 'utf-8'));
              return journal?.version === 1;
            } catch {
              return false;
            }
          });

          for (const roleDir of roleDirs) {
            const roleDirPath = path.join(roleCacheDir, roleDir);
            const requestsPath = path.join(roleDirPath, 'api-requests.json');
            const cachePath = path.join(roleDirPath, 'api-cache.json');
            let hasLatestRequests = false;
            let roleName = roleDir;
            let rows: any[] = [];

            if (fs.existsSync(requestsPath)) {
              try {
                const journal = JSON.parse(fs.readFileSync(requestsPath, 'utf-8'));
                if (journal?.version === 1) {
                  hasLatestRequests = true;
                  for (const entry of journal.entries || []) {
                    if (typeof entry.stepId === 'string' && entry.stepId.startsWith('role:')) {
                      roleName = entry.stepId.slice('role:'.length);
                    }
                    rows.push({
                      method: entry.method,
                      url: entry.url,
                      status: entry.status,
                      body: entry.body,
                      bodyEncoding: entry.bodyEncoding,
                      requestBody: entry.requestBody || undefined,
                      occurrence: entry.occurrence,
                      sequence: entry.sequence,
                      attemptId: entry.attemptId,
                      captureRunId: entry.runId,
                      cachedAt: entry.requestedAt,
                      fromCache: entry.fromCache === true,
                      cacheAvailable: entry.cacheAvailable ?? true,
                    });
                  }
                }
              } catch { /* ignore */ }
            }

            const mayUseLegacySnapshot = !hasLatestRoleJournal
              && !hasLatestRequests
              && latestRunStatus !== 'running';
            if (mayUseLegacySnapshot && fs.existsSync(cachePath)) {
              try {
                const cacheEntries = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as any[];
                const metadataPath = path.join(roleDirPath, 'api-cache.meta.json');
                const metadata = fs.existsSync(metadataPath)
                  ? JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
                  : { activeAttempts: {} };
                for (const entry of cacheEntries) {
                  if (typeof entry.stepId === 'string' && entry.stepId.startsWith('role:')) {
                    roleName = entry.stepId.slice('role:'.length);
                  }
                  const scopeId = entry.scopeId || `role:${roleName}::bootstrap`;
                  const activeAttempt = metadata.activeAttempts?.[scopeId]?.attemptId;
                  const isActiveSnapshot = activeAttempt
                    ? entry.attemptId === activeAttempt
                    : entry.isActiveSnapshot !== false;
                  if (!isActiveSnapshot) continue;
                  rows.push({
                    method: entry.method,
                    url: entry.url,
                    status: entry.status,
                    body: entry.body,
                    bodyEncoding: entry.bodyEncoding,
                    requestBody: entry.requestBody || undefined,
                    occurrence: entry.occurrence,
                    sequence: entry.sequence,
                    attemptId: entry.attemptId,
                    captureRunId: entry.captureRunId,
                    cachedAt: entry.cachedAt,
                    isActiveSnapshot,
                    fromCache: undefined,
                    cacheAvailable: true,
                  });
                }
              } catch { /* ignore */ }
            }

            if (rows.length > 0) roleCachesData[roleName] = rows;
          }
        } catch { /* ignore */ }
      }

      // 读取 checkpoint 中的本地变量 (context) 与耗时
      let variables: Record<string, any> = {};
      let stepDurations: Record<string, number> = {};
      let caseDuration = 0;
      let startTime: string | undefined;
      try {
        const cp = new Checkpoint(caseName, caseDir);
        cp.load();
        variables = cp.getContext();
        stepDurations = cp.getStepDurations();
      } catch { /* ignore */ }

      try {
        const historyFile = path.join(caseDir, 'history', 'history.json');
        if (fs.existsSync(historyFile)) {
          const history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
          if (history && history.length > 0) {
            if (history[0].status === 'running') {
              startTime = history[0].timestamp;
            }
            caseDuration = history[0].duration || 0;
          }
        }
      } catch { /* ignore */ }

      if (!caseDuration) {
        caseDuration = Object.values(stepDurations).reduce((sum, d) => sum + d, 0);
      }

      try {
        const persistentPath = path.join('config', 'persistent', `${safeCaseName}.json`);
        if (fs.existsSync(persistentPath)) {
          const persistentVars = JSON.parse(fs.readFileSync(persistentPath, 'utf-8'));
          variables = { ...variables, ...persistentVars };
        }
      } catch { /* ignore */ }

      return jsonRes(res, 200, {
        caseName,
        screenshots,
        cacheRerunScreenshots,
        subSteps: subStepsData,
        traces,
        error: latestError,
        variables,
        stepDurations,
        duration: caseDuration,
        startTime,
        sharedBootstrapCache: uniqueSharedBootstrapCacheData,
        roleCaches: roleCachesData,
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
      const safeCaseName = resolveSafeCaseName(caseName);
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
      const safeCaseName = resolveSafeCaseName(caseName);
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
        const safeCaseName = resolveSafeCaseName(body.caseName);
        const caseDir = path.join('.resumewright', safeCaseName);
        const cp = new Checkpoint(body.caseName, caseDir);
        cp.reset();
        delete lastRunStatuses[body.caseName];

        if (body.keepCache) {
          // 保留 API 缓存，只清除断点和子步骤状态
          resetCaseKeepCache(caseDir);
          return jsonRes(res, 200, { success: true, message: `Reset case: ${body.caseName} (API cache preserved)` });
        } else {
          // 清空一切，保留 history 目录
          resetCaseRuntime(caseDir);
          return jsonRes(res, 200, { success: true, message: `Reset case: ${body.caseName} (history preserved)` });
        }
      }

      return jsonRes(res, 400, { error: 'Provide caseName or all: true' });
    } catch (err: any) {
      return jsonRes(res, 500, { error: err.message });
    }
  }

  // ── REST API: GET /api/running-status — 获取当前执行状态 ──
  if (pathname === '/api/running-status' && req.method === 'GET') {
    return jsonRes(res, 200, {
      running: !!activeProcess,
      cases: activeCaseFiles,
      settings: activeSettings
    });
  }

  // ── Server-Sent Events (SSE): GET /api/run-stream — 执行流式日志 ──
  if (pathname === '/api/run-stream' && req.method === 'GET') {
    const caseFiles = url.searchParams.get('cases')?.split(',') || [];
    const headed = url.searchParams.get('headed') === 'true';
    const trace = url.searchParams.get('trace') === 'true';
    const screenshotOnAssert = url.searchParams.get('screenshotOnAssert') === 'true';
    const apiCache = url.searchParams.get('apiCache') !== 'false';
    const cacheGet = apiCache;
    const readCache = url.searchParams.get('readCache') !== 'false';
    const rawConcurrency = parseInt(url.searchParams.get('concurrency') || '3', 10);
    const concurrency = isNaN(rawConcurrency) ? 3 : Math.max(1, Math.min(10, rawConcurrency));

    if (caseFiles.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No cases selected' }));
      return;
    }

    // 设置 SSE Header
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': ok\n\n');

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const broadcastEvent = (event: string, data: any) => {
      activeLogsBuffer.push({ event, data });
      for (const client of activeClients) {
        try {
          client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch { /* ignore */ }
      }
    };

    activeClients.add(res);

    req.on('close', () => {
      activeClients.delete(res);
    });

    if (activeProcess) {
      // 已经有进程在运行，直接把已有的日志 buffer 重放给新客户端
      for (const item of activeLogsBuffer) {
        sendEvent(item.event, item.data);
      }
      return;
    }

    // 第一次运行，清空日志 buffer
    activeLogsBuffer = [];

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
    if (apiCache) {
      cmdArgs.push('--api-cache');
    } else {
      cmdArgs.push('--no-api-cache');
    }
    if (cacheGet) {
      cmdArgs.push('--cache-get');
    }
    if (readCache) {
      cmdArgs.push('--read-cache');
    } else {
      cmdArgs.push('--no-read-cache');
    }
    if (concurrency) {
      cmdArgs.push('--concurrency', String(concurrency));
    }

    let command: string;
    let finalArgs: string[];

    if (isTs) {
      command = process.execPath;
      const tsxCli = getLocalNodeScript('node_modules', 'tsx', 'dist', 'cli.mjs');
      finalArgs = [tsxCli, ...cmdArgs];
    } else {
      command = process.execPath;
      finalArgs = cmdArgs;
    }

    // 标记状态为 running
    caseFiles.forEach((f) => {
      try {
        const absolute = path.resolve(process.cwd(), f);
        const def = loadCase(absolute);
        lastRunStatuses[def.name] = 'running';
      } catch { /* ignore */ }
    });

    broadcastEvent('log', { text: `[system] Starting process: ${command} ${finalArgs.join(' ')}\n` });

    const proc = spawn(command, finalArgs, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '1' }, // 保持彩色输出
    });
    activeProcess = proc;
    activeCaseFiles = caseFiles;
    activeSettings = { headed, trace, screenshotOnAssert, apiCache, cacheGet, concurrency, readCache };

    let processEnded = false;

    let buffer = '';
    const handleLogData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const match = line.match(/^\[case:([^\]]+)\](.*)$/);
        if (match) {
          const safeCaseName = decodeURIComponent(match[1]!);
          const text = match[2]!;
          broadcastEvent('log', { case: safeCaseName, text: text + '\n' });
        } else {
          broadcastEvent('log', { text: line + '\n' });
        }
      }
    };

    proc.stdout.on('data', handleLogData);
    proc.stderr.on('data', handleLogData);

    proc.on('error', (err) => {
      if (processEnded) return;
      processEnded = true;
      console.error('[dashboard] Subprocess failed to start:', err);
      broadcastEvent('log', { text: `[system] Failed to start process: ${err.message}\n` });
      activeProcess = null;
      activeCaseFiles = [];
      activeSettings = null;
      caseFiles.forEach((f) => {
        try {
          const absolute = path.resolve(process.cwd(), f);
          const def = loadCase(absolute);
          lastRunStatuses[def.name] = 'failed';
          markHistoryAsTerminated(def.name, -1);
        } catch { /* ignore */ }
      });
      broadcastEvent('finish', { exitCode: -1, status: 'failed' });
      for (const client of activeClients) {
        try { client.end(); } catch {}
      }
      activeClients.clear();
      activeLogsBuffer = [];
    });

    proc.on('close', (code) => {
      if (processEnded) return;
      processEnded = true;
      if (buffer) {
        const match = buffer.match(/^\[case:([^\]]+)\](.*)$/);
        if (match) {
          broadcastEvent('log', { case: decodeURIComponent(match[1]!), text: match[2]! });
        } else {
          broadcastEvent('log', { text: buffer });
        }
      }
      activeProcess = null;
      activeCaseFiles = [];
      activeSettings = null;
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

      broadcastEvent('finish', { exitCode: code, status });
      for (const client of activeClients) {
        try { client.end(); } catch {}
      }
      activeClients.clear();
      activeLogsBuffer = [];
    });

    return;
  }

  // ── POST /api/stop — 终止当前正在运行的测试 ──
  if (pathname === '/api/stop' && req.method === 'POST') {
    if (activeProcess) {
      activeProcess.kill();
      activeProcess = null;
      activeCaseFiles = [];
      activeSettings = null;
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

      const safeCaseName = resolveSafeCaseName(caseName);
      const tracePath = path.join('.resumewright', safeCaseName, 'traces', traceFile);

      if (!fs.existsSync(tracePath)) {
        return jsonRes(res, 404, { error: 'Trace file not found' });
      }

      // 异步执行 playwright show-trace <tracePath> 并规避 Windows 下的 spawn 兼容问题
      const cliPath = getLocalNodeScript('node_modules', '@playwright/test', 'cli.js');
      const proc = spawn(process.execPath, [cliPath, 'show-trace', tracePath], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore',
      });
      proc.on('error', (err) => {
        console.error(`[dashboard] Failed to spawn Playwright trace viewer:`, err);
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
      const safeCaseName = resolveSafeCaseName(caseName);
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

  // ── 静态资源映射: cache-rerun 截图预览 ──
  if (pathname.startsWith('/api/cache-rerun-screenshots/') && req.method === 'GET') {
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
      const safeCaseName = resolveSafeCaseName(caseName);
      const decodedFileName = decodeURIComponent(fileName);
      const filePath = path.join('.resumewright', safeCaseName, 'cache-rerun-screenshots', decodedFileName);

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

  // ── 静态资源托管: 语法着色设计器 (Theme Designer) ──
  if (pathname.startsWith('/tools/theme-designer') && req.method === 'GET') {
    if (pathname === '/tools/theme-designer') {
      res.writeHead(301, { 'Location': '/tools/theme-designer/' });
      res.end();
      return;
    }
    const fileRelativePath = pathname.replace('/tools/theme-designer/', '');
    const safeRelPath = fileRelativePath || 'index.html';
    let filePath = path.join(__dirname, '../../tools/theme-designer', safeRelPath);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(__dirname, '../../../tools/theme-designer', safeRelPath);
    }

    if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
      const ext = path.extname(filePath);
      let contentType = 'text/plain';
      if (ext === '.html') contentType = 'text/html; charset=utf-8';
      else if (ext === '.css') contentType = 'text/css';
      else if (ext === '.js') contentType = 'application/javascript';
      
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  // ── 静态资源托管: UI Dashboard 前端网页 ──
  let fileRelativePath = pathname;
  if (pathname === '/' || pathname === '/index.html') {
    fileRelativePath = '/index.html';
  }

  let staticFilePath = path.join(__dirname, 'dist', fileRelativePath.slice(1));
  if (!fs.existsSync(staticFilePath)) {
    // 兼容从 dist/src/dashboard/server.js 运行时寻找 src/dashboard/dist/ 的相对路径
    staticFilePath = path.join(__dirname, '../../../src/dashboard/dist', fileRelativePath.slice(1));
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
