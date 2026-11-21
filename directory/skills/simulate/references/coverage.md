# Coverage

A simulator only tests what its scenarios touch. When nobody lists the features first, coverage grows one gap at a time: someone notices a missing feature, a scenario is added, and the next gap waits for the next person to notice it. List every feature before the first scenario, then measure which ones the bots reached.

## 1. Inventory
### What a feature is
One thing a role can do, or the system does on its own, named as a short verb phrase ("cancel an order", "release referral rewards"). In practice:
- one controller or route group per feature; split one that serves two roles, or that holds more than about 8 routes doing different things;
- one feature per scheduled job, queue listener, realtime channel and sender;
- one line per role, under `## roles`, with an `EVENT signin-<role>` evidence line that the bot logs when it signs in, so a role no bot plays shows up in the coverage line.
Expect about one feature for every 3 to 6 routes. Write the mapping as a small script (route pattern to feature id) that fails on any route left unmapped, and keep it next to `FEATURES.md` so the next run can regenerate the list.

### Where features hide
Read all of these, not a sample. Each one found becomes a line in `sim/FEATURES.md` (format in `formats.md`).

- **Routes.** Use the framework's own route list when it has one, and count its lines:
  - `php artisan route:list --json` (Laravel), `bin/rails routes` (Rails), `python manage.py show_urls` (Django with django-extensions);
  - the `app/` or `pages/api/` tree (Next.js); every `router.<method>(` or `app.<method>(` call (Express, Fastify, Koa, Hono);
  - the OpenAPI file, when one exists, as a cross-check.
  Every route goes into `FEATURES.md` under a feature, or under a `skip:` feature with its reason. Tell the developer both numbers: routes in the framework's list, routes in `FEATURES.md`. They must match. Take the list in the environment the copy will run in: debug packages add routes (error pages, API explorers) that exist only in development. Put those framework tool routes under one `skip:` feature.
- **Roles and their apps.** Each role (customer, provider, courier, staff, admin, scoped admin, auditor) and each client (web, mobile, admin panel, partner API). A role with no scenario is a gap.
- **Scheduled jobs** (cron, the framework's scheduler, queue jobs on a timer). They change state with nobody watching, and they send messages.
- **Queue workers and event listeners.** The work that happens after the request returns.
- **Inbound webhooks** (payments, carriers, SMS replies). Routes that no user calls.
- **Realtime channels** (sockets, server-sent events, push): what each role must hear.
- **Senders:** SMS, mail, push, payment calls, outbound webhooks. Each must reach the outbox.
- **Admin and back-office screens:** refunds, manual assignment, moderation, settings, exports, reports.
- **Settings and feature flags** that switch behaviour on or off.
- **Locale files.** Every error or refusal key the API returns needs a translation in the files that translate those keys, wherever they live (the API's own language files, each app's, or both). Expect different key counts per locale; check the keys, not the counts.
- **Console commands** that change data (imports, payouts, clean-ups).

## 2. Lenses: what to try on each feature
Apply these to every feature in `FEATURES.md`. In `PLAN.md`, write one line per area saying which lenses apply, then list per-feature exceptions. Do not write a line per feature per lens.

1. **Happy path** for each role that uses it.
2. **Refusals:** wrong role, another user's record, invalid input, wrong state. Each refusal returns its own error key, not a 500.
3. **Repeat:** double submit, and a retry after the answer was lost (same idempotency key gives the same record).
4. **Undo at each state:** cancel, delete, reverse, where the product allows it, and refused where it does not. Check the state after the undo, not only its answer: the item is back, the money returned, the slot free. Then check the next action sees it: the next order uses the changed item, a hidden item that returns can be ordered again.
5. **Two at once:** two users on one resource (the last item, the same slot, the same offer).
6. **Time:** before and after a window, an expiry, a scheduled release, a job that runs at midnight or at a month's end. Check the state once the deadline passes: released at its time, expired, reopened.
7. **Scope, both ways:** a user of one tenant, area or shop reaching for another's data is refused, and the same user reading their own gets all of it. A role refused an action it lacks (403), and allowed the one it has.
8. **What the other side sees:** each role's view of the same record holds only what that role needs.
9. **Money:** totals agree everywhere, a refund happens once, the books balance after the run.
10. **Abuse:** guessing codes or passwords (locked out after a limit), reusing a one-time code, a user reporting their own content, staff acting for a friend.

## 3. Marketplace cases
For a product with several sides meeting over one order or job. In each area the product has, every case below becomes a scenario or an after-run check, or gets a line in `PLAN.md` saying why it does not apply. Word each one with the product's own nouns. These are cases, not rules: the rule each one checks is confirmed with the developer like any other.

### Ordering
- The ordinary order: placed, accepted, prepared, carried, delivered. Statuses only move forward.
- Pickup at the counter, and eating in, when offered: no dispatch steps.
- A pickup nobody collects: cancelled as not collected, the provider paid what the developer says.
- A group order: items stay attached to each person; one payer.
- A scheduled order: held until its time, released then, not before.
- Slow jobs (hourly, nightly, month-end): seed rows dated in the past, run the job once in the copy, and check its effect and its messages.
- Reorder from a past order: a new order, the old one unchanged.
- A rating after delivery, with reasons or a photo: stored on the order, shown without the customer's identity.
- A risky first order held for review: released, or declined and never released.
- A one-of-a-kind item reserved by two customers at the same moment: one wins, the other is told it was taken.

### Cart and checkout
- Double tap on the order button: one order.
- The answer lost on a slow line, then a retry: the same order comes back.
- A second order while one is still live, when the product forbids it.
- Below the provider's minimum; outside every served area; an item that was hidden while in the cart.
- A discount code: applied once, the same on every surface; a one-use code tried twice.
- A saved second address: edits apply to later orders only.

### Provider operations
- The provider refuses with a reason: the order ends, no money moves.
- The provider never answers: the order is cancelled by the system or the desk, nothing left waiting.
- The provider runs late: what the customer is told, and what they must never be told.
- The provider pauses or closes early with open orders: live orders go on, new ones are refused, the listing returns on reopening.
- Catalogue changes: a new item or rename waits for approval when moderation exists; a price change shows when the developer says.
- Staff added, given a role and removed: each takes effect at once.
- A provider's own discount for a time window: applies inside the window only.
- A provider closes early while a hold or reservation runs: the hold ends on time, the provider is cancelled once, the hours come back.
- An item sold outside the platform (at the counter, by point of sale): hidden at once, back when the sale is undone; an item hidden by hand stays hidden.
- Stock counts and point-of-sale sales, when the product has them: a replayed sale with the same id changes nothing; a voided sale balances.

### Dispatch and couriers
- The first courier declines; the offer expires unanswered; the first two decline: the offer moves on, the order is never lost.
- A dispatcher assigns by hand: honoured, and only to a courier allowed in that area.
- The courier waits at the counter; the bag is short at pickup: recorded, and money matches what was handed over.
- A courier breaks down after pickup: the order changes courier with no illegal transition.
- Nobody at the door; the customer refuses the goods: the order ends returned or discarded, money reverses correctly.
- A courier's phone dies mid-ride: the order is reassigned once overdue.
- No courier online: new orders are held, not lost, and released when one returns; other areas keep flowing.
- A courier holding an order tries to go offline: refused.
- A courier whose papers lapse mid-order: finishes it, gets no new offer.
- Faked GPS (the device's own mock flag) and jumping positions: each flagged for review, naming the courier.
- Every order stays inside its provider's area, and goes by a vehicle or with a helper that fits its size, when the product has such limits.
- An emergency button, when the product has one: reaches the right desk.

### Refunds, cancellations, disputes
- The customer cancels before the provider answers, after acceptance, and too late: allowed, allowed, refused, as the developer says.
- A dispute after delivery, refunded by support: refunded once, books balance.
- A provider disputes a settlement: closes with or without money moving, as decided.
- One customer repeatedly not collecting: flagged after the limit the developer gives.

### Money
- The amount a courier collects and a provider is paid follow the formula the developer gives. Never guess the formula.
- A payout run with a reference: the same reference again changes nothing.
- Cash collected by couriers reconciles with each courier's balance and with the area's total.
- A temporary surcharge for one area and time window applies only there and then.
- Each order's fee equals its area's tariff, and each area's statement adds up its own orders with its own terms.
- Cash collected and paid out, per area, closes at the end of each round.
- A courier working in two areas: cash lands in the order's area.
- Recurring costs post once per period; month-end statements use each area's own terms.

### Accounts, loyalty, referrals
- An outdated app build is told to update; a current one keeps its session.
- A bonus tied to another account's first order is paid only after the hold the developer gives.
- Points spent on rewards stop at the cap; a new account with no order is refused.
- A visitor from an unserved area joins a waitlist; a served area refuses it.
- A link campaign credits new customers who arrive through it, and not existing ones.

### Privacy
- A provider never sees the customer's phone or exact address beyond what the job needs; a courier sees contact details only on their own accepted order; an offer carries none.
- Sign-in with an unknown account, a wrong password and a deleted account all get the same answer.
- Account deletion: a wrong password is refused, the session ends, an account with a live order or open balance cannot be deleted.
- A phone or email change waits for a code sent to the new one; a wrong code is refused.
- A new privacy notice asks every account again; the old version is refused as stale.
- No forbidden word or contact detail appears in the outbox or the server log.

### Admin and scoped admin
- A scoped admin (one area, one shop) reads only their scope and is refused another's; a read-only role writes nothing.
- Support threads are visible only to the team that owns them; the answer reaches the user.
- A closed area lists nothing and takes no order.
- Ordering stopped for one area for a window: refused there only, reopened after.
- Alerts reach the person on duty, and escalate when nobody acknowledges them.
- A new courier applies; an admin reviews the papers; the applicant sees nothing until then.
- A user proposes a correction to stored data (an address, a location); an admin approves or rejects it.

### Notifications and realtime
- Campaigns and banners reach only their audience; users who opted out get none; a weekly cap refusal is an answer, not a failure.
- Each side that watches an order hears every change on the socket, matched by the order's id, not by the screen.
- No message tells a customer something the developer says must never be said (for example "your order is late").

### Abuse
- Sign up, delete, sign up again on the same phone and device: remembered and flagged.
- A new device id for each account (a reset phone): usually not caught. Ask; when it is not defended, it is a `, gap` rule.
- Fresh accounts praising one provider; a referral ring on one device; points bought by a throwaway and handed on.
- Staff ordering from their own shop; an agent refunding or crediting points to a friend; an admin correcting balances again and again, or recording a cash handover that does not match; a dispatcher releasing a friend's held order.
- A customer and a courier failing deliveries together; a customer disputing again and again.
- Guessing join codes, one-time codes and passwords: limited and locked out.
- A taken-over account cashing out its points: stopped.

A flag that only alerts staff is a defence when the developer says it is enough; ask once for the whole abuse area. A case with neither a block nor an accepted flag becomes a `, gap` rule.

### After-run checks (every marketplace run)
Nothing stuck after the settle window; every move legal and only one ending per order; every order inside its area and within its size and value limits; no message containing a word the developer listed; all sides agree on status and total; each side saw only its own data; every offer stayed in its area; the books balance; no server error outside fault windows; every refusal key translated; every scripted expectation held.

Not in this version: process restarts and other faults, load and demand curves, device walks.
