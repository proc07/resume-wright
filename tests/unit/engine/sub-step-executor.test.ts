// ============================================================
// tests/unit/engine/sub-step-executor.test.ts
// DomSnapshotManager 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DomSnapshotManager } from '../../../src/engine/dom-snapshot.js';

describe('DomSnapshotManager', () => {
  let tmpDir: string;
  let mgr: DomSnapshotManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-test-snapshot-'));
    mgr = new DomSnapshotManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('应该能够正确保存和加载快照包含表单状态', () => {
    const mockSnapshot = {
      id: 'test-sub-step',
      url: 'https://example.com/invoice/new',
      timestamp: Date.now(),
      storageState: { cookies: [], origins: [] },
      pageState: { title: '测试发票创建' },
      formState: [
        {
          selector: '#invoice-title',
          tagName: 'input',
          type: 'text',
          value: '发票1',
          checked: false,
          index: 0,
        },
        {
          selector: '#invoice-amount',
          tagName: 'input',
          type: 'number',
          value: '1000',
          checked: false,
          index: 1,
        }
      ]
    };

    const filePath = path.join(tmpDir, 'test-sub-step.json');
    fs.writeFileSync(filePath, JSON.stringify(mockSnapshot, null, 2), 'utf-8');

    expect(mgr.exists('test-sub-step')).toBe(true);
    const loaded = mgr.load('test-sub-step');
    expect(loaded).not.toBeNull();
    expect(loaded?.url).toBe('https://example.com/invoice/new');
    expect((loaded as any).formState).toHaveLength(2);
    expect((loaded as any).formState[0].value).toBe('发票1');
    expect((loaded as any).formState[1].value).toBe('1000');
  });
});
