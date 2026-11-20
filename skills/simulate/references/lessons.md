# Lessons from a real simulator

These come from running a simulator for a multi-sided product over many runs. Read them before the first triage in a project.

- **List every feature before the first scenario.** Without a list, coverage grew one gap at a time: weeks after the first version, the largest batch of new scenarios arrived, each added only after someone pointed at a feature no bot used. The inventory and the coverage line exist to stop that.
- **The first runs mostly find the simulator wrong.** A bot does something no real user can, or an expectation was transcribed wrongly. Triage every violation before you blame the product, and count simulator bugs openly.
- **Turn each product finding into a failing test first.** It proves the bug without the simulator, and it stays as a regression test after the fix.
- **A loaded machine looks like a slow product.** Replies many times slower than usual came from other builds on the same laptop. Check the machine's load before you read a timing violation.
- **Give the last orders time to settle.** Work created in the final minutes of a run is not stuck yet. Use a settle window.
- **Known gaps are reported, not failed.** When the product knowingly leaves a hole open today, add `, gap` to the rule. The run stays readable, and the gap stays visible.
- **Wipe before you restore.** Restoring a snapshot over an old database kept a stale table, and a later migration then failed.
- **Copy every table that has rows,** not a fixed list. A fixed list missed a table.
- **Look for a phone number by its digits,** not by the stored spelling. A leaked number showed up in a receipt text next to a label, with the digits spaced out; strip spaces, signs and the country code before searching.
- **Match realtime messages by their payload id,** not by the screen being watched. A late update for an earlier order once marked a newer order delivered.
- **Scheduled jobs send too.** A scheduled alert would have texted real phones if the outbox had covered only the request path.
- **The oracle needs its own tests** that run without the product. Its mistakes look exactly like product bugs.
- **When many runs in a row find no product bug,** the oracle is mostly testing the simulator. Add rules or scenarios before adding more runs.
- **Speed up think-time, not the clock.** Dividing the bots' waits keeps the product's own timers honest; fake the product's clock only on purpose.
