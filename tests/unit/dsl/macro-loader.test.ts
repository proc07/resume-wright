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
    expect(script).toHaveLength(3);
    expect(script[1]!.args[0]).toBe('"mapped_user"');
    expect(script[2]!.args[0]).toBe('"mapped_password"');
  });
});
