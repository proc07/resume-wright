// ============================================================
// tests/unit/dsl/macro-loader.test.ts
// 宏文件加载与参数替换单元测试
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadMacro } from '../../../src/dsl/macro-loader.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-macro-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeMacro(name: string, content: string): string {
  const filePath = path.join(tmpDir, `${name}.macro`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('Macro Loader', () => {
  it('能够正确替换传统的 $1, $2 位置参数', () => {
    writeMacro('pos_test', `
open "https://example.com"
input "$1" to "label:用户名"
input "$2" to "label:密码"
    `.trim());

    const script = loadMacro('pos_test', ['admin', '123456'], tmpDir);
    expect(script).toHaveLength(3);
    expect(script[1]!.args[0]).toBe('"admin"');
    expect(script[2]!.args[0]).toBe('"123456"');
  });

  it('能够通过 Record<string, string> 直接进行命名参数替换', () => {
    writeMacro('named_test', `
open "https://example.com"
input "$username" to "label:用户名"
input "$password" to "label:密码"
    `.trim());

    const script = loadMacro('named_test', {
      username: 'admin_user',
      password: 'secret_password'
    }, tmpDir);

    expect(script).toHaveLength(3);
    expect(script[1]!.args[0]).toBe('"admin_user"');
    expect(script[2]!.args[0]).toBe('"secret_password"');
  });

  it('使用 Record 时也应当支持 $1, $2 位置参数后备替换', () => {
    writeMacro('fallback_test', `
open "https://example.com"
input "$1" to "label:用户名"
input "$2" to "label:密码"
    `.trim());

    const script = loadMacro('fallback_test', {
      username: 'fallback_user',
      password: 'fallback_password'
    }, tmpDir);

    expect(script).toHaveLength(3);
    expect(script[1]!.args[0]).toBe('"fallback_user"');
    expect(script[2]!.args[0]).toBe('"fallback_password"');
  });

  it('能够通过 # params: 声明将位置参数数组映射为命名参数进行替换', () => {
    writeMacro('param_decl_test', `
# params: username, password
open "https://example.com"
input "$username" to "label:用户名"
input "$password" to "label:密码"
    `.trim());

    const script = loadMacro('param_decl_test', ['mapped_user', 'mapped_password'], tmpDir);
    expect(script).toHaveLength(5);
    expect(script[3]!.args[0]).toBe('"mapped_user"');
    expect(script[4]!.args[0]).toBe('"mapped_password"');
  });

  it('能够替换无引号的布尔和数字字面量，并在重新解析后保持原生类型 (boolean/number)', () => {
    writeMacro('types_test', `
# params: visible, index, name
$vis = $visible
$idx = $index
$nm = $name
    `.trim());

    const script = loadMacro('types_test', ['true', '0', '"33"'], tmpDir);
    expect(script).toHaveLength(6);
    expect(script[3]!.assignSource).toBe('boolean');
    expect(script[3]!.args[0]).toBe('true');
    expect(script[4]!.assignSource).toBe('number');
    expect(script[4]!.args[0]).toBe('0');
    expect(script[5]!.assignSource).toBe('literal');
    expect(script[5]!.args[0]).toBe('33');
  });

  it('防嵌套引号冲突：如果宏内部占位符带有引号，替换带引号参数时应智能剥离引号', () => {
    writeMacro('quotes_test', `
# params: name
$nm = "$name"
    `.trim());

    const script = loadMacro('quotes_test', ['"hello"'], tmpDir);
    expect(script).toHaveLength(2);
    expect(script[1]!.assignSource).toBe('literal');
    expect(script[1]!.args[0]).toBe('hello');
  });

  it('能够自动在宏展开头部合成并插入对应的形参前导赋值语句', () => {
    writeMacro('auto_bind_test', `
# params: visible, count, name
execute_script "visible" "count=100" "name"
    `.trim());

    const script = loadMacro('auto_bind_test', ['true', '50'], tmpDir);
    expect(script).toHaveLength(4);
    expect(script[0]!.assignTarget).toBe('visible');
    expect(script[0]!.args[0]).toBe('true');
    expect(script[0]!.assignSource).toBe('boolean');
    expect(script[1]!.assignTarget).toBe('count');
    expect(script[1]!.args[0]).toBe('50');
    expect(script[1]!.assignSource).toBe('number');
    expect(script[2]!.assignTarget).toBe('name');
    expect(script[2]!.args[0]).toBe('null');
    expect(script[2]!.assignSource).toBe('boolean');
    expect(script[3]!.command).toBe('execute_script');
  });
});
