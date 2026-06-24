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

    it('正确解析 on_failure 策略的默认值 (max_retries 默认 0)', () => {
      const yamlContent = `
name: "测试默认重试"
roles:
  user: { username: "u" }
steps:
  - id: step1
    role: user
    on_failure:
      strategy: retry
    script: "open '/'"
`;
      const filePath = writeYaml('default-retries', yamlContent);
      const def = loadCase(filePath);
      expect(def.steps[0]!.on_failure?.max_retries).toBe(0);
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

  describe('全局 config.yaml 加载与合并默认值', () => {
    const configPath = path.resolve('config.yaml');
    let existsBefore = false;
    let contentBefore = '';

    beforeAll(() => {
      if (fs.existsSync(configPath)) {
        existsBefore = true;
        contentBefore = fs.readFileSync(configPath, 'utf-8');
      }
    });

    afterAll(() => {
      if (existsBefore) {
        fs.writeFileSync(configPath, contentBefore, 'utf-8');
      } else {
        fs.rmSync(configPath, { force: true });
      }
    });

    it('无本地设置时应自动合并全局默认配置', () => {
      // 写入临时全局配置
      fs.writeFileSync(configPath, JSON.stringify({
        base_url: 'http://global-url.com',
        timeout: 99999,
        login_macro_path: 'global-login',
        on_failure: {
          strategy: 'retry',
          max_retries: 5,
        }
      }), 'utf-8');

      // 准备一个没有这些属性的 YAML
      const caseYaml = `
name: "测试合并"
roles:
  user: { username: "u" }
steps:
  - id: step1
    role: user
    script: "open '/test'"
`;
      const filePath = writeYaml('test-merge', caseYaml);
      const def = loadCase(filePath);

      expect(def.base_url).toBe('http://global-url.com');
      expect(def.timeout).toBe(99999);
      expect(def.login_macro_path).toBe('global-login');
      expect(def.on_failure?.max_retries).toBe(5);
    });

    it('本地配置能够覆盖全局配置', () => {
      // 写入临时全局配置
      fs.writeFileSync(configPath, JSON.stringify({
        base_url: 'http://global-url.com',
        timeout: 99999,
      }), 'utf-8');

      // 准备一个覆写属性的 YAML
      const caseYaml = `
name: "测试覆写"
timeout: 11111
base_url: "http://local-override.com"
roles:
  user: { username: "u" }
steps:
  - id: step1
    role: user
    script: "open '/test'"
`;
      const filePath = writeYaml('test-override', caseYaml);
      const def = loadCase(filePath);

      expect(def.base_url).toBe('http://local-override.com');
      expect(def.timeout).toBe(11111);
    });

    it('能够向上搜索找到父目录中的 config.yaml 并应用', () => {
      // 在临时子目录中写入 YAML 用例，并在其父目录中写入 config.yaml
      const tempParentDir = path.join(tmpDir, 'parent-test');
      const tempSubDir = path.join(tempParentDir, 'sub-dir');
      fs.mkdirSync(tempSubDir, { recursive: true });

      const subConfigPath = path.join(tempParentDir, 'config.yaml');
      fs.writeFileSync(subConfigPath, JSON.stringify({
        base_url: 'http://upward-parent.com',
        timeout: 77777,
      }), 'utf-8');

      const caseYaml = `
name: "向上查找测试"
roles:
  user: { username: "u" }
steps:
  - id: step1
    role: user
    script: "open '/test'"
`;
      const filePath = path.join(tempSubDir, 'test-case.yaml');
      fs.writeFileSync(filePath, caseYaml, 'utf-8');

      const def = loadCase(filePath);

      expect(def.base_url).toBe('http://upward-parent.com');
      expect(def.timeout).toBe(77777);

      // 清理
      fs.rmSync(tempParentDir, { recursive: true, force: true });
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

  // ── 共享步骤（Shared Steps）──────────────────────────────────
  describe('共享步骤 use_step 复用', () => {
    let sharedDir: string;

    beforeAll(() => {
      // 在 tmpDir 下创建 shared/ 子目录，放 .steps.yaml 文件
      sharedDir = path.join(tmpDir, 'shared');
      fs.mkdirSync(sharedDir, { recursive: true });

      fs.writeFileSync(path.join(sharedDir, 'common.steps.yaml'), `
steps:
  - id: verify_done
    role: finance
    script: |
      open "$workflow_url"
      assert_exists "已完成" 5s

  - id: approve
    role: manager
    script: |
      tap "role:button[审批通过]"
      assert_exists "审批完成" 5s

sub_steps:
  - id: capture_id
    script: |
      $workflow_url = current_url
      $workflow_id = url_match "/purchase/(\\w+)"
      screenshot
`, 'utf-8');
    });

    function writeCaseInTmp(name: string, content: string): string {
      const filePath = path.join(tmpDir, `${name}.yaml`);
      fs.writeFileSync(filePath, content, 'utf-8');
      return filePath;
    }

    it('use_step 能够展开共享 Step，继承模板的 role 和 script', () => {
      const caseYaml = `
name: "共享步骤测试"
roles:
  requester: { username: "req" }
  finance: { username: "fin" }
steps:
  - id: step1
    role: requester
    script: "open '/'"
  - use_step: "common.verify_done"
`;
      const filePath = writeCaseInTmp('use-step-basic', caseYaml);
      const def = loadCase(filePath);
      expect(def.steps).toHaveLength(2);
      const step2 = def.steps[1]!;
      expect(step2.id).toBe('verify_done');       // 继承 template.id
      expect(step2.role).toBe('finance');          // 继承 template.role
      expect(step2.script).toContain('已完成');   // 继承 template.script
    });

    it('use_step 引用时局部覆盖 role（local wins）', () => {
      const caseYaml = `
name: "覆盖 role 测试"
roles:
  requester: { username: "req" }
  manager: { username: "mgr" }
  finance: { username: "fin" }
steps:
  - id: step1
    role: requester
    script: "open '/'"
  - use_step: "common.verify_done"
    id: my_verify
    role: manager
`;
      const filePath = writeCaseInTmp('use-step-override', caseYaml);
      const def = loadCase(filePath);
      const step2 = def.steps[1]!;
      expect(step2.id).toBe('my_verify');   // 使用引用处声明的 id
      expect(step2.role).toBe('manager');   // 覆盖 template.role(finance)
      expect(step2.script).toContain('已完成'); // 仍继承 template.script
    });

    it('子步骤层级 use_step 能够展开共享 SubStep，继承模板的 script', () => {
      const caseYaml = `
name: "共享子步骤测试"
roles:
  requester: { username: "req" }
steps:
  - id: step1
    role: requester
    sub_steps:
      - id: fill
        script: "open '/purchase/new'"
      - use_step: "common.capture_id"
`;
      const filePath = writeCaseInTmp('use-sub-step-basic', caseYaml);
      const def = loadCase(filePath);
      const subSteps = def.steps[0]!.sub_steps!;
      expect(subSteps).toHaveLength(2);
      const ss2 = subSteps[1]!;
      expect(ss2.id).toBe('capture_id');
      expect(ss2.script).toContain('workflow_url');
    });

    it('子步骤层级 use_step 引用时局部覆盖 on_failure（local wins）', () => {
      const caseYaml = `
name: "覆盖子步骤 on_failure"
roles:
  requester: { username: "req" }
steps:
  - id: step1
    role: requester
    sub_steps:
      - use_step: "common.capture_id"
        id: capture_custom
        on_failure:
          strategy: retry
          max_retries: 3
`;
      const filePath = writeCaseInTmp('use-sub-step-override', caseYaml);
      const def = loadCase(filePath);
      const ss = def.steps[0]!.sub_steps![0]!;
      expect(ss.id).toBe('capture_custom');
      expect(ss.on_failure?.strategy).toBe('retry');
      expect(ss.on_failure?.max_retries).toBe(3);
    });

    it('use_step 引用不存在时抛出友好错误', () => {
      const caseYaml = `
name: "引用不存在测试"
roles:
  requester: { username: "req" }
steps:
  - use_step: "common.non_existent_step"
`;
      const filePath = writeCaseInTmp('use-step-missing', caseYaml);
      expect(() => loadCase(filePath)).toThrow(/use_step.*non_existent_step.*not found/i);
    });

    it('子步骤层级 use_step 引用不存在时抛出友好错误', () => {
      const caseYaml = `
name: "子步骤引用不存在测试"
roles:
  requester: { username: "req" }
steps:
  - id: step1
    role: requester
    sub_steps:
      - use_step: "common.ghost_sub_step"
`;
      const filePath = writeCaseInTmp('use-sub-step-missing', caseYaml);
      expect(() => loadCase(filePath)).toThrow(/use_step.*ghost_sub_step.*not found/i);
    });
  });

  describe('login_macro_path 引号校验', () => {
    it('当 login_macro_path 带有双引号时，校验应该通过', () => {
      const caseYaml = `
name: "引号测试1"
login_macro_path: "./macros/login.macro"
roles:
  user: { username: "u" }
steps:
  - id: step1
    role: user
    script: "open '/'"
`;
      const filePath = writeYaml('quote-valid-double', caseYaml);
      const def = loadCase(filePath);
      expect(def.login_macro_path).toContain('macros/login.macro');
    });

    it('当 login_macro_path 带有单引号时，校验应该通过', () => {
      const caseYaml = `
name: "引号测试2"
login_macro_path: './macros/login.macro'
roles:
  user: { username: "u" }
steps:
  - id: step1
    role: user
    script: "open '/'"
`;
      const filePath = writeYaml('quote-valid-single', caseYaml);
      const def = loadCase(filePath);
      expect(def.login_macro_path).toContain('macros/login.macro');
    });

    it('当 login_macro_path 只有简短宏文件名且带有双引号时 (如 "login.macro")，校验应该通过', () => {
      const caseYaml = `
name: "引号简短测试"
login_macro_path: "login.macro"
roles:
  user: { username: "u" }
steps:
  - id: step1
    role: user
    script: "open '/'"
`;
      const filePath = writeYaml('quote-valid-short', caseYaml);
      const def = loadCase(filePath);
      expect(def.login_macro_path).toBe('login.macro');
    });

    it('当 login_macro_path 没有引号时，校验应该抛出错误', () => {
      const caseYaml = `
name: "无引号测试"
login_macro_path: ./macros/login.macro
roles:
  user: { username: "u" }
steps:
  - id: step1
    role: user
    script: "open '/'"
`;
      const filePath = writeYaml('quote-invalid-none', caseYaml);
      expect(() => loadCase(filePath)).toThrow(/login_macro_path must be enclosed in quotes/);
    });

    it('当 login_macro_path 只有单侧引号时，校验应该抛出错误', () => {
      const caseYaml = `
name: "单侧引号测试"
login_macro_path: "./macros/login.macro
roles:
  user: { username: "u" }
steps:
  - id: step1
    role: user
    script: "open '/'"
`;
      const filePath = writeYaml('quote-invalid-unclosed', caseYaml);
      expect(() => loadCase(filePath)).toThrow(/login_macro_path must be enclosed in matching quotes/);
    });
  });
});

