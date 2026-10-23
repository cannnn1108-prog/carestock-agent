// Rule-based usage forecast and reorder draft. Works with no AI key at all.

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

export function forecastItem(item) {
  const h = item.usage14d || [];
  const last7 = h.slice(-7);
  const prev7 = h.slice(-14, -7);
  const avg7 = mean(last7);
  const avg14 = mean(h);
  // Lean towards the recent week when usage is rising, so we do not run out.
  const daily = Math.max(avg7, avg14);
  const trendPct = prev7.length && mean(prev7) > 0 ? ((avg7 - mean(prev7)) / mean(prev7)) * 100 : 0;
  const safety = Math.ceil(1.65 * stdev(h) * Math.sqrt(item.leadTimeDays)); // ~95% service level
  const daysLeft = daily > 0 ? item.stock / daily : Infinity;
  return {
    daily: Math.round(daily * 10) / 10,
    trendPct: Math.round(trendPct),
    safety,
    daysLeft: Math.round(daysLeft * 10) / 10,
  };
}

// Returns one draft line per item that needs restocking.
export function draftReorder(inventory, { coverDays = 14 } = {}) {
  const lines = [];
  for (const item of inventory) {
    const f = forecastItem(item);
    const reorderPoint = f.daily * item.leadTimeDays + f.safety;
    const available = item.stock + (item.onOrder || 0);
    if (available > reorderPoint + f.daily * 2) continue; // comfortably stocked
    const need = f.daily * (item.leadTimeDays + coverDays) + f.safety - available;
    if (need <= 0) continue;
    const packs = Math.ceil(need / item.packSize);
    const reasons = [`${f.daysLeft} days of stock left`, `uses ~${f.daily} ${item.unit}/day`];
    if (f.trendPct >= 10) reasons.push(`usage up ${f.trendPct}% vs last week`);
    if (f.daysLeft <= item.leadTimeDays) reasons.push(`will run out before a new delivery (${item.leadTimeDays}-day lead time)`);
    lines.push({
      sku: item.sku,
      name: item.name,
      supplier: item.supplier,
      packSize: item.packSize,
      unitPriceCents: item.unitPriceCents,
      packs,
      urgency: f.daysLeft <= item.leadTimeDays ? 'high' : f.daysLeft <= item.leadTimeDays + 3 ? 'medium' : 'low',
      daysLeft: f.daysLeft,
      reasons,
    });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return lines.sort((a, b) => rank[a.urgency] - rank[b.urgency] || a.daysLeft - b.daysLeft);
}
