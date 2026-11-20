# simulate

A Claude Code skill that builds a simulation of your product and uses it to find bugs. Bots play your users against an isolated copy of your app, and an oracle checks the rules you confirm. A finding counts only when it becomes a failing test in your own test suite.

Status: experimental. It is proven on the demo app in this repo, and it was tried privately on one real multi-sided product: on a commit from before two of its fixed bugs, it re-found both, each confirmed by a failing test. Reports from other projects are welcome as issues.

## How it works
1. **Detect.** Claude reads your code and docs: the stack, the start command, the roles, the entities and their states, money fields, and every place that sends SMS, mail, push, payments or webhooks. It lists every feature in `sim/FEATURES.md`: all routes from the framework's own route list, plus scheduled jobs, webhooks, realtime channels, admin screens and locale files.
2. **Ask.** A fixed set of "must never happen" questions (privacy between users, once means once, totals agree, final is final, nothing waits forever), then only the gaps the code could not answer. At most 7 questions before the plan, and up to 8 more with it, each with a suggested answer.
3. **Write rules.** `sim/RULES.md` lists each rule with its source. Rules read from the code are marked `observed` and never fail a run until you confirm them, because the code is what is under test.
4. **Plan.** `sim/PLAN.md` lists the scenarios, checks and isolation, and a coverage table: each feature with its scenarios, and each feature left without one, by name. For a marketplace it also walks a list of 78 cases in 11 areas (dispatch, refunds, scoped admins, privacy, abuse and more). You approve it before any code is written.
5. **Build.** A fixed safety core is copied into `sim/core/` unchanged. Claude generates only the part specific to your project: how to start the copy, the scenarios and the rules.
6. **Run and triage.** The summary's second line says how many features the bots reached and lists the routes they never called. Each violation is sorted into a simulator bug, a product bug proven by a failing test, or a known gap.

A project with no docs ends step 3 with some.

## Modes
| Command | What it does |
|---|---|
| `/simulate plan` | Detect, ask and write the rules and plan. No code. |
| `/simulate every-scenario` | Every scenario once, then triage and report. |
| `/simulate scenario <name>` | One scenario, for one bug or one feature. |
| `/simulate replay <run dir>` | The same seed and scenario as an earlier run. |

After new code, run `/simulate plan` again. It reuses `sim/`: it reads only the files changed since the plan's base commit, compares the route list with `FEATURES.md` to find new and removed routes, keeps every answer you already gave, and plans and builds only the new features. The full `every-scenario` run still checks every older feature, and costs no model tokens.

Not in this version: load, process restarts and other faults, device walks, reviewer rehearsals and nightly runs. Abuse cases are ordinary scenarios.

## Safety
The core refuses to start, with a reason for each refusal, when:
- the database name (a name, a URL or a SQLite file) does not end in `_sim`, or has `prod`, `live` or `test` as a word in it; or a database host (in the URL, a `?host=`, or `DB_HOST`, `DATABASE_HOST`, `PGHOST`, `MYSQL_HOST`) is not local and you did not list it;
- the environment says production (`NODE_ENV`, `APP_ENV`, `RAILS_ENV` and similar);
- any value looks like a live secret (live payment keys, cloud access keys, tokens, private keys) or names a host you forbid;
- the copy holds a `.env` file anywhere outside `node_modules`, `vendor` and `.git*`.

The same checks run on what your start script adds to the environment.

The app runs with an environment built from an allowlist plus fake values, never your shell's environment. The app gets a fresh `HOME` inside the run folder, so tools that look up `HOME` (most SDKs and CLIs) do not find your `~/.aws`, `~/.netrc` and the like. A process can still find the real home through the user database (`os.userInfo()`, Python `pwd`), so the container is the full wall. List `HOME` in the plan's `allow` only when it must have the real one. Senders write to an outbox file. Outbound HTTP goes through a local trap that refuses it and fails the run. An app that ignores proxy settings is not caught by the trap, so for the strongest wall run the whole simulator (runner, copy and database) in one container with `--network none`. Fake users get example.com emails and fictional phone numbers.

## Install
Requirements: Claude Code, and Node 24 or later for the core (the app under test can be in any language, since the bots talk to it over HTTP). The core is tested on Node 25, and `.github/workflows/test.yml` runs Node 24 and 25. The runner sets `NODE_USE_ENV_PROXY` in the app's environment, so a Node app's own `fetch` goes through the egress trap only on a Node that honours that variable.

As a Claude Code plugin, inside a session:

```
/plugin install simulate --marketplace mkhinini-motaz/simulate
```

If your Claude Code rejects `--marketplace`, add the marketplace first: `/plugin marketplace add mkhinini-motaz/simulate`, then `/plugin install simulate@simulate-skill`.

Or copy the skill by hand:

```sh
git clone https://github.com/mkhinini-motaz/simulate
cp -R simulate/skills/simulate ~/.claude/skills/simulate
```

The core is ESM TypeScript run by Node, so `sim/` gets its own `package.json` with `{"type":"module"}` and stays out of your `tsconfig`.

Then run `/simulate plan` in your project (an installed plugin may list the skill as `/simulate:simulate`). The skill follows the [Agent Skills](https://agentskills.io) format (`skills/simulate/SKILL.md`), so other agents that read that format can load it too.

## The demo
`demo/` is a small marketplace API with six planted bugs, listed in `demo/PLANTED.md`, and the simulator the skill would generate for it in `demo/sim/`.

```sh
npm test            # core tests, plus proof that an every-scenario run finds all six bugs and raises no false alarm once they are fixed
npm run demo        # one every-scenario run; see the printed run folder (exits 1: the planted bugs are on)
```

## Ideas borrowed
- Replay from a seed: [TigerBeetle VOPR](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/vopr.md), [FoundationDB simulation testing](https://apple.github.io/foundationdb/testing.html).
- Rules checked after every step: [Hypothesis stateful testing](https://hypothesis.readthedocs.io/en/latest/stateful.html).
- A policy document as the oracle for simulated users: [tau2-bench](https://github.com/sierra-research/tau2-bench).
- A Markdown plan between exploring and running: [Playwright test agents](https://playwright.dev/docs/test-agents).
- Faults and outbound calls trapped at a proxy: [Toxiproxy](https://github.com/Shopify/toxiproxy).
- Related, and a good fit for web walkthroughs: [neonwatty/qa-skills](https://github.com/neonwatty/qa-skills).

## Credits
Built with Claude Code. The lessons in `skills/simulate/references/lessons.md` come from running a simulator of this kind on a real multi-sided product.

## License
MIT. See `LICENSE`.
