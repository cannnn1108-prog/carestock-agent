// HTTP server and API. No dependencies beyond Node itself.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { CareStockApp } from './app.js';
import { PayPalClient } from './paypal.js';
import { reviewerFromEnv } from './agent.js';
import { Ledger } from './ledger.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};
const redirect = (res, to) => { res.writeHead(302, { Location: to }); res.end(); };

function mockPayPalPage(app, token) {
  const planId = app.orders.get(token);
  const plan = planId && app.plans.get(planId);
  const total = plan ? `$${(plan.approved.totalCents / 100).toFixed(2)}` : '-';
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PayPal (mock checkout)</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f7fa;display:grid;place-items:center;min-height:100vh;margin:0}
.card{background:#fff;border-radius:12px;padding:28px;max-width:360px;box-shadow:0 2px 12px #0002;text-align:center}
.tag{font-size:12px;color:#8a5a00;background:#fff3cd;border-radius:6px;padding:4px 8px;display:inline-block}
a.btn{display:block;margin-top:14px;padding:12px;border-radius:24px;text-decoration:none;font-weight:600}
.pay{background:#ffc439;color:#111}.cancel{color:#0070ba}</style>
<div class="card"><div class="tag">MOCK MODE - no real PayPal call, no money moves</div>
<h2>Pay ${esc(total)}</h2><p>${esc(app.facility.name)}<br>Order ${esc(token)}</p>
<a class="btn pay" href="/paypal/mock-approve/confirm?token=${encodeURIComponent(token)}">Pay now</a>
<a class="btn cancel" href="/paypal/cancel?token=${encodeURIComponent(token)}">Cancel and return</a></div>`;
}

export function buildServer(app) {
  const indexHtml = () => readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    try {
      if (req.method === 'GET' && p === '/') return send(res, 200, indexHtml(), 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/api/status') return send(res, 200, app.status());
      if (req.method === 'GET' && p === '/api/ledger') return send(res, 200, { verify: app.ledger.verify(), entries: app.ledger.entries });
      if (req.method === 'POST' && p === '/api/plans') return send(res, 201, await app.propose());
      const m = p.match(/^\/api\/plans\/([\w-]+)\/approve$/);
      if (req.method === 'POST' && m) {
        const body = await readJson(req);
        const skus = Array.isArray(body.skus) ? body.skus.map(String) : undefined;
        return send(res, 200, await app.approve(m[1], { approver: body.approver, skus }));
      }
      if (req.method === 'GET' && p === '/paypal/mock-approve') {
        if (app.paypal.mode !== 'mock') return send(res, 404, { error: 'not in mock mode' });
        return send(res, 200, mockPayPalPage(app, url.searchParams.get('token') || ''), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && p === '/paypal/mock-approve/confirm') {
        if (app.paypal.mode !== 'mock') return send(res, 404, { error: 'not in mock mode' });
        const token = url.searchParams.get('token') || '';
        app.paypal.mockApprove(token);
        return redirect(res, `/paypal/return?token=${encodeURIComponent(token)}`);
      }
      if (req.method === 'GET' && p === '/paypal/return') {
        const { plan } = await app.capture(url.searchParams.get('token') || '');
        return redirect(res, `/?paid=${encodeURIComponent(plan.id)}`);
      }
      if (req.method === 'GET' && p === '/paypal/cancel') {
        const plan = app.cancel(url.searchParams.get('token') || '');
        return redirect(res, `/?cancelled=${encodeURIComponent(plan?.id || '')}`);
      }
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(`[error] ${req.method} ${p}: ${err.message}`);
      return send(res, status, { error: err.message });
    }
  });
}

export function appFromEnv(env = process.env) {
  const port = Number(env.PORT || 3000);
  return new CareStockApp({
    paypal: PayPalClient.fromEnv(env),
    reviewer: reviewerFromEnv(env),
    ledger: new Ledger(join(ROOT, 'data', 'ledger.jsonl')),
    baseUrl: env.BASE_URL || `http://localhost:${port}`,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const app = appFromEnv();
  const port = Number(process.env.PORT || 3000);
  buildServer(app).listen(port, () => {
    // Only modes are printed, never key values.
    console.log(`CareStock Agent on http://localhost:${port}  (PayPal: ${app.paypal.mode}, reviewer: ${app.reviewer.name})`);
  });
}
