// ============================================================
// tests/unit/dsl/parser.test.ts
// DSL 解析器单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseScript } from '../../../src/dsl/parser.js';

describe('DSL Parser', () => {

  // ── 基础命令解析 ───────────────────────────────────────────

  describe('open 命令', () => {
    it('解析绝对 URL', () => {
      const result = parseScript('open "https://app.example.com"');
      expect(result).toHaveLength(1);
      expect(result[0]!.command).toBe('open');
      expect(result[0]!.args[0]).toBe('"https://app.example.com"');
    });

    it('解析带变量的 URL', () => {
      const result = parseScript('open "$workflow_url"');
      expect(result[0]!.command).toBe('open');
      expect(result[0]!.args[0]).toBe('"$workflow_url"');
    });
  });

  describe('tap 命令', () => {
    it('解析文字匹配', () => {
      const result = parseScript('tap "提交申请"');
      expect(result[0]!.command).toBe('tap');
      expect(result[0]!.args[0]).toBe('"提交申请"');
    });

    it('解析 role 定位', () => {
      const result = parseScript('tap "role:button[确认提交]"');
      expect(result[0]!.command).toBe('tap');
      expect(result[0]!.args[0]).toBe('"role:button[确认提交]"');
    });

    it('解析带修饰符 /0', () => {
      const result = parseScript('tap "审批通过"/0');
      expect(result[0]!.command).toBe('tap');
      // tokenizer 会把 "审批通过"/0 整体作为一个 token 或拆分
      // locator-resolver 负责解析修饰符；parser 只需保留原始字符串
      const locatorArg = result[0]!.args[0]!;
      expect(locatorArg).toContain('审批通过');
    });

    it('解析坐标点击', () => {
      const result = parseScript('tap 0.5 0.5');
      expect(result[0]!.command).toBe('tap');
      expect(result[0]!.args).toEqual(['0.5', '0.5']);
    });

    it('解析 ? 非阻塞前缀', () => {
      const result = parseScript('? tap "跳过引导"');
      expect(result[0]!.optional).toBe(true);
      expect(result[0]!.command).toBe('tap');
    });
  });

  describe('input 命令', () => {
    it('解析带 to 的输入', () => {
      const result = parseScript('input "Q3 采购" to "label:申请标题"');
      expect(result[0]!.command).toBe('input');
      expect(result[0]!.args[0]).toBe('"Q3 采购"');
      expect(result[0]!.args[1]).toBe('to');
      expect(result[0]!.args[2]).toBe('"label:申请标题"');
    });

    it('解析清空（空字符串）', () => {
      const result = parseScript('input "" to "label:备注"');
      expect(result[0]!.args[0]).toBe('""');
    });

    it('解析无 to 的输入（焦点元素）', () => {
      const result = parseScript('input "内容"');
      expect(result[0]!.args).toHaveLength(1);
    });
  });

  describe('assert_exists 命令', () => {
    it('解析基础断言', () => {
      const result = parseScript('assert_exists "提交成功"');
      expect(result[0]!.command).toBe('assert_exists');
      expect(result[0]!.args[0]).toBe('"提交成功"');
    });

    it('解析带超时', () => {
      const result = parseScript('assert_exists "提交成功" 30s');
      expect(result[0]!.args[1]).toBe('30s');
    });

    it('解析 ? 可选断言', () => {
      const result = parseScript('? assert_exists "已归档" 5s');
      expect(result[0]!.optional).toBe(true);
      expect(result[0]!.command).toBe('assert_exists');
    });
  });

  describe('assert_url 命令', () => {
    it('解析基础 URL 断言', () => {
      const result = parseScript('assert_url "/purchase/new"');
      expect(result[0]!.command).toBe('assert_url');
      expect(result[0]!.args[0]).toBe('"/purchase/new"');
    });

    it('解析带超时 URL 断言', () => {
      const result = parseScript('assert_url "/purchase/new" 15s');
      expect(result[0]!.command).toBe('assert_url');
      expect(result[0]!.args[0]).toBe('"/purchase/new"');
      expect(result[0]!.args[1]).toBe('15s');
    });
  });

  describe('HTTP 命令', () => {
    it('解析 do_get', () => {
      const result = parseScript('do_get "https://api.example.com/data"');
      expect(result[0]!.command).toBe('do_get');
      expect(result[0]!.args[0]).toBe('"https://api.example.com/data"');
    });

    it('解析 do_post 带状态码', () => {
      const result = parseScript('do_post "https://api.example.com/submit" 201');
      expect(result[0]!.command).toBe('do_post');
      expect(result[0]!.args[1]).toBe('201');
    });

    it('解析 do_post 带多行 body', () => {
      const script = `do_post "https://api.example.com/submit"\n"""\n{"action":"approve"}\n"""`;
      const result = parseScript(script);
      expect(result[0]!.command).toBe('do_post');
      expect(result[0]!.block).toContain('{"action":"approve"}');
    });
  });

  describe('变量赋值', () => {
    it('解析 current_url', () => {
      const result = parseScript('$workflow_url = current_url');
      expect(result[0]!.command).toBe(null);
      expect(result[0]!.assignTarget).toBe('workflow_url');
      expect(result[0]!.assignSource).toBe('current_url');
    });

    it('解析 url_match', () => {
      const result = parseScript('$id = url_match "/workflow/([\\w-]+)"');
      expect(result[0]!.assignSource).toBe('url_match');
      expect(result[0]!.args[0]).toContain('workflow');
    });

    it('解析 url_param', () => {
      const result = parseScript('$id = url_param "workflowId"');
      expect(result[0]!.assignSource).toBe('url_param');
      expect(result[0]!.args[0]).toBe('workflowId');
    });

    it('解析定位器提取 (locator)', () => {
      const result = parseScript('$status = ".workflow-status"');
      expect(result[0]!.assignSource).toBe('locator');
      expect(result[0]!.args[0]).toBe('.workflow-status');
    });

    it('解析字面量字符串赋值 (literal)', () => {
      const result = parseScript('$date_format = "YYYY/MM/DD"');
      expect(result[0]!.assignSource).toBe('literal');
      expect(result[0]!.args[0]).toBe('YYYY/MM/DD');
    });

    it('解析 HTTP 响应赋值', () => {
      const result = parseScript('$res = do_get "https://api.example.com/data"');
      expect(result[0]!.assignSource).toBe('http');
      expect(result[0]!.args[0]).toBe('do_get');
    });

    it('解析变量引用赋值', () => {
      const result = parseScript('$task_id = $res.data.currentTask.id');
      expect(result[0]!.assignSource).toBe('var_ref');
      expect(result[0]!.args[0]).toBe('res.data.currentTask.id');
    });

    it('解析 execute_script 多行', () => {
      const script = '$count = execute_script\n"""\nreturn document.querySelectorAll(\'.row\').length;\n"""';
      const result = parseScript(script);
      expect(result[0]!.assignSource).toBe('execute_script');
      expect(result[0]!.block).toContain('querySelectorAll');
    });
  });

  describe('宏命令', () => {
    it('解析无参宏', () => {
      const result = parseScript('macro close_dialog');
      expect(result[0]!.command).toBe('macro');
      expect(result[0]!.args[0]).toBe('close_dialog');
    });

    it('解析带参数宏', () => {
      const result = parseScript('macro login "user@co.com" "pass123"');
      expect(result[0]!.command).toBe('macro');
      expect(result[0]!.args[1]).toBe('"user@co.com"');
      expect(result[0]!.args[2]).toBe('"pass123"');
    });
  });

  describe('keyboard / hover / scroll_to', () => {
    it('解析 keyboard 单键', () => {
      const result = parseScript('keyboard "ENTER"');
      expect(result[0]!.command).toBe('keyboard');
    });

    it('解析 keyboard 组合键', () => {
      const result = parseScript('keyboard "CONTROL" "A"');
      expect(result[0]!.args).toHaveLength(2);
    });

    it('解析 wait 秒数', () => {
      const result = parseScript('wait 2s');
      expect(result[0]!.command).toBe('wait');
      expect(result[0]!.args[0]).toBe('2s');
    });
  });

  describe('注释和空行', () => {
    it('忽略 # 注释行', () => {
      const result = parseScript('# 这是注释\ntap "按钮"');
      expect(result).toHaveLength(1);
      expect(result[0]!.command).toBe('tap');
    });

    it('将空行解析为 boundary 指令并保留以作隔离边界', () => {
      const result = parseScript('\n\ntap "按钮"\n\n');
      expect(result).toHaveLength(5);
      expect(result[0]!.command).toBe('boundary');
      expect(result[1]!.command).toBe('boundary');
      expect(result[2]!.command).toBe('tap');
      expect(result[3]!.command).toBe('boundary');
      expect(result[4]!.command).toBe('boundary');
    });

    it('解析多行脚本', () => {
      const script = `
open "https://app.example.com"
tap "role:button[提交]"
$url = current_url
assert_exists "成功" 10s
      `.trim();
      const result = parseScript(script);
      expect(result).toHaveLength(4);
      expect(result.map(r => r.command)).toEqual(['open', 'tap', null, 'assert_exists']);
    });
  });
});
