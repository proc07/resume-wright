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

const serverDB: {
  purchases: Record<string, Purchase>;
  invoices: Record<string, Invoice>;
} = {
  purchases: {},
  invoices: {},
};

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
