import { defineConfig } from 'vitest/config';

// 集成测试配置：需要真实浏览器（Playwright），超时时间更长
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: 'forks',
    maxWorkers: 1,
  },
});
