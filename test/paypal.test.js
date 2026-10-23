import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PayPalClient, buildOrderBody } from '../src/paypal.js';

const plan = {
  id: 'p1',
  currency: 'USD',
  totalCents: 2 * 3899 + 4750,
  lines: [
    { sku: 'BRF-L', name: 'Adult briefs, size L', packs: 2, unitPriceCents: 3899, status: 'ok' },
    { sku: 'BED-PR', name: 'Bed protectors', packs: 1, unitPriceCents: 4750, status: 'ok' },
    { sku: 'GLV-M', name: 'Gloves', packs: 0, unitPriceCents: 6450, status: 'deferred' },
  ],
};
const opts = { brandName: 'Demo Home', returnUrl: 'http://x/r', cancelUrl: 'http://x/c', mockApproveBase: 'http://x/m' };

test('order body follows Orders v2: items add up to item_total and amount', () => {
  const b = buildOrderBody(plan, opts);
  const pu = b.purchase_units[0];
  assert.equal(b.intent, 'CAPTURE');
  assert.equal(pu.amount.value, '125.48');
  assert.equal(pu.amount.breakdown.item_total.value, '125.48');
  assert.equal(pu.items.length, 2);
  const sum = pu.items.reduce((s, i) => s + Number(i.quantity) * Math.round(Number(i.unit_amount.value) * 100), 0);
  assert.equal(sum, 12548);
  assert.equal(b.payment_source.paypal.experience_context.return_url, 'http://x/r');
});

test('order body refuses a plan whose total was tampered with', () => {
  assert.throws(() => buildOrderBody({ ...plan, totalCents: 1 }, opts), /does not match/);
});

test('mock: create -> approve -> capture, and capture cannot run twice or before approval', async () => {
  const pp = new PayPalClient({});
  assert.equal(pp.mode, 'mock');
  const o = await pp.createOrder(plan, opts);
  assert.match(o.approveUrl, /^http:\/\/x\/m\?token=MOCK-/);
  await assert.rejects(pp.captureOrder(o.id), /not approved/);
  pp.mockApprove(o.id);
  const c = await pp.captureOrder(o.id);
  assert.equal(c.status, 'COMPLETED');
  assert.equal(c.amountCents, 12548);
  await assert.rejects(pp.captureOrder(o.id), /already captured/);
});

test('sandbox client: correct endpoints, OAuth, idempotency header, and no secret in errors', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok-123', expires_in: 3600 }), { status: 200 });
    if (url.endsWith('/v2/checkout/orders')) {
      return new Response(JSON.stringify({ id: 'ORDER1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1' }] }), { status: 200 });
    }
    if (url.endsWith('/capture')) return new Response(JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }], debug_id: 'dbg1' }), { status: 422 });
    return new Response('{}', { status: 404 });
  };
  const pp = new PayPalClient({ clientId: 'id-SECRETLIKE', clientSecret: 'shh-very-secret', env: 'sandbox', fetchImpl: fakeFetch });
  assert.equal(pp.mode, 'sandbox');
  const o = await pp.createOrder(plan, opts);
  assert.equal(o.id, 'ORDER1');
  assert.match(o.approveUrl, /sandbox\.paypal\.com/);
  assert.equal(calls[0].url, 'https://api-m.sandbox.paypal.com/v1/oauth2/token');
  assert.equal(calls[0].init.headers.Authorization, 'Basic ' + Buffer.from('id-SECRETLIKE:shh-very-secret').toString('base64'));
  assert.equal(calls[1].init.headers.Authorization, 'Bearer tok-123');
  assert.equal(calls[1].init.headers['PayPal-Request-Id'], 'create-p1');
  const err = await pp.captureOrder('ORDER1').catch((e) => e);
  assert.match(err.message, /ORDER_NOT_APPROVED/);
  assert.ok(!err.message.includes('shh-very-secret') && !err.message.includes('tok-123'));
  assert.equal(calls.filter((c) => c.url.endsWith('/oauth2/token')).length, 1, 'token is cached');
  assert.ok(!JSON.stringify(pp).includes('shh-very-secret'), 'secret not exposed via JSON');
});
