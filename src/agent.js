// The purchasing agent: rules draft the order, an LLM (Claude) may review it,
// and the policy always has the last word. Without ANTHROPIC_API_KEY the agent
// uses a deterministic explainer so the demo runs end to end offline.
import { randomUUID } from 'node:crypto';
import { draftReorder } from './forecast.js';
import { applyPolicy, fmt } from './policy.js';

// Deterministic fallback "reviewer": explains the draft in plain English.
export const ruleReviewer = {
  name: 'rules (no AI key)',
  async review(draft) {
    const high = draft.filter((l) => l.urgency === 'high');
    const summary = draft.length === 0
      ? 'Everything is stocked for the next two weeks. No order needed today.'
      : `${draft.length} item(s) need restocking` + (high.length ? `, ${high.length} urgent: ${high.map((l) => l.name).join(', ')}.` : '.');
    return { summary, adjustments: {}, notes: {} };
  },
};

// Claude reviewer. It can comment and nudge quantities, but cannot add items,
// change prices or suppliers, and every suggestion is re-checked by validateReview().
export function claudeReviewer({ apiKey, model = 'claude-sonnet-4-5', fetchImpl = globalThis.fetch }) {
  return {
    name: `Claude (${model})`,
    async review(draft, context) {
      const prompt = [
        'You are a purchasing assistant for a residential care home. Review this restock draft.',
        'Reply with JSON only: {"summary": string (<= 2 sentences, plain English for care staff),',
        '"adjustments": {sku: packs}, "notes": {sku: string}}.',
        'Only adjust when the numbers clearly justify it. Never add new SKUs.',
        `Context: ${JSON.stringify(context)}`,
        `Draft: ${JSON.stringify(draft.map(({ sku, name, packs, packSize, daysLeft, urgency, reasons }) => ({ sku, name, packs, packSize, daysLeft, urgency, reasons })))}`,
      ].join('\n');
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) throw new Error(`Claude API failed (HTTP ${res.status})`);
      const json = await res.json();
      const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Claude reply had no JSON');
      return JSON.parse(m[0]);
    },
  };
}

// Accepts only safe, bounded changes from the model.
export function validateReview(draft, review) {
  const bySku = new Map(draft.map((l) => [l.sku, l]));
  const applied = [];
  const lines = draft.map((l) => ({ ...l, notes: [] }));
  for (const [sku, packs] of Object.entries(review?.adjustments || {})) {
    const line = lines.find((l) => l.sku === sku);
    const orig = bySku.get(sku);
    if (!line || !Number.isInteger(packs) || packs < 0) continue; // unknown SKU or junk: ignore
    const bounded = Math.min(packs, Math.ceil(orig.packs * 1.5)); // at most +50% over the rule
    if (bounded === orig.packs) continue;
    line.packs = bounded;
    line.notes.push(`AI changed ${orig.packs} -> ${bounded} packs`);
    applied.push({ sku, from: orig.packs, to: bounded });
  }
  for (const [sku, note] of Object.entries(review?.notes || {})) {
    const line = lines.find((l) => l.sku === sku);
    if (line && typeof note === 'string') line.notes.push(`AI: ${note.slice(0, 200)}`);
  }
  const keep = lines.filter((l) => l.packs > 0);
  const summary = typeof review?.summary === 'string' ? review.summary.slice(0, 400) : '';
  return { lines: keep, applied, summary };
}

export function reviewerFromEnv(env = process.env, fetchImpl) {
  return env.ANTHROPIC_API_KEY
    ? claudeReviewer({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || undefined, fetchImpl })
    : ruleReviewer;
}

export async function proposePlan({ inventory, policy, ledger, reviewer = ruleReviewer, facility }) {
  const draft = draftReorder(inventory, { coverDays: policy.coverDays });
  const spent = ledger.spentThisMonthCents();
  let review;
  let reviewerName = reviewer.name;
  try {
    review = await reviewer.review(draft, { facility: facility.name, beds: facility.beds, budgetLeft: fmt(policy.monthlyBudgetCents - spent) });
  } catch (err) {
    // The AI is optional. If it fails, fall back to rules and say so.
    review = await ruleReviewer.review(draft);
    reviewerName = `${ruleReviewer.name}; AI unavailable: ${err.message}`;
  }
  const checked = validateReview(draft, review);
  const guarded = applyPolicy(checked.lines, policy, { spentThisMonthCents: spent });
  const plan = {
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    currency: policy.currency,
    reviewer: reviewerName,
    summary: checked.summary,
    aiAdjustments: checked.applied,
    ...guarded,
    status: 'proposed',
  };
  ledger.append('plan_proposed', 'agent', {
    planId: plan.id,
    reviewer: plan.reviewer,
    totalCents: plan.totalCents,
    lines: plan.lines.map(({ sku, packs, status }) => ({ sku, packs, status })),
  });
  return plan;
}
