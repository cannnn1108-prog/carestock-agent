// Guardrails. Applied after the AI and again at approval time on the server.
// Nothing the model or the browser sends can get past these checks.

export const fmt = (cents) => `$${(cents / 100).toFixed(2)}`;

export function applyPolicy(lines, policy, { spentThisMonthCents = 0 } = {}) {
  const out = [];
  const remainingBudget = Math.max(0, policy.monthlyBudgetCents - spentThisMonthCents);
  const cap = Math.min(policy.maxOrderCents, remainingBudget);
  let total = 0;

  for (const raw of lines) {
    const line = { ...raw, notes: [...(raw.notes || [])] };
    if (!policy.allowedSuppliers.includes(line.supplier)) {
      out.push({ ...line, status: 'blocked', notes: [...line.notes, 'supplier is not on the approved list'] });
      continue;
    }
    if (!Number.isInteger(line.packs) || line.packs <= 0) {
      out.push({ ...line, packs: 0, status: 'blocked', notes: [...line.notes, 'invalid quantity'] });
      continue;
    }
    if (line.packs > policy.maxPacksPerLine) {
      line.notes.push(`capped at ${policy.maxPacksPerLine} packs per line`);
      line.packs = policy.maxPacksPerLine;
    }
    // Lines arrive sorted by urgency, so urgent items get the budget first.
    let packs = line.packs;
    while (packs > 0 && total + packs * line.unitPriceCents > cap) packs--;
    if (packs === 0) {
      out.push({ ...line, packs: 0, status: 'deferred', notes: [...line.notes, `deferred: would exceed the ${fmt(cap)} limit`] });
      continue;
    }
    if (packs < line.packs) line.notes.push(`reduced from ${line.packs} to ${packs} packs to stay within ${fmt(cap)}`);
    line.packs = packs;
    line.lineTotalCents = packs * line.unitPriceCents;
    total += line.lineTotalCents;
    out.push({ ...line, status: 'ok' });
  }
  return { lines: out, totalCents: total, capCents: cap, remainingBudgetCents: remainingBudget };
}
