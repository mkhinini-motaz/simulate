# Profiles

A profile seeds the questions, the starter rules and the scenario list. It decides nothing. Every starter rule begins as `observed` and becomes `confirmed` only when the developer says so. Tell the developer which profile you picked and why, in one line, and switch when they disagree.

## generic
Any API or web app with users and state.

Detect: at least one entity with a status or lifecycle, and at least one signed-in role.

Starter rules:
- users see only their own private data;
- a repeated submit creates one record;
- terminal states are final;
- nothing stays in a waiting state past its limit;
- no server error (5xx) during a run;
- nothing is sent outside the machine (`no-egress`, always confirmed).

Apply the lenses in `coverage.md` section 2 to every feature. Starter scenarios: the happy path for each role; an invalid input refused with the right error; a double submit; an action by the wrong role refused; a cancel at each state where cancel is allowed.

## marketplace
A product with several sides that meet over one order or job: for example a customer, a provider (a shop, a host, a driver), a courier or helper, and an admin.

Detect: three or more roles with separate sign-in or route prefixes; an order or job entity with a state machine; an offer or assignment to a third party; payout, commission or fee fields.

Starter rules:
- **privacy between sides:** a provider or courier sees only the customer data the job needs, and an offer carries no contact details before it is accepted;
- **all sides agree:** customer, provider, courier and admin views show the same status and the same total for the same order;
- **once means once:** one checkout makes one order, and one acceptance makes one assignment;
- **final is final:** delivered, cancelled and refunded orders never move again;
- **nothing stuck:** every order reaches a terminal state, or is inside its state's time limit at the end of the run (with a settle window for the last orders);
- **legal timeline:** each order's states follow the allowed transitions;
- **scope:** an offer goes only to couriers or providers in the order's area, and a scoped admin sees only their scope;
- **money adds up:** the amount a courier collects or a provider is paid equals the formula the developer gives. Never guess the formula: ask it, or leave the rule out;
- **realtime:** when the product has live updates, each side hears each change of its orders.

Starter scenarios: the happy path; the provider rejects; the customer cancels before pickup; the courier declines and the order is offered again; a double checkout; a discount code; two customers ordering from one provider at once; a provider that goes offline with open orders.

Full case list: `coverage.md` section 3. Every case in an area the product has becomes a scenario or a check, or `PLAN.md` says why it does not apply.

Starter world: a handful of each role, one or two areas, a small catalogue, fake identities.

Keep the profile generic. Never carry over names, prices, fees, areas or rules from any other project.
