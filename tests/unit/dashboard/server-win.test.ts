// ============================================================
// tests/unit/dashboard/server-win.test.ts
// Windows 兼容性单元测试
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { getLocalNodeScript, openDashboardInBrowser } from '../../../src/dashboard/server.js';

vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn().mockReturnValue({
      on: vi.fn(),
    }),
  };
});

describe('Dashboard Windows Compatibility', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  describe('openDashboardInBrowser', () => {
    it('在 win32 平台上使用 cmd /c start 打开浏览器', () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      openDashboardInBrowser('http://127.0.0.1:3000/');

      expect(spawn).toHaveBeenCalledWith(
        'cmd',
        ['/c', 'start', 'http://127.0.0.1:3000/']
      );
    });

    it('在 non-win32 (如 darwin) 平台上使用 open 命令打开浏览器', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      openDashboardInBrowser('http://127.0.0.1:3000/');

      expect(spawn).toHaveBeenCalledWith(
        'open',
        ['http://127.0.0.1:3000/']
      );
    });
  });

  describe('getLocalNodeScript', () => {
    it('正确解析存在的本地 node_modules 路径', () => {
      const scriptPath = getLocalNodeScript('node_modules', 'tsx', 'dist', 'cli.mjs');
      expect(scriptPath).toContain('node_modules');
      expect(scriptPath).toContain('cli.mjs');
    });
  });
});
