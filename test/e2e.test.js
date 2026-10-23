// Full flow over HTTP in mock mode: propose -> approve -> PayPal (mock) -> return/capture -> audit trail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';
import { CareStockApp } from '../src/app.js';
import { PayPalClient } from '../src/paypal.js';

async function start() {
  const app = new CareStockApp({ paypal: new PayPalClient({}) });
  const server = buildServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  app.baseUrl = base;
  return { app, server, base };
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test('e2e: mock flow from proposal to recorded payment', async (t) => {
  const { app, server, base } = await start();
  t.after(() => server.close());

  const home = await fetch(base + '/');
  const html = await home.text();
  assert.ok(html.startsWith('<!doctype html><meta charset="utf-8">'));

  const plan = await (await post(base + '/api/plans')).json();
  assert.equal(plan.status, 'proposed');
  assert.ok(plan.totalCents > 0 && plan.totalCents <= plan.capCents);

  // Approval without a name is refused.
  assert.equal((await post(`${base}/api/plans/${plan.id}/approve`, {})).status, 400);

  const firstOk = plan.lines.find((l) => l.status === 'ok');
  const ap = await (await post(`${base}/api/plans/${plan.id}/approve`, { approver: 'Nurse on duty', skus: [firstOk.sku] })).json();
  assert.equal(ap.totalCents, firstOk.lineTotalCents, 'only the ticked line is paid');
  // A second tap does not create a second order.
  assert.equal((await post(`${base}/api/plans/${plan.id}/approve`, { approver: 'Nurse on duty' })).status, 409);

  const page = await fetch(ap.approveUrl);
  assert.match(await page.text(), /MOCK MODE/);
  const confirm = await fetch(`${base}/paypal/mock-approve/confirm?token=${ap.orderId}`, { redirect: 'manual' });
  assert.equal(confirm.status, 302);
  const ret = await fetch(base + confirm.headers.get('location'), { redirect: 'manual' });
  assert.equal(ret.status, 302);
  assert.equal(ret.headers.get('location'), `/?paid=${plan.id}`);

  const ledger = await (await fetch(base + '/api/ledger')).json();
  assert.deepEqual(ledger.entries.map((e) => e.type), ['plan_proposed', 'plan_approved', 'paypal_order_created', 'payment_captured']);
  assert.equal(ledger.entries[1].actor, 'Nurse on duty');
  assert.equal(ledger.entries[3].data.amountCents, firstOk.lineTotalCents);
  assert.equal(ledger.verify.ok, true);

  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(status.spentThisMonthCents, firstOk.lineTotalCents);
  const inv = status.inventory.find((i) => i.sku === firstOk.sku);
  assert.equal(inv.onOrder, firstOk.packs * firstOk.packSize);
  assert.ok(app.ledger.verify().ok);
});

test('e2e: cancelling on PayPal records the cancellation and charges nothing', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const plan = await (await post(base + '/api/plans')).json();
  const ap = await (await post(`${base}/api/plans/${plan.id}/approve`, { approver: 'Night shift lead' })).json();
  const c = await fetch(`${base}/paypal/cancel?token=${ap.orderId}`, { redirect: 'manual' });
  assert.equal(c.headers.get('location'), `/?cancelled=${plan.id}`);
  const ledger = await (await fetch(base + '/api/ledger')).json();
  assert.equal(ledger.entries.at(-1).type, 'payment_cancelled');
  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(status.spentThisMonthCents, 0);
});
