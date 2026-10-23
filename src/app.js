// Core workflow, independent of HTTP: propose -> human approves -> PayPal order -> capture -> record.
import { FACILITY, demoInventory, demoPolicy } from './demo-data.js';
import { proposePlan, ruleReviewer } from './agent.js';
import { applyPolicy } from './policy.js';
import { Ledger } from './ledger.js';

export class CareStockApp {
  constructor({ paypal, reviewer = ruleReviewer, ledger = new Ledger(), baseUrl = 'http://localhost:3000', inventory = demoInventory(), policy = demoPolicy() }) {
    this.paypal = paypal;
    this.reviewer = reviewer;
    this.ledger = ledger;
    this.baseUrl = baseUrl;
    this.inventory = inventory;
    this.policy = policy;
    this.facility = FACILITY;
    this.plans = new Map();
    this.orders = new Map(); // PayPal order id -> plan id
  }

  status() {
    return {
      facility: this.facility,
      paypalMode: this.paypal.mode,
      reviewer: this.reviewer.name,
      policy: this.policy,
      spentThisMonthCents: this.ledger.spentThisMonthCents(),
      inventory: this.inventory.map(({ usage14d, ...rest }) => ({ ...rest, usage7d: usage14d.slice(-7) })),
      ledger: this.ledger.verify(),
    };
  }

  async propose() {
    const plan = await proposePlan({ inventory: this.inventory, policy: this.policy, ledger: this.ledger, reviewer: this.reviewer, facility: this.facility });
    this.plans.set(plan.id, plan);
    return plan;
  }

  // The approver may untick lines but cannot change quantities or prices from the browser.
  async approve(planId, { approver, skus } = {}) {
    const plan = this.plans.get(planId);
    if (!plan) throw httpError(404, 'plan not found');
    if (plan.status !== 'proposed') throw httpError(409, `plan is already ${plan.status}`);
    const who = String(approver || '').trim().slice(0, 60);
    if (!who) throw httpError(400, 'approver name is required');

    const chosen = plan.lines.filter((l) => l.status === 'ok' && (!skus || skus.includes(l.sku)));
    if (chosen.length === 0) throw httpError(400, 'nothing selected to buy');
    // Re-check the spending rules at the moment of approval (budget may have moved).
    const recheck = applyPolicy(chosen.map(({ status, lineTotalCents, ...l }) => l), this.policy, { spentThisMonthCents: this.ledger.spentThisMonthCents() });
    const approved = { ...plan, lines: recheck.lines, totalCents: recheck.totalCents };
    if (approved.totalCents <= 0) throw httpError(409, 'over budget: nothing can be bought right now');

    this.ledger.append('plan_approved', who, { planId, totalCents: approved.totalCents, skus: approved.lines.filter((l) => l.status === 'ok').map((l) => l.sku) });

    const order = await this.paypal.createOrder(approved, {
      brandName: this.facility.name,
      returnUrl: `${this.baseUrl}/paypal/return`,
      cancelUrl: `${this.baseUrl}/paypal/cancel`,
      mockApproveBase: `${this.baseUrl}/paypal/mock-approve`,
    });
    plan.status = 'awaiting_payment';
    plan.approvedBy = who;
    plan.approved = approved;
    plan.orderId = order.id;
    this.orders.set(order.id, planId);
    this.ledger.append('paypal_order_created', 'system', { planId, orderId: order.id, mode: this.paypal.mode, totalCents: approved.totalCents });
    return { planId, orderId: order.id, approveUrl: order.approveUrl, totalCents: approved.totalCents };
  }

  async capture(orderId) {
    const planId = this.orders.get(orderId);
    const plan = planId && this.plans.get(planId);
    if (!plan) throw httpError(404, 'unknown order');
    if (plan.status === 'paid') return { plan, already: true };
    const cap = await this.paypal.captureOrder(orderId);
    if (cap.status !== 'COMPLETED') throw httpError(502, `capture status ${cap.status}`);
    if (cap.amountCents !== plan.approved.totalCents) {
      this.ledger.append('payment_mismatch', 'system', { planId, orderId, expected: plan.approved.totalCents, got: cap.amountCents });
      throw httpError(502, 'captured amount does not match the approved amount');
    }
    plan.status = 'paid';
    plan.captureId = cap.captureId;
    for (const l of plan.approved.lines.filter((x) => x.status === 'ok')) {
      const item = this.inventory.find((i) => i.sku === l.sku);
      if (item) item.onOrder += l.packs * l.packSize;
    }
    this.ledger.append('payment_captured', 'system', { planId, orderId, captureId: cap.captureId, amountCents: cap.amountCents });
    return { plan, already: false };
  }

  cancel(orderId) {
    const planId = this.orders.get(orderId);
    const plan = planId && this.plans.get(planId);
    if (!plan || plan.status !== 'awaiting_payment') return null;
    plan.status = 'cancelled';
    this.ledger.append('payment_cancelled', 'payer', { planId, orderId });
    return plan;
  }
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
