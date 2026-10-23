// Fictional demo data only. No real facility, resident or customer data.
// "Maple Grove Care Home" is an invented 40-bed residential care home.

export const FACILITY = {
  name: 'Maple Grove Care Home (fictional)',
  beds: 40,
  currency: 'USD',
};

// Deterministic pseudo-random so tests and the demo video always show the same numbers.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function history(seed, base, spread, trendPerDay = 0) {
  const rnd = seeded(seed);
  const out = [];
  for (let d = 0; d < 14; d++) {
    const v = base + trendPerDay * d + (rnd() - 0.5) * 2 * spread;
    out.push(Math.max(0, Math.round(v)));
  }
  return out; // oldest -> newest, units used per day
}

// unitPriceCents is the price of one pack. packSize is units per pack.
export function demoInventory() {
  return [
    { sku: 'BRF-L', name: 'Adult briefs, size L', unit: 'brief', packSize: 80, unitPriceCents: 3899, supplier: 'CareSupply Co. (demo)', leadTimeDays: 3, stock: 260, onOrder: 0, usage14d: history(1, 46, 6, 0.6) },
    { sku: 'PAD-M', name: 'Incontinence pads, medium', unit: 'pad', packSize: 120, unitPriceCents: 2799, supplier: 'CareSupply Co. (demo)', leadTimeDays: 3, stock: 900, onOrder: 0, usage14d: history(2, 58, 8) },
    { sku: 'GLV-M', name: 'Nitrile gloves, M (box of 100)', unit: 'glove', packSize: 1000, unitPriceCents: 6450, supplier: 'MedBasics Ltd. (demo)', leadTimeDays: 2, stock: 1400, onOrder: 0, usage14d: history(3, 320, 40, 4) },
    { sku: 'SAN-500', name: 'Hand sanitizer 500 ml', unit: 'bottle', packSize: 12, unitPriceCents: 4200, supplier: 'MedBasics Ltd. (demo)', leadTimeDays: 2, stock: 30, onOrder: 0, usage14d: history(4, 2, 1) },
    { sku: 'WIP-80', name: 'Wet wipes, 80 sheets', unit: 'pack', packSize: 24, unitPriceCents: 3120, supplier: 'CareSupply Co. (demo)', leadTimeDays: 3, stock: 22, onOrder: 0, usage14d: history(5, 7, 2, 0.2) },
    { sku: 'THK-1K', name: 'Food thickener 1 kg (dysphagia care)', unit: 'kg', packSize: 6, unitPriceCents: 8900, supplier: 'NutriCare Inc. (demo)', leadTimeDays: 5, stock: 9, onOrder: 0, usage14d: history(6, 1, 0.4) },
    { sku: 'ORL-SP', name: 'Oral care sponges', unit: 'sponge', packSize: 250, unitPriceCents: 1890, supplier: 'NutriCare Inc. (demo)', leadTimeDays: 5, stock: 610, onOrder: 0, usage14d: history(7, 24, 4) },
    { sku: 'BED-PR', name: 'Disposable bed protectors', unit: 'sheet', packSize: 100, unitPriceCents: 4750, supplier: 'CareSupply Co. (demo)', leadTimeDays: 3, stock: 75, onOrder: 0, usage14d: history(8, 14, 3, 0.3) },
  ];
}

// Spending rules the care home manager set in advance. The agent can never exceed them.
export function demoPolicy() {
  return {
    currency: 'USD',
    maxOrderCents: 50000,        // one approval can pay at most $500.00
    monthlyBudgetCents: 120000,  // consumables budget for the month: $1,200.00
    maxPacksPerLine: 10,
    allowedSuppliers: ['CareSupply Co. (demo)', 'MedBasics Ltd. (demo)', 'NutriCare Inc. (demo)'],
    coverDays: 14,               // order enough to last this many days after delivery
  };
}
