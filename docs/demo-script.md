# Demo video script (target 2:40, hard limit under 3:00)

Recording notes
- Start from a clean log: delete `data/ledger.jsonl`, then `npm start`.
- Record with PayPal **sandbox** keys if available (shows the real PayPal checkout). If not, record in mock mode and say so on screen (scene 5 has both lines).
- Screen 1280x800, browser zoom 110%. Voice-over in English; captions recommended.
- All data on screen is fictional. Do not show any real facility, staff or resident.

| # | Time | Screen | Voice-over |
| --- | --- | --- | --- |
| 1 | 0:00-0:20 | Title card: "CareStock Agent - AI purchasing for care homes, paid with PayPal after a human says yes". Then a photo-free slide: "Briefs, gloves, wipes, food thickener: used every hour, every day." | In a care home, running out of briefs or food thickener is not an inconvenience. It means a resident waits, or a meal cannot be served safely. Yet reordering is still done by a tired nurse at the end of a shift, counting shelves and chasing approval. |
| 2 | 0:20-0:40 | App home. Point at the "Days left" bars; wet wipes in red, briefs and gloves in amber. | CareStock Agent watches how fast each item is used. Here, in a fictional 40-bed home, wet wipes will run out before the next delivery, and gloves and briefs are close behind. |
| 3 | 0:40-1:10 | Click "Ask the agent for a restock plan". Plan appears: summary box, lines with urgency pills and reasons, one line "deferred". | One tap and the agent drafts the order. It forecasts from the last two weeks, adds safety stock for the supplier's lead time, and Claude explains the plan in plain words for care staff. The manager's rules are enforced in code: approved suppliers, a 500-dollar limit per approval, and the monthly budget. Urgent items get the money first. Briefs are deferred, not forgotten. |
| 4 | 1:10-1:30 | Untick one line, total updates. Name field shows "Nurse on duty". Click "Approve & pay with PayPal". | The agent never pays on its own. A nurse can untick anything, puts their name on it, and approves. The server checks the rules again at this moment, so nothing from the browser or the AI can push past the limit. |
| 5 | 1:30-1:55 | PayPal checkout page (sandbox) with itemized order, click Pay. In mock mode: the mock page with the yellow "MOCK MODE" tag. | The approval creates a PayPal order through the Orders v2 API, with every item, quantity and price itemized, and an idempotency key so a double tap never pays twice. (Mock mode line instead: In this recording PayPal runs in mock mode with the same order data; with sandbox keys this is the real PayPal checkout.) |
| 6 | 1:55-2:15 | Back in the app: green "Paid with PayPal and recorded" banner; gloves and wipes show "+ on order". | After PayPal approval the server captures the payment and checks that the captured amount equals what the nurse approved. Stock on order is updated, so tomorrow's plan will not order the same thing twice. |
| 7 | 2:15-2:35 | Scroll to Audit trail: proposed, approved by Nurse on duty, PayPal order created, payment captured. Highlight "hash chain verified". | Every step is written to a hash-chained audit trail: who approved, how much, the PayPal order and capture IDs. If anyone edits a past entry, the chain breaks and the screen says so. That is what a manager or auditor needs. |
| 8 | 2:35-2:50 | Click the propose button again: the deferred briefs now appear within the remaining budget. End card with repo URL. | Ask again and the deferred briefs come back, inside what is left of the budget. Agentic commerce that care staff can trust: the agent does the work, a person says yes, PayPal moves the money. |

The voice-over is about 320 words (not counting the mock-mode alternative line), roughly 2:20 to 2:35 at a calm pace. If a take runs long, cut the last sentence of scene 3 first.
