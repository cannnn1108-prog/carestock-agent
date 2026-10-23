import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastItem, draftReorder } from '../src/forecast.js';
import { applyPolicy } from '../src/policy.js';
import { Ledger } from '../src/ledger.js';
import { validateReview, proposePlan } from '../src/agent.js';
import { demoInventory, demoPolicy, FACILITY } from '../src/demo-data.js';

const item = (over = {}) => ({ sku: 'X', name: 'X', unit: 'u', packSize: 10, unitPriceCents: 1000, supplier: 'S', leadTimeDays: 3, stock: 20, onOrder: 0, usage14d: Array(14).fill(10), ...over });

test('forecast: flat usage gives exact daily rate and days left', () => {
  const f = forecastItem(item());
  assert.equal(f.daily, 10);
  assert.equal(f.daysLeft, 2);
  assert.equal(f.safety, 0);
});

test('forecast: rising usage leans on the recent week', () => {
  const f = forecastItem(item({ usage14d: [...Array(7).fill(10), ...Array(7).fill(20)] }));
  assert.equal(f.daily, 20);
  assert.equal(f.trendPct, 100);
});

test('draft: well-stocked items are skipped, low ones ordered in whole packs', () => {
  const lines = draftReorder([item({ sku: 'LOW' }), item({ sku: 'FULL', stock: 1000 })], { coverDays: 14 });
  assert.deepEqual(lines.map((l) => l.sku), ['LOW']);
  // need = 10 * (3 + 14) - 20 = 150 units -> 15 packs of 10
  assert.equal(lines[0].packs, 15);
  assert.equal(lines[0].urgency, 'high');
});

test('policy: blocks unknown suppliers, caps packs and stays under the order limit', () => {
  const policy = { maxOrderCents: 5000, monthlyBudgetCents: 100000, maxPacksPerLine: 3, allowedSuppliers: ['S'] };
  const r = applyPolicy([
    { sku: 'A', supplier: 'S', packs: 9, unitPriceCents: 1000 },
    { sku: 'B', supplier: 'Shady', packs: 1, unitPriceCents: 10 },
    { sku: 'C', supplier: 'S', packs: 4, unitPriceCents: 1000 },
  ], policy);
  const by = Object.fromEntries(r.lines.map((l) => [l.sku, l]));
  assert.equal(by.A.packs, 3);
  assert.equal(by.B.status, 'blocked');
  assert.equal(by.C.packs, 2); // only $20 of the $50 limit was left
  assert.equal(r.totalCents, 5000);
  assert.ok(r.totalCents <= policy.maxOrderCents);
});

test('policy: monthly budget already used up means nothing is bought', () => {
  const policy = { maxOrderCents: 5000, monthlyBudgetCents: 10000, maxPacksPerLine: 5, allowedSuppliers: ['S'] };
  const r = applyPolicy([{ sku: 'A', supplier: 'S', packs: 1, unitPriceCents: 100 }], policy, { spentThisMonthCents: 10000 });
  assert.equal(r.totalCents, 0);
  assert.equal(r.lines[0].status, 'deferred');
});

test('AI review: unknown SKUs, junk and oversized changes are rejected or bounded', () => {
  const draft = [{ sku: 'A', packs: 4, notes: [] }, { sku: 'B', packs: 2, notes: [] }];
  const r = validateReview(draft, {
    summary: 'ok',
    adjustments: { A: 100, B: 1, EVIL: 50, C: 'lots' },
    notes: { A: 'flu season', Z: 'ignored' },
  });
  assert.equal(r.lines.find((l) => l.sku === 'A').packs, 6); // +50% max
  assert.equal(r.lines.find((l) => l.sku === 'B').packs, 1);
  assert.ok(!r.lines.some((l) => l.sku === 'EVIL'));
  assert.deepEqual(r.applied.map((a) => a.sku), ['A', 'B']);
});

test('ledger: hash chain verifies and detects tampering', () => {
  const l = new Ledger();
  l.append('a', 'x', { amountCents: 1 });
  l.append('payment_captured', 'system', { amountCents: 500 });
  assert.deepEqual(l.verify(), { ok: true, count: 2 });
  assert.equal(l.spentThisMonthCents(), 500);
  l.entries[1].data.amountCents = 1; // someone edits the amount
  assert.deepEqual(l.verify(), { ok: false, brokenAt: 2 });
});

test('agent: a failing AI falls back to rules and policy still applies', async () => {
  const ledger = new Ledger();
  const broken = { name: 'broken', review: async () => { throw new Error('timeout'); } };
  const plan = await proposePlan({ inventory: demoInventory(), policy: demoPolicy(), ledger, reviewer: broken, facility: FACILITY });
  assert.match(plan.reviewer, /AI unavailable: timeout/);
  assert.ok(plan.totalCents > 0 && plan.totalCents <= demoPolicy().maxOrderCents);
  assert.equal(ledger.entries[0].type, 'plan_proposed');
});

test('agent: a greedy AI cannot push the order over the limit', async () => {
  const greedy = { name: 'greedy', review: async (draft) => ({ summary: 'buy everything', adjustments: Object.fromEntries(draft.map((l) => [l.sku, 999])) }) };
  const plan = await proposePlan({ inventory: demoInventory(), policy: demoPolicy(), ledger: new Ledger(), reviewer: greedy, facility: FACILITY });
  assert.ok(plan.totalCents <= demoPolicy().maxOrderCents);
  for (const l of plan.lines) assert.ok(l.packs <= demoPolicy().maxPacksPerLine);
});

test('Claude reviewer: calls the Messages API and its JSON goes through validation', async () => {
  const { claudeReviewer } = await import('../src/agent.js');
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, init };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Here you go: {"summary":"Gloves first.","adjustments":{"GLV-M":3},"notes":{"GLV-M":"usage rising"}}' }] }), { status: 200 });
  };
  const r = claudeReviewer({ apiKey: 'k-test', model: 'm-test', fetchImpl: fakeFetch });
  const out = await r.review([{ sku: 'GLV-M', packs: 5 }], {});
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(JSON.parse(sent.init.body).model, 'm-test');
  const v = validateReview([{ sku: 'GLV-M', packs: 5, notes: [] }], out);
  assert.equal(v.lines[0].packs, 3);
  assert.equal(v.summary, 'Gloves first.');
});
