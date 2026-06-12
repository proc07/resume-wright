import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

interface Purchase {
  id: string;
  title: string;
  amount: number;
  reason: string;
  urgent: boolean;
  createdBy: string;
  status: 'pending_manager' | 'pending_finance' | 'approved' | 'rejected';
  mgrComment?: string;
  finComment?: string;
  createdAt: string;
}

interface Invoice {
  id: string;
  title: string;
  amount: number;
  expenseType: string;
  status: 'pending_review' | 'approved';
  reviewerComment?: string;
  createdAt: string;
}

interface Merchant {
  id: string;
  shopName: string;
  deposit: number;
  licenseFile?: string;
  status: 'pending_compliance' | 'compliance_rejected' | 'pending_finance' | 'approved';
  complianceComment?: string;
  financeComment?: string;
  creditLimit?: number;
  contractSigned?: boolean;
  createdAt: string;
}

const serverDB: {
  purchases: Record<string, Purchase>;
  invoices: Record<string, Invoice>;
  merchants: Record<string, Merchant>;
  checklist: Record<string, string>;
} = {
  purchases: {},
  invoices: {},
  merchants: {},
  checklist: {
    checklist_title: '',
    checklist_status: '',
  },
};

let uiFailCount = 0;
let apiFailCount = 0;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

function jsonRes(res: http.ServerResponse, code: number, data: unknown) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ── UI Locator Fail Demo
  if (pathname === '/ui-locator-fail' && req.method === 'GET') {
    uiFailCount++;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const isFirstRun = (uiFailCount % 2 === 1);
    
    const buttonHtml = isFirstRun
      ? `<button class="btn btn-primary" id="wrong-btn" disabled style="background:#4b5563;">请等待... (第 ${uiFailCount} 次请求，未就绪)</button>`
      : `<button class="btn btn-success" id="confirm-btn" style="background:#10b981;color:white;" onclick="document.getElementById('result').textContent='成功完成'">点击确认</button>`;
      
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>UI Locator Retry Demo</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #0b0f19; color: #f8fafc; padding: 40px; text-align: center; }
          .card { background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 28px; max-width: 450px; margin: auto; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          .btn { padding: 10px 20px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; margin-top: 20px; font-size: 14px; }
          #result { margin-top: 20px; font-weight: bold; color: #10b981; font-size: 18px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>UI 节点获取重试演示</h2>
          <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin-top:10px;">
            如果是第一次执行，页面上将不存在 id 为 <code style="color:#38bdf8;">confirm-btn</code> 的可点击按钮，从而触发测试失败。<br>
            再次运行（或续跑/重新跑）时，按钮将正确出现，完成测试。
          </p>
          ${buttonHtml}
          <div id="result"></div>
        </div>
      </body>
      </html>
    `);
    return;
  }

  // ── API Fail Once Demo
  if (pathname === '/api/fail-once' && req.method === 'GET') {
    apiFailCount++;
    if (apiFailCount % 2 === 1) {
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: `Internal Server Error (Fail count: ${apiFailCount})` }));
      return;
    }
    return jsonRes(res, 200, { status: "ok", count: apiFailCount });
  }

  // ── CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── GET /api/purchases — 列表
  if (pathname === '/api/purchases' && req.method === 'GET') {
    return jsonRes(res, 200, Object.values(serverDB.purchases));
  }

  // ── POST /api/purchases — 创建
  if (pathname === '/api/purchases' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const id = 'PO-' + Date.now().toString(36).toUpperCase();
    const purchase: Purchase = {
      id,
      status: 'pending_manager',
      createdAt: new Date().toISOString(),
      ...body,
    };
    serverDB.purchases[id] = purchase;
    return jsonRes(res, 201, purchase);
  }

  // ── GET /api/purchases/:id
  if (pathname.startsWith('/api/purchases/') && req.method === 'GET') {
    const id = pathname.split('/')[3]!;
    const p = serverDB.purchases[id];
    if (!p) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    return jsonRes(res, 200, p);
  }

  // ── PATCH /api/purchases/:id — 更新状态
  if (pathname.startsWith('/api/purchases/') && req.method === 'PATCH') {
    const id = pathname.split('/')[3]!;
    const body = JSON.parse(await readBody(req));
    if (!serverDB.purchases[id]) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    Object.assign(serverDB.purchases[id]!, body);
    return jsonRes(res, 200, serverDB.purchases[id]);
  }

  // ── GET /api/invoice/:id
  if (pathname.startsWith('/api/invoice/') && req.method === 'GET') {
    const id = pathname.split('/')[3]!;
    const inv = serverDB.invoices[id];
    if (!inv) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    return jsonRes(res, 200, { data: inv });
  }

  // ── POST /api/invoice
  if (pathname === '/api/invoice' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const id = 'INV-' + Date.now().toString(36).toUpperCase();
    const invoice: Invoice = {
      id,
      status: 'pending_review',
      createdAt: new Date().toISOString(),
      ...body,
    };
    serverDB.invoices[id] = invoice;
    return jsonRes(res, 201, { data: invoice });
  }

  // ── PATCH /api/invoice/:id
  if (pathname.startsWith('/api/invoice/') && req.method === 'PATCH') {
    const id = pathname.split('/')[3]!;
    const body = JSON.parse(await readBody(req));
    if (!serverDB.invoices[id]) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    Object.assign(serverDB.invoices[id]!, body);
    return jsonRes(res, 200, { data: serverDB.invoices[id] });
  }

  // ── GET /api/compliance/check/:id
  if (pathname.startsWith('/api/compliance/check/') && req.method === 'GET') {
    const id = pathname.split('/')[4]!;
    const merchant = serverDB.merchants[id];
    if (!merchant) {
      return jsonRes(res, 404, { error: 'Merchant not found' });
    }
    // 根据上传的执照文件名返回对应的机审分
    const score = merchant.licenseFile?.includes('license_v2') ? 95 : 52;
    return jsonRes(res, 200, { score });
  }

  // ── GET /api/merchants
  if (pathname === '/api/merchants' && req.method === 'GET') {
    return jsonRes(res, 200, { data: Object.values(serverDB.merchants) });
  }

  // ── GET /api/merchants/:id
  if (pathname.startsWith('/api/merchants/') && req.method === 'GET') {
    const id = pathname.split('/')[3]!;
    const merchant = serverDB.merchants[id];
    if (!merchant) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    return jsonRes(res, 200, { data: merchant });
  }

  // ── POST /api/merchants
  if (pathname === '/api/merchants' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const id = 'MER-' + Date.now().toString(36).toUpperCase();
    const merchant: Merchant = {
      id,
      status: 'pending_compliance',
      createdAt: new Date().toISOString(),
      ...body,
    };
    serverDB.merchants[id] = merchant;
    return jsonRes(res, 201, { data: merchant });
  }

  // ── PATCH /api/merchants/:id
  if (pathname.startsWith('/api/merchants/') && req.method === 'PATCH') {
    const id = pathname.split('/')[3]!;
    const body = JSON.parse(await readBody(req));
    if (!serverDB.merchants[id]) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    Object.assign(serverDB.merchants[id]!, body);
    return jsonRes(res, 200, { data: serverDB.merchants[id] });
  }

  // ── GET /checklist ( Checklist 动态表单页面 )
  if (pathname === '/checklist' && req.method === 'GET') {
    const checklistHtmlPath = path.join(import.meta.dirname, 'tests/integration/fixtures/checklist-app.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(checklistHtmlPath).pipe(res);
    return;
  }

  // ── GET /api/form
  if (pathname === '/api/form' && req.method === 'GET') {
    const formStructure = [
      { id: 'checklist_title', label: '检查标题', type: 'text' },
      { id: 'checklist_status', label: '检查意见', type: 'text' }
    ];
    return jsonRes(res, 200, formStructure);
  }

  // ── GET /api/form/processdata
  if (pathname === '/api/form/processdata' && req.method === 'GET') {
    return jsonRes(res, 200, { data: serverDB.checklist });
  }

  // ── POST /api/form/submit
  if (pathname === '/api/form/submit' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    Object.assign(serverDB.checklist, body);
    return jsonRes(res, 200, { success: true });
  }

  // ── POST /api/form/reset
  if (pathname === '/api/form/reset' && req.method === 'POST') {
    serverDB.checklist = {
      checklist_title: '',
      checklist_status: '',
    };
    return jsonRes(res, 200, { success: true });
  }

  // ── GET /input-index-demo ( 索引修饰符演示页面 )
  if (pathname === '/input-index-demo' && req.method === 'GET') {
    const htmlPath = path.join(import.meta.dirname, 'tests/integration/fixtures/input-index-demo.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(htmlPath).pipe(res);
    return;
  }

  // ── GET /api/input-index-demo/result
  if (pathname === '/api/input-index-demo/result' && req.method === 'GET') {
    return jsonRes(res, 200, { data: (globalThis as any).__formResult || {} });
  }

  // ── Serve HTML for all other routes
  const htmlPath = path.join(import.meta.dirname, 'tests/integration/fixtures/demo-app.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(htmlPath).pipe(res);
});

const PORT = 61775;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[demo-server] Server running at http://127.0.0.1:${PORT}/`);
  console.log(`[demo-server] API Endpoint: http://127.0.0.1:${PORT}/api/purchases`);
});
