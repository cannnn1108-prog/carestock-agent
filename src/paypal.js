// PayPal integration: Orders v2 REST API (create -> buyer approves -> capture).
// With PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET set it talks to the PayPal sandbox.
// Without them it uses an in-process mock with the same shapes, so the whole flow still runs.
import { randomUUID } from 'node:crypto';

const BASES = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};

const money = (cents, currency) => ({ currency_code: currency, value: (cents / 100).toFixed(2) });

// Builds the Orders v2 request body from an approved, policy-checked plan.
export function buildOrderBody(plan, { returnUrl, cancelUrl, brandName }) {
  const currency = plan.currency;
  const lines = plan.lines.filter((l) => l.status === 'ok' && l.packs > 0);
  const itemTotal = lines.reduce((s, l) => s + l.packs * l.unitPriceCents, 0);
  if (itemTotal !== plan.totalCents) throw new Error('plan total does not match its lines');
  return {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: plan.id,
        custom_id: plan.id,
        invoice_id: `CSA-${plan.id}`,
        description: `Consumables restock for ${brandName}`.slice(0, 127),
        amount: { ...money(itemTotal, currency), breakdown: { item_total: money(itemTotal, currency) } },
        items: lines.map((l) => ({
          name: l.name.slice(0, 127),
          sku: l.sku,
          quantity: String(l.packs),
          unit_amount: money(l.unitPriceCents, currency),
          category: 'PHYSICAL_GOODS',
        })),
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: brandName.slice(0, 127),
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    },
  };
}

export class PayPalClient {
  constructor({ clientId, clientSecret, env = 'sandbox', fetchImpl = globalThis.fetch } = {}) {
    if (!BASES[env]) throw new Error(`unknown PAYPAL_ENV: ${env}`);
    this.mode = clientId && clientSecret ? env : 'mock';
    this.base = BASES[env];
    this.fetch = fetchImpl;
    // Kept in a closure-like private field; never logged or returned.
    this.#creds = clientId && clientSecret ? { clientId, clientSecret } : null;
    this.mockOrders = new Map();
  }

  #creds;
  #token = null;
  #tokenExp = 0;

  static fromEnv(env = process.env, fetchImpl) {
    return new PayPalClient({
      clientId: env.PAYPAL_CLIENT_ID,
      clientSecret: env.PAYPAL_CLIENT_SECRET,
      env: env.PAYPAL_ENV || 'sandbox',
      fetchImpl,
    });
  }

  async #accessToken() {
    if (this.#token && Date.now() < this.#tokenExp) return this.#token;
    const basic = Buffer.from(`${this.#creds.clientId}:${this.#creds.clientSecret}`).toString('base64');
    const res = await this.fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`PayPal auth failed (HTTP ${res.status})`);
    const json = await res.json();
    this.#token = json.access_token;
    this.#tokenExp = Date.now() + Math.max(0, (json.expires_in || 0) - 60) * 1000;
    return this.#token;
  }

  async #call(method, path, body, requestId) {
    const token = await this.#accessToken();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (requestId) headers['PayPal-Request-Id'] = requestId; // idempotency: a double tap never pays twice
    const res = await this.fetch(`${this.base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Only non-secret fields from PayPal's error body.
      const detail = json?.details?.[0]?.issue || json?.name || 'error';
      throw new Error(`PayPal ${method} ${path.split('/').slice(0, 4).join('/')} failed (HTTP ${res.status}: ${detail}; debug_id ${json?.debug_id || '-'})`);
    }
    return json;
  }

  // Returns { id, status, approveUrl }.
  async createOrder(plan, opts) {
    const body = buildOrderBody(plan, opts);
    if (this.mode === 'mock') {
      const id = `MOCK-${randomUUID().slice(0, 8).toUpperCase()}`;
      this.mockOrders.set(id, { id, status: 'PAYER_ACTION_REQUIRED', body });
      const approveUrl = `${opts.mockApproveBase}?token=${id}`;
      return { id, status: 'PAYER_ACTION_REQUIRED', approveUrl };
    }
    const json = await this.#call('POST', '/v2/checkout/orders', body, `create-${plan.id}`);
    const link = (json.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
    return { id: json.id, status: json.status, approveUrl: link?.href };
  }

  // Mock only: what the PayPal approval page does when the payer clicks "Pay".
  mockApprove(id) {
    const o = this.mockOrders.get(id);
    if (!o) throw new Error('unknown mock order');
    o.status = 'APPROVED';
  }

  // Returns { id, status, captureId, amountCents }.
  async captureOrder(id) {
    if (this.mode === 'mock') {
      const o = this.mockOrders.get(id);
      if (!o) throw new Error('unknown mock order');
      if (o.status === 'COMPLETED') throw new Error('order already captured');
      if (o.status !== 'APPROVED') throw new Error('order not approved by payer');
      o.status = 'COMPLETED';
      const v = o.body.purchase_units[0].amount.value;
      return { id, status: 'COMPLETED', captureId: `MOCKCAP-${id.slice(5)}`, amountCents: Math.round(Number(v) * 100) };
    }
    const json = await this.#call('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, `capture-${id}`);
    const cap = json.purchase_units?.[0]?.payments?.captures?.[0];
    return { id: json.id, status: json.status, captureId: cap?.id, amountCents: cap ? Math.round(Number(cap.amount.value) * 100) : 0 };
  }
}
