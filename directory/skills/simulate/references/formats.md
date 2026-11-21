# File formats

## sim/RULES.md
`RULES.md` is the source of truth: `sim/run.ts` loads it with `parseRules` from `sim/core/rules.ts`. One rule per line, in exactly this shape (other lines are free text):

```markdown
# Rules

- `no-egress` [confirmed] Nothing leaves the machine during a run (source: skill hard rule).
- `one-order-per-cart` [confirmed] A cart checked out twice makes one order (source: developer, 2026-11-20).
- `no-phone-to-courier` [confirmed] A courier's offer carries no customer phone (source: developer, 2026-11-20).
- `totals-agree` [observed] Customer and shop see the same total (source: src/orders/total.ts:42).
- `cancel-is-final` [confirmed, gap] A cancelled order never changes state (source: developer, 2026-11-20, fix planned).
- `job-moves-on` [confirmed] An unanswered job offer moves to the next courier within 90 seconds (source: developer, 2026-11-20, from src/dispatch/settings.ts:12).
```

- `confirmed`: the developer said so. A violation is a failure. When the developer accepted a value the skill read from the code, the source says both: `developer, <date>, from <file:line>`.
- `observed`: read from code or docs and not yet confirmed. A violation is reported as information only.
- `, gap`: the product breaks this rule today, knowingly. A violation is a known gap.
- Ids are short, stable and kebab-case. The runner adds `no-egress` and `scenario-crash` (a scenario that throws) when they are missing.

## sim/FEATURES.md
Every feature by area (`##` headings), with the routes that reach it, written as the bots call them (relative to the app's base URL). `sim/run.ts` loads it with `parseFeatures` from `sim/core/features.ts`, and the runner reports which features the bots reached.

```markdown
# Features

Routes in the framework's list: 42. Routes below: 42.

## cart and checkout
- `checkout` A customer places an order (source: src/routes/orders.ts:12)
  - POST /api/checkout
  - GET /api/orders/:id
- `promo-codes` A customer applies a discount code (source: src/routes/promo.ts:8)
  - POST /api/promo/apply

## notifications
- `order-sms` The customer gets an SMS at each status change (source: src/jobs/notify.ts:20)
  - OUTBOX sms
- `order-socket` The shop hears each new order live (source: src/realtime/shop.ts:14)
  - EVENT shop-heard-order

## roles
- `role-dispatcher` A dispatcher assigns couriers by hand (source: src/auth/roles.ts:30)
  - EVENT signin-dispatcher

## platform
- `push-tokens` skip: needs a real device to register (source: developer, 2026-11-20)
  - POST /api/devices
```

- A feature line is `` - `id` text (source: ...) ``; each route under it is indented, `METHOD /path`.
- Path parameters can be written in the framework's own style: `:id`, `{id}`, `[id]`, `<id>`. `ANY` matches every method.
- A feature with no route (a scheduled job, a socket event, a sender, a role) gets an evidence line instead: `OUTBOX <channel>` is seen when the outbox holds a message on that channel; `EVENT <type>` is seen when a scenario logs `ctx.event({ type: '<type>' })`. A feature with neither is reported as "not measured", and `PLAN.md` names the scenario that covers it.
- `skip:` keeps a feature listed and counted, with its reason, without a scenario.
- `OUTBOX <channel>` matches the outbox line's `channel`, or `kind` or `type` when the product's own outbox uses those keys.

## sim/WORLD.md
```markdown
# World

- Roles: 3 customers, 2 shops, 2 couriers, 1 admin.
- Areas: north, south.
- Catalogue: 4 items per shop, prices from 3.00 to 12.00.
- Identities: names from a fixed list, phones from <fictional range>, emails at example.com.
- Seed: chosen per run and written to metrics.json.
```

## sim/PLAN.md
```markdown
# Plan

Base: 3f2a91c, 2026-11-20.
Update: 2026-11-27: new returns, refund-partial; changed double-checkout.
Core: 0.1.0. Database: shop_sim (env DB_NAME). Ports: 4810 app.
Environment allowlist: DB_NAME, PORT. Fakes: OUTBOX_PATH, MAIL_DRIVER=log, SMS_DRIVER=log.

## Scenarios
### double-checkout
Actors: customer c1, shop s1. Covers: checkout.
1. c1 submits checkout twice within 50 ms. Expect one order (one-order-per-cart).

### reject
1. c1 orders from s1. 2. s1 rejects. Expect: the order is final as rejected everywhere (totals-agree, cancel-is-final).

## Coverage
Routes: 42 in the framework's list (taken with the copy's settings), 42 in FEATURES.md. Features: 14 in 5 areas. Scenarios: 9.
| Feature | Scenarios |
|---|---|
| checkout | double-checkout, happy-path |
| promo-codes | promo-once |
| push-tokens | skip: needs a real device |
Lenses: cart and checkout: all ten apply, except "two at once" for promo-codes (codes are per customer). notifications: happy path, refusals, abuse.
Marketplace cases not applicable: pickup at the counter (no pickup in this product).
Without a scenario: none.

## After-run checks
nothing stuck (settle 3 min), all views agree, legal timelines, no 5xx, outbox only.

## Isolation and start
Copy: git archive of HEAD into /tmp/shop-copy. Processes: app server on 4810, queue worker, scheduler, own cache server on 6390. Health: GET /up (needs the scheduler's heartbeat).
Senders: mail driver log, SMS driver outbox (the product's own OUTBOX_PATH switch), push to outbox.

## Slow jobs
nightly-report: seed one order dated yesterday, run `report:daily` once in the after hook, expect one OUTBOX mail.

## Open questions
1. Production host names for forbiddenHosts? Recommended: the API and web hosts in the deploy config.
2. Is any feature missing from FEATURES.md?
```

## The run folder
`sim/runs/<YYYY-MM-DD-HH-MM-SS>-<mode>-<seed>/` holds `summary.md`, `metrics.json`, `events.jsonl` and `outbox.jsonl`, and the app's fresh `home/` folder.
The first line of `summary.md` after the run is `Untriaged violations: F · known gaps: G · observed-only: O · passes: P`. The second is `Coverage: features exercised E of T · skipped: S · not exercised: N · not measured: M · routes called C of A`, followed by the lists of features not exercised, routes never called, features not measured, and calls to routes missing from `FEATURES.md`. After triage, the skill replaces it with `Product bugs (failing test): N · simulator bugs fixed: M · known gaps: K · observed-only: O`.
