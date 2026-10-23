// End-to-end run in the terminal: propose -> approve -> PayPal order -> capture -> audit trail.
// Uses mock PayPal unless PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are set (then it stops at the approve link).
import { CareStockApp } from '../src/app.js';
import { PayPalClient } from '../src/paypal.js';
import { reviewerFromEnv } from '../src/agent.js';
import { fmt } from '../src/policy.js';

const paypal = PayPalClient.fromEnv();
const app = new CareStockApp({ paypal, reviewer: reviewerFromEnv() });
console.log(`PayPal mode: ${paypal.mode} / reviewer: ${app.reviewer.name}\n`);

const plan = await app.propose();
console.log(`Agent summary: ${plan.summary}`);
for (const l of plan.lines) {
  console.log(`  [${l.status.padEnd(8)}] ${l.name.padEnd(38)} ${String(l.packs).padStart(2)} pack(s) ${l.status === 'ok' ? fmt(l.lineTotalCents).padStart(9) : ''}  ${l.notes.join('; ')}`);
}
console.log(`  total ${fmt(plan.totalCents)} (limit ${fmt(plan.capCents)})\n`);

const r = await app.approve(plan.id, { approver: 'Nurse on duty (demo)' });
console.log(`Approved -> PayPal order ${r.orderId} for ${fmt(r.totalCents)}`);
console.log(`Approve URL: ${r.approveUrl}`);
if (paypal.mode !== 'mock') {
  console.log('\nSandbox mode: open the approve URL with a sandbox buyer, then the server captures on return.');
  process.exit(0);
}
paypal.mockApprove(r.orderId);
const { plan: paid } = await app.capture(r.orderId);
console.log(`Captured: ${paid.captureId} / plan status ${paid.status}\n`);
console.log('Audit trail:');
for (const e of app.ledger.entries) console.log(`  #${e.seq} ${e.type.padEnd(20)} by ${e.actor.padEnd(22)} ${e.hash.slice(0, 12)}`);
console.log(`Chain: ${JSON.stringify(app.ledger.verify())}`);
