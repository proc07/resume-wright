// ============================================================
// tests/unit/dashboard/server-requests.test.ts
// Dashboard API 请求单元测试
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleRequest } from '../../../src/dashboard/server.js';
import { getSafeCaseName } from '../../../src/engine/checkpoint.js';

const mockReq = (url: string) => {
  return {
    url,
    method: 'GET',
    headers: { host: 'localhost' },
    on: vi.fn(),
  } as unknown as http.IncomingMessage;
};

const mockRes = () => {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let responseData = '';
  let ended = false;
  return {
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
    writeHead(code: number, hdrs?: any) {
      statusCode = code;
      if (hdrs) Object.assign(headers, hdrs);
      return this;
    },
    write(chunk: any) {
      responseData += chunk;
      return this;
    },
    end(data?: any) {
      if (data) responseData += data;
      ended = true;
      return this;
    },
    getStatusCode() { return statusCode; },
    getHeaders() { return headers; },
    getResponseData() { return responseData; },
    isEnded() { return ended; },
  } as unknown as http.ServerResponse & {
    getStatusCode: () => number;
    getHeaders: () => Record<string, string>;
    getResponseData: () => string;
    isEnded: () => boolean;
  };
};

describe('Dashboard Server Requests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/screenshots/:encodedCaseName/:fileName', () => {
    it('正确解析包含 URL 编码和中文字符的案例路径并定位到正确的物理文件', async () => {
      const caseName = '商户入驻资质审核与退回重审流程';
      const encodedCaseName = encodeURIComponent(caseName);
      const safeCaseName = getSafeCaseName(caseName); // "%E5%95%86%E6%88%B7..."
      const fileName = 'testid_merchant-upload-status-step1_merchant_submit.png';
      
      const requestUrl = `/api/screenshots/${encodedCaseName}/${encodeURIComponent(fileName)}`;
      const req = mockReq(requestUrl);
      const res = mockRes();

      // 监视 fs.existsSync 和 fs.createReadStream
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      
      // 模拟 createReadStream 并返回一个假的 pipe 行为
      const mockReadStream = {
        pipe: vi.fn().mockImplementation((destRes) => {
          destRes.end('mock-image-data');
        }),
      } as any;
      const readStreamSpy = vi.spyOn(fs, 'createReadStream').mockReturnValue(mockReadStream);

      await handleRequest(req, res);

      const expectedFilePath = path.join('.resumewright', safeCaseName, 'screenshots', fileName);

      expect(existsSpy).toHaveBeenCalledWith(expectedFilePath);
      expect(readStreamSpy).toHaveBeenCalledWith(expectedFilePath);
      expect(res.getStatusCode()).toBe(200);
      expect(res.getHeaders()['Content-Type']).toBe('image/png');
      expect(res.getResponseData()).toBe('mock-image-data');
    });

    it('如果截图文件不存在，则返回 404', async () => {
      const requestUrl = `/api/screenshots/someCase/nonexistent.png`;
      const req = mockReq(requestUrl);
      const res = mockRes();

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      await handleRequest(req, res);

      expect(res.getStatusCode()).toBe(404);
      expect(res.getResponseData()).toBe('Not found');
    });
  });
});
