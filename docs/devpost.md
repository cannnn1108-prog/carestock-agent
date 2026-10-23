# Devpost submission draft

Project name: CareStock Agent

Tagline (short): An AI purchasing agent for care homes that drafts the reorder, waits for one tap from a nurse, then pays with PayPal and keeps a tamper-evident record.

Suggested categories: Best Use of Agentic Commerce, Most Impactful

Built with: node.js, paypal-orders-v2, paypal-rest-api, claude, javascript, html, css

Links (fill in before submitting)
- Repository: (public GitHub URL, after approval)
- Demo video: (YouTube or Vimeo URL, under 3 minutes)

---

## Inspiration

Our founder has worked in care and welfare settings for more than 17 years. In residential care homes, consumables like adult briefs, gloves, wipes and food thickener are used every hour of every day. When they run out, residents wait, or a meal cannot be served safely to someone with swallowing difficulties.

Reordering is still mostly manual: a nurse counts shelves after a long shift, guesses quantities, and chases a manager for payment. The result is emergency orders at retail prices, double orders, and no clear record of who approved what. At the same time, nobody in this field would accept an AI that spends money on its own. We wanted an agent that does the tedious work and still leaves the decision with a person.

## What it does

- Forecasts each item's usage from the last 14 days, leaning on the recent week when usage rises, and adds safety stock for supplier lead time.
- Drafts a restock in whole packs, sorted by urgency, with a reason for each line ("will run out before a new delivery").
- Claude reviews the draft and explains it in two plain sentences for care staff. It can nudge quantities but cannot add items, change prices or suppliers, or exceed +50% of the rule.
- Enforces the manager's rules in code: approved suppliers, max packs per line, a per-approval limit and a monthly budget. Urgent items are funded first; the rest is deferred and comes back in the next plan.
- A nurse unticks anything they disagree with, enters their name, and taps "Approve & pay with PayPal".
- The server creates an itemized PayPal order, the payer approves on PayPal, and the server captures and verifies that the captured amount equals the approved amount.
- Every step goes into a hash-chained audit trail: proposed, approved by whom, PayPal order ID, capture ID, cancellations.

## How we built it

- Node.js with no runtime dependencies: a small HTTP server and a single-page staff UI.
- PayPal REST APIs: OAuth2 client credentials (`/v1/oauth2/token`), Orders v2 create (`/v2/checkout/orders`) with item breakdown, `invoice_id`, `custom_id` and `payment_source.paypal.experience_context` (return/cancel URLs, PAY_NOW, NO_SHIPPING), the `payer-action` link for approval, and capture (`/v2/checkout/orders/{id}/capture`). `PayPal-Request-Id` makes create and capture idempotent.
- Claude (Anthropic Messages API) as the reviewer, with strict validation of its JSON output. Without a key, a deterministic reviewer keeps the whole flow working.
- A mock PayPal mode with the same order bodies, so the full flow runs and is tested offline.
- 16 automated tests, including a full HTTP flow from proposal to recorded payment, a cancelled payment, a "greedy AI" that tries to overspend, and a tampered audit log.

## Challenges we ran into

- Keeping the agent useful without letting it spend freely. We settled on three layers: rules draft, AI reviews within bounds, guardrails decide, and the guardrails run again at the moment of approval.
- Budget allocation when the limit is reached: we fund urgent items first and defer the rest visibly instead of silently dropping them.
- Making payments explainable: matching the captured amount to the approved amount and chaining the log so edits are detectable.

## Accomplishments that we're proud of

- A complete loop from usage data to a captured PayPal payment, with a human approval that takes one tap.
- The AI cannot push an order past the limit, even when it tries (we test this).
- An audit trail a care home manager could show to an auditor.

## What we learned

- In care settings, trust comes from limits and records, not from smarter models alone.
- PayPal's Orders v2 item breakdown and idempotency keys fit agentic purchasing well: every agent-created payment is itemized and safe to retry.

## What's next for CareStock Agent

- Delivery confirmation and supplier invoice matching.
- Reusing a manager-approved payment method within the same limits.
- Multi-site homes with a shared budget and per-site approvers.
- A pilot with real care homes, using their own consumable lists.

---

Note: all data in the project and video is fictional ("Maple Grove Care Home (fictional)"). No real facility, resident, staff or customer data is used.
