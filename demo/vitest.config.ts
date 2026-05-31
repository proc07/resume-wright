import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // 开发阶段：将 'resumewright' 解析到本地源码（无需先 build）
    // 生产环境中：安装发布后的包，则自动解析到 dist/
    alias: {
      'resumewright': path.resolve('../src/index.ts'),
      // 防止 @playwright/test 被 demo/node_modules 和 ../node_modules 各加载一份
      '@playwright/test': path.resolve('../node_modules/@playwright/test'),
      'playwright': path.resolve('../node_modules/playwright'),
    },
    dedupe: ['@playwright/test', 'playwright'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: 'forks',
    maxWorkers: 1,
  },
});
