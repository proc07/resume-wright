// ============================================================
// tests/unit/adapters/yaml-loader.test.ts
// YAML Case 加载与 Schema 校验单元测试
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCase } from '../../../src/adapters/yaml-loader.js';

// ── 工具函数：写临时 YAML ────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-yaml-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeYaml(name: string, content: string): string {
  const filePath = path.join(tmpDir, `${name}.yaml`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ── 测试用 YAML ───────────────────────────────────────────────

const VALID_YAML = `
name: "采购审批测试"
description: "测试用 Case"
timeout: 300000

roles:
  requester: { username: "user@co.com", password: "pass" }
  manager:   { username: "mgr@co.com",  password: "mgr_pass" }

steps:
  - id: step1_create
    role: requester
    script: |
      open "https://app.example.com/new"
      tap "role:button[提交]"
      $url = current_url

  - id: step2_approve
    role: manager
    on_failure:
      strategy: retry
      max_retries: 3
      retry_delay: 2000
    script: |
      open "$url"
      tap "role:button[审批通过]"
      assert_exists "审批完成" 10s
`;

const VALID_WITH_SUBSTEPS = `
name: "含子步骤的测试"
roles:
  user: { username: "u@co.com", password: "p" }

steps:
  - id: step1
    role: user
    sub_steps:
      - id: fill_form
        script: |
          open "https://app.example.com"
          input "test" to "label:标题"
        on_failure:
          strategy: retry
          max_retries: 2
      - id: submit
        snapshot_before_submit: true
        script: |
          tap "role:button[提交]"
`;

describe('YAML Loader', () => {

  // ── 合法 Case ─────────────────────────────────────────────

  describe('合法 YAML 加载', () => {
    it('成功加载完整合法 Case', () => {
      const filePath = writeYaml('valid', VALID_YAML);
      const def = loadCase(filePath);
      expect(def.name).toBe('采购审批测试');
      expect(def.timeout).toBe(300000);
    });

    it('正确解析 roles', () => {
      const filePath = writeYaml('valid-roles', VALID_YAML);
      const def = loadCase(filePath);
      expect(Object.keys(def.roles)).toEqual(['requester', 'manager']);
      expect(def.roles.requester!.username).toBe('user@co.com');
    });

    it('正确解析具有自定义属性的 roles', () => {
      const customYaml = `
name: "自定义属性 roles"
roles:
  requester: { id: "123", username: "req", custom_field: "my-value" }
steps:
  - id: s1
    role: requester
    script: open "https://example.com"
`;
      const filePath = writeYaml('custom-roles', customYaml);
      const def = loadCase(filePath);
      expect(def.roles.requester!.id).toBe('123');
      expect(def.roles.requester!.username).toBe('req');
      expect(def.roles.requester!.custom_field).toBe('my-value');
    });

    it('正确解析 steps', () => {
      const filePath = writeYaml('valid-steps', VALID_YAML);
      const def = loadCase(filePath);
      expect(def.steps).toHaveLength(2);
      expect(def.steps[0]!.id).toBe('step1_create');
      expect(def.steps[0]!.role).toBe('requester');
    });

    it('正确解析 on_failure 策略', () => {
      const filePath = writeYaml('valid-onfail', VALID_YAML);
      const def = loadCase(filePath);
      const step2 = def.steps[1]!;
      expect(step2.on_failure?.strategy).toBe('retry');
      expect(step2.on_failure?.max_retries).toBe(3);
      expect(step2.on_failure?.retry_delay).toBe(2000);
    });

    it('正确解析 sub_steps', () => {
      const filePath = writeYaml('valid-substeps', VALID_WITH_SUBSTEPS);
      const def = loadCase(filePath);
      expect(def.steps[0]!.sub_steps).toHaveLength(2);
      expect(def.steps[0]!.sub_steps![0]!.id).toBe('fill_form');
      expect(def.steps[0]!.sub_steps![1]!.snapshot_before_submit).toBe(true);
    });

    it('description 为可选字段', () => {
      const yaml = `
name: "最简 Case"
roles:
  user: { username: "u@co.com", password: "p" }
steps:
  - id: s1
    role: user
    script: open "https://example.com"
`;
      const filePath = writeYaml('minimal', yaml);
      const def = loadCase(filePath);
      expect(def.description).toBeUndefined();
    });
  });

  // ── Schema 校验错误 ───────────────────────────────────────

  describe('Schema 校验失败', () => {
    it('缺少 name 字段时自动使用文件名填充', () => {
      const yaml = `
roles:
  user: { username: "u@co.com", password: "p" }
steps:
  - id: s1
    role: user
    script: open "https://example.com"
`;
      const filePath = writeYaml('no-name', yaml);
      const def = loadCase(filePath);
      expect(def.name).toBe('no-name');
    });

    it('缺少 steps 时抛出', () => {
      const yaml = `
name: "无步骤"
roles:
  user: { username: "u@co.com", password: "p" }
`;
      const filePath = writeYaml('no-steps', yaml);
      expect(() => loadCase(filePath)).toThrow();
    });

    it('on_failure.strategy 无效枚举值时抛出', () => {
      const yaml = `
name: "非法策略"
roles:
  user: { username: "u@co.com", password: "p" }
steps:
  - id: s1
    role: user
    script: open "https://example.com"
    on_failure:
      strategy: invalid_strategy
`;
      const filePath = writeYaml('bad-strategy', yaml);
      expect(() => loadCase(filePath)).toThrow();
    });
  });

  // ── 业务校验 ─────────────────────────────────────────────

  describe('业务逻辑校验', () => {
    it('step.role 引用未定义角色时抛出', () => {
      const yaml = `
name: "未知角色"
roles:
  requester: { username: "u@co.com", password: "p" }
steps:
  - id: s1
    role: nonexistent_role
    script: open "https://example.com"
`;
      const filePath = writeYaml('unknown-role', yaml);
      expect(() => loadCase(filePath)).toThrow(/unknown role/i);
    });

    it('step.id 重复时抛出', () => {
      const yaml = `
name: "重复 ID"
roles:
  user: { username: "u@co.com", password: "p" }
steps:
  - id: step1
    role: user
    script: open "https://example.com"
  - id: step1
    role: user
    script: tap "按钮"
`;
      const filePath = writeYaml('dup-id', yaml);
      expect(() => loadCase(filePath)).toThrow(/duplicate/i);
    });
  });

  // ── 文件错误 ─────────────────────────────────────────────

  describe('文件级错误', () => {
    it('文件不存在时抛出', () => {
      expect(() => loadCase('/nonexistent/path/case.yaml')).toThrow(/not found/i);
    });

    it('语法错误的 YAML 抛出解析错误', () => {
      const filePath = writeYaml('bad-yaml', 'name: [invalid yaml: {broken');
      expect(() => loadCase(filePath)).toThrow(/yaml|parse/i);
    });
  });

  // ── 示例文件验证 ──────────────────────────────────────────

  describe('项目示例文件', () => {
    it('purchase-approval.yaml 合法', () => {
      const filePath = 'demo/cases/workflows/purchase-approval.yaml';
      const def = loadCase(filePath);
      expect(def.name).toBe('purchase-approval');
      expect(def.steps).toHaveLength(4);
      expect(Object.keys(def.roles)).toEqual(['requester', 'manager', 'finance']);
    });

    it('invoice-review-substeps.yaml 合法', () => {
      const filePath = 'demo/cases/workflows/invoice/invoice-review-substeps.yaml';
      const def = loadCase(filePath);
      expect(def.steps[0]!.sub_steps).toBeDefined();
      expect(def.steps[0]!.sub_steps).toHaveLength(3);
    });
  });
});
