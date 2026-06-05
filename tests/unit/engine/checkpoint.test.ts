// ============================================================
// tests/unit/engine/checkpoint.test.ts
// Checkpoint 单元测试（使用临时目录）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Checkpoint, getSafeCaseName } from '../../../src/engine/checkpoint.js';
import { ContextStore } from '../../../src/engine/context-store.js';

describe('Checkpoint', () => {
  let tmpDir: string;
  let checkpoint: Checkpoint;
  let ctx: ContextStore;

  beforeEach(() => {
    // 每个测试使用独立临时目录
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-test-'));
    checkpoint = new Checkpoint('test-case', tmpDir);
    ctx = new ContextStore();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 初始状态 ─────────────────────────────────────────────

  describe('初始状态', () => {
    it('初始时无已完成步骤', () => {
      expect(checkpoint.completedCount()).toBe(0);
    });

    it('初始时 isCompleted 返回 false', () => {
      expect(checkpoint.isCompleted('step1')).toBe(false);
    });

    it('不存在的文件 load() 不抛出', () => {
      expect(() => checkpoint.load()).not.toThrow();
    });
  });

  // ── 标记完成 ─────────────────────────────────────────────

  describe('markCompleted()', () => {
    it('标记后 isCompleted 返回 true', () => {
      ctx.set('url', 'https://example.com');
      checkpoint.markCompleted('step1_create', ctx);
      expect(checkpoint.isCompleted('step1_create')).toBe(true);
    });

    it('标记后 completedCount 递增', () => {
      checkpoint.markCompleted('step1', ctx);
      checkpoint.markCompleted('step2', ctx);
      expect(checkpoint.completedCount()).toBe(2);
    });

    it('重复标记同一步骤不重复计数', () => {
      checkpoint.markCompleted('step1', ctx);
      checkpoint.markCompleted('step1', ctx);
      expect(checkpoint.completedCount()).toBe(1);
    });

    it('写盘后文件存在', () => {
      checkpoint.markCompleted('step1', ctx);
      expect(fs.existsSync(checkpoint.getFilePath())).toBe(true);
    });

    it('写盘内容正确', () => {
      ctx.set('workflow_url', 'https://app.com/workflow/abc');
      checkpoint.markCompleted('step1', ctx);
      const data = JSON.parse(fs.readFileSync(checkpoint.getFilePath(), 'utf-8'));
      expect(data.caseName).toBe('test-case');
      expect(data.completedSteps).toContain('step1');
      expect(data.context.workflow_url).toBe('https://app.com/workflow/abc');
    });
  });

  // ── 加载与恢复 ────────────────────────────────────────────

  describe('load() 与 restoreContext()', () => {
    it('重启后恢复已完成步骤', () => {
      ctx.set('url', 'https://example.com');
      checkpoint.markCompleted('step1', ctx);
      checkpoint.markCompleted('step2', ctx);

      // 模拟重启：创建新的 Checkpoint 并加载
      const restored = new Checkpoint('test-case', tmpDir);
      restored.load();
      expect(restored.isCompleted('step1')).toBe(true);
      expect(restored.isCompleted('step2')).toBe(true);
    });

    it('重启后恢复 ContextStore 变量', () => {
      ctx.set('workflow_url', 'https://app.com/workflow/uuid-abc');
      ctx.set('workflow_id', 'uuid-abc');
      checkpoint.markCompleted('step1', ctx);

      const newCtx = new ContextStore();
      const restored = new Checkpoint('test-case', tmpDir);
      restored.load();
      restored.restoreContext(newCtx);

      expect(newCtx.get('workflow_url')).toBe('https://app.com/workflow/uuid-abc');
      expect(newCtx.get('workflow_id')).toBe('uuid-abc');
    });

    it('resumePoint 返回最后完成的步骤', () => {
      checkpoint.markCompleted('step1', ctx);
      checkpoint.markCompleted('step2', ctx);
      expect(checkpoint.getResumePoint()).toBe('step2');
    });

    it('无已完成步骤时 resumePoint 为 undefined', () => {
      expect(checkpoint.getResumePoint()).toBeUndefined();
    });
  });

  // ── 原子写 ────────────────────────────────────────────────

  describe('原子写（防崩溃损坏）', () => {
    it('写盘完成后 .tmp 文件不存在', () => {
      checkpoint.markCompleted('step1', ctx);
      const tmpFile = `${checkpoint.getFilePath()}.tmp`;
      expect(fs.existsSync(tmpFile)).toBe(false);
    });
  });

  // ── reset ─────────────────────────────────────────────────

  describe('reset()', () => {
    it('reset 后 isCompleted 返回 false', () => {
      checkpoint.markCompleted('step1', ctx);
      checkpoint.reset();
      expect(checkpoint.isCompleted('step1')).toBe(false);
    });

    it('reset 后文件被删除', () => {
      checkpoint.markCompleted('step1', ctx);
      checkpoint.reset();
      expect(fs.existsSync(checkpoint.getFilePath())).toBe(false);
    });
  });

  // ── syncContext ───────────────────────────────────────────

  describe('syncContext()', () => {
    it('同步 Context 但不增加已完成步骤', () => {
      checkpoint.markCompleted('step1', ctx);
      const count = checkpoint.completedCount();
      checkpoint.syncContext(ctx);
      expect(checkpoint.completedCount()).toBe(count);
    });
  });

  // ── getSafeCaseName ───────────────────────────────────────

  describe('getSafeCaseName()', () => {
    it('正确转换非法字符并进行 URL 编码', () => {
      const caseName = '我的/测试:用例*名称?包含"非法"字符';
      const safe = getSafeCaseName(caseName);
      expect(safe).toBe(encodeURIComponent('我的_测试_用例_名称_包含_非法_字符'));
      expect(decodeURIComponent(safe)).toBe('我的_测试_用例_名称_包含_非法_字符');
    });
  });
});
