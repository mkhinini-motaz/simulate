# Questions

Ask at most 7 before writing the plan, in rounds of at most 4, then one or two rounds of at most 4 with the plan (below). Give each question a recommended answer taken from the code, worded so that "yes" accepts it. Restate each answer in one line before writing it into `RULES.md`.

## The fixed "must never happen" questions
Ask these every time, reworded for the project's own nouns. Each answer of yes becomes a `confirmed` rule. Skip a question only when the project plainly has no such thing (no money, no second user), and say that you skipped it.

1. **Privacy between users.** "Must a <role> never see another <role>'s <phone, address, email, payment details>, in any screen, API answer, notification or realtime message?"
2. **Once means once.** "Must a <checkout, payment, booking, signup> submitted twice in a row create only one <order, charge, booking>?"
3. **Totals agree.** "Must the total of a <order, invoice> be the same everywhere it appears: the <customer>'s view, the <provider>'s view, the receipt and the payout?"
4. **Final is final.** "Once a <thing> is <delivered, cancelled, refunded>, must it never change state again?"
5. **Nothing waits forever.** "What is the longest a <thing> may stay in each waiting state before it counts as stuck?" For each state, first find what moves it on. A job: suggest its timer from the code. A person (a dispatcher, a support desk): say so, and plan a bot that plays that person, or the state will always look stuck. With no clue in the code, the default is 10 minutes on the copy's clock.

Do not ask whether test runs may contact real people or services. They may not: that is a hard rule.

## Gap questions
Ask only what the code could not answer.
- Which roles matter for this run, and roughly how many of each (a first run needs only a few).
- A phone number range for fake users. Read the product's phone validation first. Offer a range the developer's country reserves for fiction when it passes that validation; when none passes, offer a range that does and say plainly that the outbox and the egress trap are then the only wall between the run and real phones.
- The sign-in path for each role when there are several, or none is obvious.
- Any rule the developer knows the product breaks today (it gets `, gap`).

## With the plan (step 4)
- The production host names (API, web, relay, storage), for `forbiddenHosts`. Always ask: they usually live only in `.env` values the skill must not read.
- The money formula, when there is money: what a courier collects and a provider is paid, each fee and its tariff per area. Never guess it.
- What a message to a user must never say (for example "your order is late", another user's name or number). The answer is a word list the after-run check scans the outbox and the server log for.
- What every order or job must satisfy, whoever handles it: its area, its size against the vehicle or the helper, its value, opening hours. Each answer is one after-run check over every order.
- The start commands and companion services, when the README and scripts disagree or say nothing.
- Whether any feature is missing from `FEATURES.md`, and approval of the plan.

## After the first report
- Each `observed` rule that the run exercised: confirm, drop, or mark as a gap.
- Rules the developer wants that no scenario covers yet.
- Whether a failing test should be added to CI.
