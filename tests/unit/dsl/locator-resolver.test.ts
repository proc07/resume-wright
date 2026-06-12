// ============================================================
// tests/unit/dsl/locator-resolver.test.ts
// 元素定位解析单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseLocator } from '../../../src/dsl/locator-resolver.js';

describe('Locator Resolver', () => {

describe('parseLocator()', () => {

  describe('文字匹配', () => {
    it('默认精确文字匹配', () => {
      const p = parseLocator('提交申请');
      expect(p.type).toBe('text');
      expect(p.value).toBe('提交申请');
    });

    it('*xxx* 包含匹配', () => {
      const p = parseLocator('*采购*');
      expect(p.type).toBe('text_contains');
      expect(p.value).toBe('采购');
    });

    it('A|B OR 匹配', () => {
      const p = parseLocator('Approve|审批通过');
      expect(p.type).toBe('text_or');
      expect(p.value).toBe('Approve|审批通过');
    });
  });

  describe('前缀定位', () => {
    it('label: 前缀', () => {
      const p = parseLocator('label:申请金额');
      expect(p.type).toBe('label');
      expect(p.value).toBe('申请金额');
    });

    it('placeholder: 前缀', () => {
      const p = parseLocator('placeholder:请输入标题');
      expect(p.type).toBe('placeholder');
      expect(p.value).toBe('请输入标题');
    });

    it('testid: 前缀', () => {
      const p = parseLocator('testid:btn-approve');
      expect(p.type).toBe('testid');
      expect(p.value).toBe('btn-approve');
    });

    it('title: 前缀', () => {
      const p = parseLocator('title:关闭对话框');
      expect(p.type).toBe('title');
      expect(p.value).toBe('关闭对话框');
    });

    it('alt: 前缀', () => {
      const p = parseLocator('alt:用户头像');
      expect(p.type).toBe('alt');
      expect(p.value).toBe('用户头像');
    });
  });

  describe('role: 定位', () => {
    it('带名称的 role', () => {
      const p = parseLocator('role:button[确认]');
      expect(p.type).toBe('role');
      expect(p.value).toBe('button');
      expect(p.roleName).toBe('确认');
    });

    it('不带名称的 role', () => {
      const p = parseLocator('role:dialog');
      expect(p.type).toBe('role');
      expect(p.value).toBe('dialog');
      expect(p.roleName).toBeUndefined();
    });

    it('多种 ARIA 角色', () => {
      const roles = ['button', 'checkbox', 'combobox', 'textbox', 'link'];
      for (const role of roles) {
        const p = parseLocator(`role:${role}[test]`);
        expect(p.value).toBe(role);
      }
    });
  });

  describe('CSS / XPath 定位', () => {
    it('. 开头 CSS 选择器', () => {
      const p = parseLocator('.task-row .btn-approve');
      expect(p.type).toBe('css');
      expect(p.value).toBe('.task-row .btn-approve');
    });

    it('# 开头 CSS ID', () => {
      const p = parseLocator('#submit-btn');
      expect(p.type).toBe('css');
      expect(p.value).toBe('#submit-btn');
    });

    it('// 开头 XPath', () => {
      const p = parseLocator('//div[@data-action="open"]');
      expect(p.type).toBe('xpath');
      expect(p.value).toBe('//div[@data-action="open"]');
    });
  });

  describe('@ 别名', () => {
    it('解析别名名称', () => {
      const p = parseLocator('@关闭弹窗');
      expect(p.type).toBe('alias');
      expect(p.value).toBe('关闭弹窗');
    });

    it('解析带空格的别名', () => {
      const p = parseLocator('@首行审批按钮');
      expect(p.type).toBe('alias');
      expect(p.value).toBe('首行审批按钮');
    });
  });

  describe('修饰符解析', () => {
    it('/0 索引修饰符', () => {
      const p = parseLocator('审批通过/0');
      expect(p.modifier?.index).toBe(0);
      expect(p.value).toBe('审批通过');
    });

    it('/-1 最后一个', () => {
      const p = parseLocator('审批通过/-1');
      expect(p.modifier?.last).toBe(true);
      expect(p.value).toBe('审批通过');
    });

    it('/button 标签修饰符', () => {
      const p = parseLocator('提交/button');
      expect(p.modifier?.tag).toBe('button');
      expect(p.value).toBe('提交');
    });

    it('/2 正整数索引', () => {
      const p = parseLocator('审批人/2');
      expect(p.modifier?.index).toBe(2);
    });

    it('无修饰符时 modifier 为 undefined', () => {
      const p = parseLocator('提交');
      expect(p.modifier).toBeUndefined();
    });
  });

  describe('复合场景', () => {
    it('label: 带修饰符', () => {
      const p = parseLocator('label:申请金额/0');
      expect(p.type).toBe('label');
      expect(p.value).toBe('申请金额');
      expect(p.modifier?.index).toBe(0);
    });

    it('testid 带修饰符', () => {
      const p = parseLocator('testid:status-badge/-1');
      expect(p.type).toBe('testid');
      expect(p.modifier?.last).toBe(true);
    });

    it('前缀/后缀/中位 * 模糊匹配保持 text 类型，由 resolveLocator 处理', () => {
      const p1 = parseLocator('采购*');
      expect(p1.type).toBe('text');
      expect(p1.value).toBe('采购*');

      const p2 = parseLocator('*采购');
      expect(p2.type).toBe('text');
      expect(p2.value).toBe('*采购');

      const p3 = parseLocator('采*购');
      expect(p3.type).toBe('text');
      expect(p3.value).toBe('采*购');
    });
  });
});

describe('resolveInputLocator — 索引修饰符', () => {
  // 注意：这些测试需要在有浏览器环境的情况下才能完整运行
  // 这里只测试 parseLocator 的解析逻辑

  it('应该正确解析带索引修饰符的输入定位器', () => {
    // "username" /0
    const p1 = parseLocator('username');
    expect(p1.type).toBe('text');
    expect(p1.value).toBe('username');
    expect(p1.modifier).toBeUndefined();

    // 带索引的完整字符串
    const p2 = parseLocator('username /0');
    expect(p2.type).toBe('text');
    expect(p2.value).toBe('username');
    expect(p2.modifier?.index).toBe(0);
  });

  it('应该正确解析负数索引', () => {
    const p = parseLocator('username /-1');
    expect(p.type).toBe('text');
    expect(p.value).toBe('username');
    expect(p.modifier?.last).toBe(true);
  });

  it('应该正确解析正整数索引', () => {
    const p = parseLocator('username /2');
    expect(p.type).toBe('text');
    expect(p.value).toBe('username');
    expect(p.modifier?.index).toBe(2);
  });

  it('应该正确解析带前缀和索引的定位器', () => {
    const p = parseLocator('label:用户名 /0');
    expect(p.type).toBe('label');
    expect(p.value).toBe('用户名');
    expect(p.modifier?.index).toBe(0);
  });

  it('应该正确解析 CSS 选择器带索引', () => {
    const p = parseLocator('.input-field /1');
    expect(p.type).toBe('css');
    expect(p.value).toBe('.input-field');
    expect(p.modifier?.index).toBe(1);
  });
});
});
