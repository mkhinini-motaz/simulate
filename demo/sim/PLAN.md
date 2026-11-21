# Plan

Base: 0000000 (example; use a real commit hash), 2026-11-20.
Core: 0.1.1. Database: shop_sim (env DB_NAME). Ports: a free port per run.
Environment allowlist: none. Fakes: DB_NAME, DEMO_FIXED, OUTBOX_PATH (set by the runner).

## Scenarios
### happy-path
Actors: customer, shop, courier. Covers: place-order, track-order, shop-accept, offers, deliver, cancel-order, sms-on-accept.
1. The customer places an order. Expect total 22.50 (total-matches-items).
2. The shop accepts. Expect an SMS to the customer (sms-on-accept-and-delivery).
3. The courier lists offers. Expect no customer phone in the offer (no-phone-to-courier).
4. The courier accepts and picks up; the customer then tries to cancel. Expect 409 (no-cancel-after-pickup).
5. The courier delivers. Expect delivered, a legal history, and an SMS (legal-transitions, sms-on-accept-and-delivery).

### double-checkout
Actors: customer. Covers: place-order.
1. The customer submits the same cart twice at once. Expect one order (one-order-per-cart).

### discount-views
Actors: customer, shop. Covers: place-order, shop-view.
1. The customer orders with SAVE10. Expect the customer and shop to show the same total (views-agree, total-matches-items).

### cancel-then-deliver
Actors: customer, shop, courier. Covers: cancel-order, deliver.
1. Order, accept, assign, then the customer cancels.
2. The courier tries to deliver. Expect a refusal; the order stays cancelled (legal-transitions).

### reject-order
Actors: customer, shop. Covers: shop-reject.
1. The shop rejects a new order. Expect the customer to be told (notify-on-reject).

### discount-reuse
Actors: customer. Covers: place-order.
1. The same phone uses SAVE10 twice. Expect a refusal (discount-once-per-customer, a known gap).

## Coverage
Routes: 12 in `server.ts`, 12 in FEATURES.md. Features: 11 in 5 areas. Scenarios: 6.
| Feature | Scenarios |
|---|---|
| place-order | happy-path, double-checkout, discount-views, discount-reuse |
| track-order | happy-path |
| cancel-order | happy-path, cancel-then-deliver |
| shop-view | discount-views |
| shop-accept | happy-path |
| shop-reject | reject-order |
| offers | happy-path |
| deliver | happy-path, cancel-then-deliver |
| dispatch-board | the after-run check |
| sms-on-accept | happy-path (OUTBOX sms) |
| health | skip: used only to wait for the app |
Lenses: ordering, once means once, final is final, privacy, totals, nothing waits forever.
Marketplace cases not applicable: this demo has no pickup, refunds, scoped admins or scheduled jobs.
Without a scenario: none.

## After-run checks
Wait 400 ms, then nothing stuck (no-stuck-dispatch) and the egress trap (no-egress).

## Isolation and start
Copy: the demo folder itself (no `.env` files). Process: `demo/app/server.ts` on 127.0.0.1, started by `sim/start.ts`. Health: GET /health.
Senders: SMS writes to `OUTBOX_PATH`. The app runs with a fresh environment and a fresh HOME inside the run folder, and a proxy refuses all outbound requests.

## Slow jobs
None. The app's delayed reminder fires within the 400 ms wait.

## Open questions
None.
