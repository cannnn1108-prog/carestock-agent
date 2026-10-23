// Append-only audit log. Each entry carries the hash of the previous one,
// so any later edit to the file breaks the chain and verify() reports it.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const GENESIS = '0'.repeat(64);
const hashOf = (e) =>
  createHash('sha256')
    .update(JSON.stringify({ seq: e.seq, ts: e.ts, type: e.type, actor: e.actor, data: e.data, prevHash: e.prevHash }))
    .digest('hex');

export class Ledger {
  constructor(file = null) {
    this.file = file; // null = memory only (tests)
    this.entries = [];
    if (file && existsSync(file)) {
      this.entries = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    }
  }

  append(type, actor, data = {}) {
    const prev = this.entries.at(-1);
    const e = { seq: (prev?.seq ?? 0) + 1, ts: new Date().toISOString(), type, actor, data, prevHash: prev?.hash ?? GENESIS };
    e.hash = hashOf(e);
    this.entries.push(e);
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, JSON.stringify(e) + '\n', 'utf8');
    }
    return e;
  }

  verify() {
    let prevHash = GENESIS;
    for (const e of this.entries) {
      if (e.prevHash !== prevHash || hashOf(e) !== e.hash) return { ok: false, brokenAt: e.seq };
      prevHash = e.hash;
    }
    return { ok: true, count: this.entries.length };
  }

  spentThisMonthCents(now = new Date()) {
    const ym = now.toISOString().slice(0, 7);
    return this.entries
      .filter((e) => e.type === 'payment_captured' && e.ts.startsWith(ym))
      .reduce((s, e) => s + (e.data.amountCents || 0), 0);
  }
}
