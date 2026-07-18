// ============================================================
// tests/unit/engine/sub-step-store.test.ts
// SubStepStore 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SubStepStore } from '../../../src/engine/sub-step-store.js';

describe('SubStepStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-test-sub-step-store-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('应该在默认 baseline 模式下指向标准的 state.json 和 snapshots 目录', () => {
    const store = new SubStepStore('step-1', tmpDir);
    
    expect(store.apiCachePath).toBe(path.join(tmpDir, 'step-1', 'api-cache.json'));
    // stateFilePath is private, but we can verify it via saving/loading
    expect(store.snapshotsDir).toBe(path.join(tmpDir, 'step-1', 'snapshots'));
  });

  it('应该在 cache-rerun 模式下将状态和快照重定向为 cache-rerun- 前缀的文件和目录，但保持 apiCachePath 不变', () => {
    const store = new SubStepStore('step-1', tmpDir, 'cache-rerun');
    
    expect(store.apiCachePath).toBe(path.join(tmpDir, 'step-1', 'api-cache.json'));
    expect(store.snapshotsDir).toBe(path.join(tmpDir, 'step-1', 'cache-rerun-snapshots'));
    
    // 验证写入/读取隔离性
    store.markCompleted('sub-1');

    // 检查确实生成了 cache-rerun-state.json
    const rerunStateFile = path.join(tmpDir, 'step-1', 'cache-rerun-state.json');
    const normalStateFile = path.join(tmpDir, 'step-1', 'state.json');
    expect(fs.existsSync(rerunStateFile)).toBe(true);
    expect(fs.existsSync(normalStateFile)).toBe(false);

    // 重新加载验证
    const reloadStore = new SubStepStore('step-1', tmpDir, 'cache-rerun');
    reloadStore.load();
    expect(reloadStore.isCompleted('sub-1')).toBe(true);
  });
});
