---
name: simulate
description: Build and run a simulation of your product to test it end to end. Use when you want to find bugs a unit test misses (double submits, privacy leaks between roles, stuck states, money that does not add up) in a web app or API, including multi-sided marketplaces. Bots play your users against an isolated copy of the app, and checks enforce the rules you confirm. Lists every feature first and reports which ones the bots never reached. Modes are plan, every-scenario, scenario <name> and replay <run dir>. Writes a sim/ folder into the project and never touches production. Run it yourself with /simulate [mode] (or /simulate:simulate, if your plugin install lists it that way).
disable-model-invocation: true
---

# Simulate

This skill learns the product from its code and docs, lists every feature it has, asks the developer what must never happen, writes the answers down as rules, then builds a small simulator in `sim/`. Bots play the users over HTTP against a copy of the app that owns its own database. A fixed oracle checks the rules during and after the run. A finding counts as a product bug only once a test in the project's own suite fails without the simulator.

`<skill dir>` below is the folder that holds this file.

## Hard rules
These are refusals, not advice. If one blocks the work, say which rule and why, and stop.

1. **Never production.** `sim/core/` is fixed code, built from `<skill dir>/references/core-spec.md` and proven by every case in `<skill dir>/references/core-cases.md` (see "The core"). Once the cases pass, never edit it for a project, never bypass `assertSafe`, never weaken its checks. Change it only by rebuilding it from the spec. When the guard refuses, report its reasons to the developer and wait.
2. **Nothing leaves the machine.** Every sender (SMS, email, push, payments, webhooks, scheduled jobs that send) writes to `OUTBOX_PATH` instead. The runner traps outbound HTTP through a proxy and fails the run on any attempt. Tell the developer once that running the whole simulator (runner, copy and database) in one container with `--network none` is the stronger wall, because an app that ignores proxy settings is not caught. The bots call the app from the runner, so a container that holds only the copy cannot work.
3. **Fake identities only.** Phone numbers from a fictional range the developer confirms, emails at `example.com`, generated names. Never import real user data, even "just a few rows".
4. **A copy, never the developer's stack.** The copy runs from a clean checkout (a git worktree or `git archive`) with its own database ending in `_sim`, its own ports, queue and logs, and its own cache server (a new key prefix on a shared one is not enough). When the developer's database user cannot create a database, start a private database server on its own port and data folder: it is the stronger wall anyway. Every companion service the copy needs (a realtime relay, a worker, an admin backend) also runs from the copy, with every URL it calls pointed at the copy. Never point the simulator at the developer's dev database or server.
5. **Rules read off the code are `observed`.** The code is what is under test, so a rule copied from it would accept the bug. An `observed` rule is reported but never fails a run until the developer confirms it.
6. **Proof is a failing test in the project's own suite.** A violation is a candidate until that test exists and fails.
7. **No product fixes unless asked.** The failing test is the deliverable. The fix is the developer's call.

**When the skill can build:** the app starts locally from commands `sim/start.ts` can run (one process or several: server, queue worker, scheduler, cache, relay), uses a database the copy can own, and its database name comes from an environment variable the core can check (a name, a URL, or a SQLite file path such as `shop_sim.sqlite`). Bots need HTTP (an API, or a web app with routes). Node 24 or later must be installed for the core. When any of these is missing, run `plan` only and say which one is missing.

## Modes
| Mode | What it does |
|---|---|
| `plan` | Steps 1 to 4: detect, ask, write `RULES.md`, `WORLD.md` and `PLAN.md`. No code. The default when `sim/` does not exist yet. When it exists, plan only what changed (see "Again, after new code"). |
| `every-scenario` | Every scenario once, in a seeded order, then triage and report. The default once `sim/` exists. When the code has moved past the plan's base commit, first compare the route list with `FEATURES.md` and name the new routes. |
| `scenario <name>` | One scenario, for one bug or one new feature. |
| `replay <run dir>` | The same seed, scenario order and per-scenario numbers as an earlier run. Warns (in `summary.md` and on stderr) when the copy's commit differs from the recorded one, and when scenarios were added or removed since. |

Not in this version: load, process restarts and other faults, device walks, reviewer rehearsal, nightly runs. Abuse cases (guessing codes, reusing one-time codes) are ordinary scenarios. Say so if asked, and offer `scenario` for the closest need.

## Again, after new code
`sim/` is the skill's memory. When it exists, reuse it and read only what changed: a full detect and plan of a large product costs many times more model tokens than an update.
1. Read the `Base:` line in `sim/PLAN.md`. `git diff --name-only <base>..HEAD` and `git log --oneline <base>..HEAD` say what changed and why; add `git status --short` for work not yet committed. Read those files and the docs they touch, not the whole repo.
2. Take the framework's route list again and compare it with `FEATURES.md` using `inventoryDiff` from `sim/core/features.ts`. It returns the list's own entries, so the controller of each `added` route is the file to open. Each `added` route becomes a new feature or joins an existing one; each `removed` route leaves `FEATURES.md`, and so do its scenario steps. In the changed files, also look for new jobs, listeners, channels, senders, flags and error keys, which have no route. A feature with no route that the new code calls, and that has no scenario yet, is planned with the new ones.
3. Keep every answer already written. Never ask a `confirmed` rule again, unless the file it cites changed: then show the changed line and ask once. Ask only about the new features, within the caps in "2. Ask".
4. Apply the lenses and the section 3 cases to the new and changed features only, and to a case of another area when the new code calls it (a provider's discount priced by a new checkout). Add their steps to `PLAN.md`, list the new and changed scenarios on its `Update:` line, and build only the new scenarios.
5. When the `CORE_VERSION` in `<skill dir>/references/core-spec.md` is newer than the `Core:` line in `PLAN.md`, rebuild `sim/core/` and `sim/core-test/` as in "The core" (core files only, never the project's scenarios).
6. Run `every-scenario` in full. The run is code, so it costs no model tokens, and it is the regression check for every older feature.
7. Write the new base commit (short hash) and date in `PLAN.md`, and update its counts.

Tell the developer in one line what was reused: `Reused: F features, R rules, S scenarios · new: f features, r rules, s scenarios · questions asked: q`. When the base commit is no longer in the history (a rebase or a squash), or most routes changed, do the full steps instead and say why.

## The core
This version ships no code. The core is written as a spec, and Claude builds it in the project. Do this on the first run in a project, and whenever the `CORE_VERSION` in `<skill dir>/references/core-spec.md` is newer than the `Core:` line in `sim/PLAN.md`:
1. Read `<skill dir>/references/core-spec.md` in full. Write `sim/package.json` as `{"type":"module"}` when it is missing, and build every file the spec lists in `sim/core/`, exactly as specified: every refusal, allowlist, constant, message and file format. Add nothing the spec does not say, and leave nothing out.
2. Read `<skill dir>/references/core-cases.md`. Write every case in it as a `node:test` test in `sim/core-test/`, with the exact title, importing from `../core/`.
3. Run `node --test "sim/core-test/*.test.ts"`. Fix `sim/core/` (never the cases) until every case passes. When a case still fails after three fixes, stop and tell the developer which case fails and why.
4. Refuse to start any simulation, and never run `sim/run.ts`, until every case passes. After that `sim/core/` is fixed: never edit it for a project, never bypass `assertSafe`, never weaken a check. Change it only by rebuilding it from the spec. A project that needs something the core does not do gets it in `sim/start.ts`, `sim/scenarios.ts` or `sim/run.ts`.
5. Write the spec's `CORE_VERSION` on the `Core:` line of `PLAN.md`.

## Steps

### 1. Detect (read only)
Read the README, the agent instructions file (`CLAUDE.md`, `AGENTS.md`) when there is one, the docs index, the notes the code points to, a glossary, and the code. Do not read every note in a large docs folder. Find:
- the stack, the local start commands (server, workers, scheduler, companion services), and the health URL or a route that proves the app is up. Read the health route's code: it may answer only once a worker, the scheduler or a cache is running;
- the database, and the environment variable that names it;
- the surfaces (API, web, realtime) and the user roles, with how each one signs in;
- the entities with states (grep for status enums, state machines, `status` columns) and their allowed transitions;
- money fields and where totals are computed;
- every sender: SMS, mail, push, payment, webhook clients, outbound `fetch` or HTTP clients, and scheduled jobs. Look for an outbox or fake driver the project already has, and for every flag that narrows it (an "SMS only" switch leaves push live);
- the phone, email and address validation rules, so fake identities pass them;
- for each waiting state, what moves it on: a job (with its timer) or a person (then a bot must play that person);
- the project's own test tooling (scenario commands, fixture walkers, an existing simulator): list it as a `skip:` feature and ask whether to reuse it;
- every config key whose default is a local URL (`localhost:3000`, `127.0.0.1:6379`): the developer's own services listen there, so each one is pointed at the copy, or the run talks to the developer's stack;
- the existing test suite and its runner;
- **every feature**, using `<skill dir>/references/coverage.md` section 1: what a feature is, and where features hide (routes from the framework's own route list, roles, scheduled jobs, queue workers, inbound webhooks, realtime channels, admin screens, settings and flags, locale files). The framework's list is the source of routes; read route files only for middleware and comments the list does not show. Map routes to features with a small script that fails on any route left unmapped.

Pick a profile from `<skill dir>/references/profiles.md` and tell the developer which one and why, in one line. Write nothing yet.

### 2. Ask
Use `<skill dir>/references/questions.md`. Ask at most 7 questions before writing the plan, in two rounds of at most 4 (AskUserQuestion), each with a recommended answer drawn from the code:
- first the fixed "must never happen" questions, with the profile's wording;
- then only the gaps the code could not answer: roles that matter, what "stuck" means for each waiting state, a phone range for fake users.

Questions the build needs (production host names, the money formula, start commands) come in step 4, with the plan. Keep the rest for after the first report.

### 3. Write the docs
Write `sim/FEATURES.md`, `sim/RULES.md` and `sim/WORLD.md` in the formats in `<skill dir>/references/formats.md`.
- Every rule is one line: an id, a status (`confirmed` or `observed`, optionally `, gap`), one sentence, and a source: a code `file:line`, a doc path, or `developer, <date>`. The core parses this file, so keep the exact line shape.
- `confirmed` means the developer said so in step 2. Everything else is `observed`.
- `, gap` marks a rule the product knowingly breaks today. It is reported as a known gap, not a failure. An abuse case the product has no defence against yet becomes such a rule once the developer agrees, so the report names it every run instead of leaving it as information.
- `FEATURES.md` lists every feature by area, each with the routes that reach it. Every route in the framework's list appears once; a feature no scenario will cover gets `skip:` and a reason.

If the project had no docs, these files are its first ones. Offer once to link them from the README.

### 4. Plan
Write `sim/PLAN.md`. After its `# Plan` heading come the `Base: <commit>, <date>` line (the commit the inventory was taken at; the next run starts from it), the `Update:` line (absent until the first update) and the `Core:` line (the core's `CORE_VERSION`), as in `formats.md`. Then:
- the scenarios: name, actors, numbered steps, the features it covers, and for each step the expected answer and the state that must hold after it (a refusal leaves nothing changed; a reversal or a deadline leaves the record in its new state), with its rule id;
- the coverage table: for each feature, its scenarios; the lenses in `coverage.md` section 2, one line per area, with per-feature exceptions. With the marketplace profile, also each case in `coverage.md` section 3 for the areas the product has: its scenario, or why it does not apply;
- the after-run checks;
- the isolation: the database name, ports, the environment allowlist and fakes, and how each sender is switched to the outbox;
- how the copy starts (every process and companion service) and how the runner knows it is up;
- slow scheduled jobs: which ones a run reaches, and how (seed rows dated in the past, then run the job once in the copy from a scenario or the `after` hook);
- open questions the build needs, each with a recommended answer.

Use the PLAN.md layout in `formats.md`. Before showing the plan, check it: every feature and every section 3 case points to a numbered step with a rule id, to an after-run check, or to a `skip:` or "does not apply" reason. A name in the coverage table with no step behind it does not count. Each step's "after" state becomes an assertion in that scenario's code, not only text in the plan. A case marked "does not apply" because no route exists is checked against the apps' screens first, and listed in the approval question.

Show the developer the counts before asking for approval: routes in the framework's list and in `FEATURES.md`, features per area, scenarios, and the features or cases left without a scenario, by name. Then ask, in one or two rounds of at most 4: the build's open questions (always the production host names, which go in `forbiddenHosts`; the money formula when there is money; what a message to a user must never say; the constraints every order or job must meet), whether any feature is missing, and approval of the plan. Each answer becomes a `confirmed` rule and an after-run check. `plan` mode ends here, with a short summary.

### 5. Build
1. Build the core as in "The core" above, unless `sim/core/` already exists at the spec's `CORE_VERSION` and its cases passed. Note `CORE_VERSION` on the `Core:` line of `PLAN.md`.
2. Generate the project-specific part, and only that:
   - `sim/start.ts` starts the copy with the environment it is given, waits for health, and returns `{ baseUrl, stop, env }`, where `env` holds only what it created (ports, hosts), never `HOME` (refused) and never a different database name (take it from the env it is given), so `ctx.env` can run commands in the copy;
   - `sim/scenarios.ts` holds one async function per scenario, using `ctx.http`, `ctx.rng`, `ctx.checker` and `ctx.event`. To run a command in the copy (a scheduled job, a queue drain), pass `ctx.env` to `execFileSync` with the copy's folder as `cwd`; never run it with the developer's environment. A scenario that hears a socket message or sees a job's effect logs `ctx.event({ type: '<name>' })`, which `EVENT` lines in `FEATURES.md` count;
   - `sim/package.json` holds `{"type":"module"}`, because the core is ESM `.ts` and a project that says `"type": "commonjs"` cannot load it. Exclude `sim/` from the project's `tsconfig` and linters: the core imports with `.ts` paths;
   - `sim/run.ts` loads `RULES.md` with `parseRules` from `./core/rules.ts` and `FEATURES.md` with `parseFeatures` from `./core/features.ts`, and calls `runSim` from `./core/runner.ts` with the mode from its arguments. Its `envOpts` names the allowlist (`allow`), the fake values (`fakes`, `OUTBOX_PATH` included by the runner), the database variable (`dbVar`), any `forbiddenHosts` (the production host names), and `copyDir`, the clean copy the guard checks for `.env` files (required). The app gets a fresh `HOME` in the run folder; list `HOME` in `allow` only when the app cannot start without the real one (version-manager shims). A database host (URL, `?host=`, `DB_HOST`, `DATABASE_HOST`, `PGHOST`, `MYSQL_HOST`) that is not local goes in `dbHosts` only when it is the copy's own server. Put the project's environment-name variable (`APP_ENV` and the like) in `fakes` with a non-production value: an unset one passes the guard, and some frameworks then default to production. After-run checks (nothing stuck, views agree) go in its `after` hook. The product's own consistency command (a ledger check, for example) may run there as an `observed` check: it is code under test too, so its formula counts as confirmed only when the developer says so.
3. Switch senders through configuration first: a mail driver set to log, a fake SMS driver, a payment test mode, all set through the fakes in the environment. Only when no setting exists, propose the smallest code change that writes to `OUTBOX_PATH`, active only when the database name ends in `_sim`, and show the diff before applying it.
4. Add `sim/runs/` to `.gitignore`. Add a package script or make target only if the project already uses them.

### 6. Run
Run `node sim/run.ts every-scenario` (or the mode asked). Read the run folder's `summary.md`. Its second line is the coverage: features exercised, skipped, not exercised, not measured, and routes called. A feature in "not exercised" means a scenario planned for it never reached its routes; a route in "called but missing from FEATURES.md" means the inventory missed it. Fix both before triage.

### 7. Triage every failure
Read `<skill dir>/references/lessons.md` before the first triage in a project.
- **Simulator bug:** the bot did something no real user can do, the expectation was wrong, or a timing failure came from a loaded machine (check the load before judging timing). Fix the simulator and run again. Count it.
- **Product bug candidate:** first grep the project's own tests and docs for an assertion of the opposite. If one exists, the rule is in question, not the product: ask the developer. Otherwise write the smallest test in the project's own suite that reproduces it without the simulator. Run it against a database of its own on the copy's database server: set the host, port and database name explicitly, because a project's test config may hard-code its own. If it fails, it is a product bug. If you cannot make it fail, say so: it stays a candidate.
- **Known gap:** the developer says the product breaks this rule on purpose today. Add `, gap` to that rule in `RULES.md`.

### 8. Report
Replace the first line of the run's `summary.md` with:
`Product bugs (failing test): N · simulator bugs fixed: M · known gaps: K · observed-only: O`
Keep the coverage line under it. Then reply to the developer with both lines, each product bug (rule id, one sentence, the test path), the `observed` rules worth confirming, each feature still without a scenario, and the questions held back in step 2. Add any new rule learned to `RULES.md` as `observed`, or as `confirmed` once the developer says so.
