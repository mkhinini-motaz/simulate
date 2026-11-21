# Core cases

Every test the core must pass, from `references/core-spec.md`. A rebuilt core is accepted only when all of them pass. Write each case as a `node:test` test in `sim/core-test/`, with the exact title below (`import { test } from 'node:test'`, `import assert from 'node:assert/strict'`). One file per core file: `egress.test.ts`, `features.test.ts`, `guard.test.ts`, `oracle.test.ts` (also holds the rules and outbox cases), `run.test.ts` (also holds the rng, outbox, rules and runner cases). Tests import from `../core/<file>.ts`. A title that contains `${...}` is one test registered in a loop: write the loop and fill the title from the table.

Conventions used below:
- `rules1` is `[{ id: 'r1', text: 'Rule one', status: 'confirmed' }]`.
- `rules3` is `[{ id: 'a', text: 'confirmed rule', status: 'confirmed' }, { id: 'b', text: 'observed rule', status: 'observed' }, { id: 'g', text: 'gap rule', status: 'confirmed', gap: true }]`.
- `tmp()` makes a new temporary folder (`mkdtempSync` in the system temp folder) and removes it after the file's tests (the `after` hook of `node:test`).
- `fakeApp()` starts an HTTP server on `127.0.0.1`, port 0, that answers every request with the body `{"ok":true}`, and returns `{ baseUrl, stop }` where `stop` closes the server.
- `one(over, scenarios)` builds run options: root `tmp()`, mode `every-scenario`, seed 3, `rules1`, scenarios (default one scenario `a` that does nothing), `start` = `fakeApp`, `envOpts` = `{ allow: [], fakes: { DB_NAME: 'x_sim' }, dbVar: 'DB_NAME', copyDir: tmp() }`; keys in `over` replace these.
- In guard cases, `check(env, forbiddenHosts?)` is `checkEnv(env, { dbVar: 'DB_NAME', forbiddenHosts })`; "refused with W" means `ok` is false and the reasons joined with newlines match the pattern W; `good` is `{ DB_NAME: 'shop_sim' }`.

## egress.test.ts

### records a plain proxied request and a CONNECT, both answered 502
Start the trap, take the port from its `url`.

| Step | Input | Expected |
|---|---|---|
| 1 | HTTP request to `127.0.0.1:port`, path `http://sms.example.invalid/send`, header `host: sms.example.invalid` | status 502 |
| 2 | raw TCP to the port, send `CONNECT pay.example.invalid:443 HTTP/1.1` with header `host: pay.example.invalid:443` and a blank line | the reply, read until the socket closes, starts with `HTTP/1.1 502` |
| 3 | `attempts()` | hosts, in order: `sms.example.invalid`, `pay.example.invalid` |
| 4 | first attempt's `at` | matches `^\d{4}-\d\d-\d\dT` |

Then `close()` resolves.

## features.test.ts

Shared input `md` (the backticks are real):

```
# Features
## orders
- `place` Place an order (source: a.ts:1)
  - POST /orders
- `track` Read an order (source: a.ts:2)
  - GET /orders/:id
  - GET /orders/{id}/items
- `refund` Refund (source: a.ts:3)
  - post /orders/[id]/refund
## other
- `nightly` A scheduled job (source: jobs.ts:1)
- `digest` A mailed digest (source: jobs.ts:2)
  - OUTBOX mail
- `socket` A live update (source: ws.ts:1)
  - EVENT order-heard
- `push` skip: needs a real device (source: developer, 2026-11-20)
  - POST /devices
```

### parseFeatures reads areas, routes, skips and job lines
Mapping each feature to `[id, area, number of routes, skip or null]` gives:

```json
[["place","orders",1,null],["track","orders",2,null],["refund","orders",1,null],["nightly","other",0,null],["digest","other",0,null],["socket","other",0,null],["push","other",1,"needs a real device (source: developer, 2026-11-20)"]]
```

Also: the method of the first route of `refund` is `POST`; the evidence of `digest` is `[{ "kind": "OUTBOX", "name": "mail" }]`.

### coverage matches path parameters in each style and ignores query strings
`coverage(parseFeatures(md), calls, { outbox: ['mail'], events: ['something-else'] })` with calls:

| method | path |
|---|---|
| POST | `/orders` |
| get | `/orders/42/items?page=2` |
| GET | `/admin/secret` |

Expected:
- `features`: `{ "total": 7, "exercised": 3, "skipped": 1, "notExercised": ["refund","socket"], "notMeasured": ["nightly"] }`
- `routes`: `{ "total": 5, "called": 2, "skipped": 1, "neverCalled": ["GET /orders/:id (track)", "POST /orders/[id]/refund (refund)"] }`
- `unlisted`: `["GET /admin/secret"]`
- `coverageLine(result)` equals `Coverage: features exercised 3 of 7 · skipped: 1 · not exercised: 2 · not measured: 1 · routes called 2 of 5`

### a method mismatch is not a hit, ANY matches every method
Features from the text `- \`a\` x`, `  - GET /a`, `- \`b\` y`, `  - ANY /b` (joined with newlines). Calls: POST `/a`, DELETE `/b`. Expected: `features.notExercised` is `["a"]`; `unlisted` is `["POST /a"]`.

### inventoryDiff names new and removed routes after new code
Features from these lines joined with newlines: `## orders`, `- \`order\` Order (source: x)`, `  - GET /orders/:id`, `  - POST /orders`, `  - DELETE /orders/:id`, `- \`hook\` Webhook (source: y)`, `  - ANY /webhook`.

Route list:

```json
[
  { "method": "GET|HEAD", "path": "orders/{order}" },
  { "method": "POST", "path": "orders" },
  { "method": "GET|HEAD", "path": "orders/export", "action": "ExportController" },
  { "method": "POST", "path": "webhook" }
]
```

Expected `inventoryDiff`: `{ "added": [{ "method": "GET|HEAD", "path": "orders/export", "action": "ExportController" }], "removed": ["DELETE /orders/:id (order)"] }`. Also `coverage(features, [{ method: 'GET|HEAD', path: '/orders/7' }]).features.exercised` is 1.

### parseFeatures reads Laravel and Rails route lists and fails on a line it cannot read
Input A: `- \`a\` x`, `  - GET|HEAD api/items`, `  - GET /orders/:id(.:format)` (each line followed by a newline). Expected routes of the feature:

```json
[{ "method": "GET", "path": "/api/items" }, { "method": "HEAD", "path": "/api/items" }, { "method": "GET", "path": "/orders/:id" }]
```

`coverage` of it with calls GET `/orders/7.json` and GET `/api/items`: `routes.neverCalled` is `["HEAD /api/items (a)"]`. Input B: `- \`a\` x` newline `  - OUTBOX` newline: `parseFeatures` throws an error matching `line 2`.

### inventoryDiff agrees with parseFeatures on Rails (.:format) paths
Features from `## o`, `- \`orders\` O`, `  - GET /orders/:id(.:format)`. `inventoryDiff(features, [{ method: 'GET', path: '/orders/:id(.:format)' }])` is `{ "added": [], "removed": [] }`.

### a bullet that is not an HTTP method is not a route
`parseFeatures` of `## o`, `- \`a\` A`, `  - see notes` (joined with newlines) throws an error matching `cannot read`.

## guard.test.ts

### a clean sim env passes
`check({ DB_NAME: 'shop_sim' })` equals `{ ok: true, reasons: [] }`.

### missing db name is refused
`check({})` is refused with `missing`.

### db name without _sim is refused
`check({ DB_NAME: 'shop' })` is refused with `_sim`.

### db name containing ${word} is refused
One test per word, with the title filled in: `db name containing prod is refused`, `db name containing live is refused`, `db name containing test is refused`. Input `{ DB_NAME: 'my_' + WORD_UPPERCASE + '_sim' }` (for example `my_PROD_sim`); refused with the lowercase word.

### whole words only: delivery_sim and products_sim pass, a_live_sim does not
Each of `delivery_sim`, `products_sim`, `latest_sim` passes. `a-live-b_sim` is refused with `live`.

### SQLite files and URLs are read by their file name
These pass: `database/shop_sim.sqlite`, `shop_sim.db`, `sqlite:///var/db/shop_sim.db`, `file:./data/shop_sim.sqlite3`. Refused: `database/shop.sqlite` with `_sim`; `sqlite:///var/db/prod_sim.db` with `prod`.

### a database host that is not local is refused unless listed; prod hosts always
The value is `postgres://u:p@HOST:5432/shop_sim`, variable `URL` (so `dbVar` is `URL`).

| Host | options | Expected |
|---|---|---|
| `localhost` | none | ok |
| `127.0.0.1` | none | ok |
| `db.internal` | none | not ok |
| `db` | `dbHosts: ['db']` | ok |
| `prod-db` | `dbHosts: ['prod-db']` | not ok |

### db name inside a URL is parsed
`mysql://u:p@localhost/shop_sim` is ok; `mysql://u:p@localhost/shop` is not ok (`dbVar` is `URL`).

### ${name}=${value} is refused
One test per pair, 22 in all: `name` is each of `NODE_ENV`, `APP_ENV`, `RAILS_ENV`, `DJANGO_ENV`, `FLASK_ENV`, `ENVIRONMENT`, `ENV`, `RACK_ENV`, `MIX_ENV`, `ASPNETCORE_ENVIRONMENT`, `GO_ENV`, and `value` is each of `production`, `prod`. Example title: `NODE_ENV=production is refused`. Input `{ DB_NAME: 'shop_sim', [name]: value }`; refused with the variable name.

### staging env names are fine
`{ DB_NAME: 'shop_sim', NODE_ENV: 'development' }` is ok.

### live secret pattern ${label} is refused
One test per row, 11 in all. Input `{ DB_NAME: 'shop_sim', SOME_KEY: value }`; refused with `SOME_KEY`. Build each value from two or more string pieces joined at run time, so secret scanners do not flag the test file.

| label (title) | value |
|---|---|
| `sk_live_` | `sk_live_abc123` |
| `rk_live_` | `rk_live_abc123` |
| `pk_live_` | `pk_live_abc123` |
| `AKIA` | `AKIAABCDEFGHIJKLMNOP` |
| `xox` | `xoxb-1234-abcd` |
| `ghp_` | `ghp_abcdef` |
| `gho_` | `gho_abcdef` |
| `github_pat_` | `github_pat_abcdef` |
| `SendGrid` | `SG.abcdefghijklmnop.qrst` |
| `AIza` | `AIza` followed by 35 times `A` |
| `PRIVATE` | `-----BEGIN RSA PRIVATE KEY-----` |

### forbidden host in any value is refused
Input `{ DB_NAME: 'shop_sim', API: 'https://API.RealShop.com/v1' }` with `forbiddenHosts: ['realshop.com']`: refused with `realshop.com`.

### buildEnv drops the real HOME unless HOME is allowed
`base` is `{ PATH: '/bin', HOME: '/h' }`.

| allow | fakes | Expected |
|---|---|---|
| `[]` | `{}` | `{ "PATH": "/bin" }` |
| `["HOME"]` | `{}` | `{ "PATH": "/bin", "HOME": "/h" }` |

### buildEnv keeps only the base three, allowed names and fakes
Input: `allow: ['KEEP_ME']`, `fakes: { DB_NAME: 'x_sim', HOME: '/fake' }`, `base: { PATH: '/bin', HOME: '/h', TMPDIR: '/t', LANG: 'C', KEEP_ME: '1', AWS_SECRET: 'no', NODE_ENV: 'production' }`. Expected: `{ "PATH": "/bin", "HOME": "/fake", "TMPDIR": "/t", "LANG": "C", "KEEP_ME": "1", "DB_NAME": "x_sim" }`.

### checkCopy refuses .env and .env.* at top level and one level down
Work in a new temp folder `dir`.

| Step | Action | Expected |
|---|---|---|
| 1 | create empty files `.env.example` and `.env.sim` | `checkCopy(dir).ok` is true |
| 2 | create folder `api` with an empty file `.env.production` | reasons joined match `api.*\.env\.production` |
| 3 | create `.env` at top level | 2 reasons in all |
| 4 | `checkCopy(dir + '/nope')` | not ok |

### checkCopy finds a deep .env, skips node_modules and vendor, survives a broken symlink
New temp folder `dir`: create folders `apps/api/config` and `vendor/x`; an empty `vendor/x/.env`; a symlink `broken` that points to a path that does not exist.

| Step | Action | Expected |
|---|---|---|
| 1 | `checkCopy(dir)` | ok |
| 2 | create empty `apps/api/config/.env` | reasons joined match `apps/api/config/\.env` |

### assertSafe lists every reason
- `assertSafe(check({}), check({ DB_NAME: 'prod' }))` throws an error whose message matches `missing[\s\S]*_sim[\s\S]*prod`.
- `assertSafe(check({ DB_NAME: 'shop_sim' }))` does not throw.

### separate host variables and ?host= are checked like a URL host
`ck(env, dbHosts?)` is `checkEnv({ DB_NAME: 'shop_sim', ...env }, { dbVar: 'DB_NAME', dbHosts })`.

| Input | Expected |
|---|---|
| `ck({ DB_HOST: 'db.internal' })` | not ok |
| `ck({ PGHOST: '10.0.0.5' })` | not ok |
| `ck({ DB_HOST: '127.0.0.1' })` | ok |
| `ck({ DB_HOST: 'DB' }, ['db'])` | ok |
| `{ URL: 'postgres://u:p@localhost/shop_sim?host=other.example' }`, dbVar `URL` | not ok |
| `{ URL: 'postgres://u:p@localhost/shop_sim?host=localhost' }`, dbVar `URL` | ok |

### a malformed % in the name is a refusal, not a throw; dbHosts match any case
- `checkEnv({ DB: 'shop%' }, { dbVar: 'DB' })` is not ok (and does not throw).
- `checkEnv({ URL: 'postgres://u:p@DB/shop_sim' }, { dbVar: 'URL', dbHosts: ['DB'] })` is ok.

## oracle.test.ts

### violation kinds: failure, observed, gap; unknown id throws
With `rules3`: `violation('a','x','bad')`, `violation('b','x','odd')`, `violation('g','x','unknown answer')`. `violation('zzz','x','y')` throws an error matching `unknown rule id "zzz"`. `results()`: failures 1, observed 1, gaps 1; `failures[0].kind` is `failure`.

### expect counts a pass or records a violation
With `rules3`: `expect('a', true, 'x', 'fine')` and `expect('a', false, 'x', 'broken')`. `results().passes` is 1; `results().failures[0].text` is `broken`.

### stuck respects the settle window and terminal states
Call `stuck(entities, ['delivered'], 100, 1000, 'a')`:

| id | state | updatedAt |
|---|---|---|
| old | pending | 0 |
| fresh | pending | 950 |
| done | delivered | 0 |

Expected: the `who` of the failures is `["old"]`; passes is 2.

### agree needs deep equality across roles
- `agree('o1', { customer: { t: 1, l: [1] }, shop: { t: 1, l: [1] } }, 'a')`: no failures.
- then `agree('o2', { customer: { t: 1 }, shop: { t: 2 } }, 'a')`: 1 failure.

### transitions flags a step the table does not allow
`allowed` is `{ "placed": ["accepted","cancelled"], "accepted": ["delivered"] }`.
- `transitions('o1', ['placed','accepted','delivered'], allowed, 'a')`: no failures.
- `transitions('o2', ['placed','cancelled','delivered'], allowed, 'a')`: the first failure's text matches `cancelled -> delivered`.

### parseRules reads RULES.md lines
Input (joined with newlines): `# Rules`, `` - `x-1` [confirmed] Never do x (source: owner) ``, `` - `y-2` [observed, gap] Maybe y (source: code) ``, `noise`. Expected:

```json
[
  { "id": "x-1", "status": "confirmed", "text": "Never do x (source: owner)" },
  { "id": "y-2", "status": "observed", "text": "Maybe y (source: code)", "gap": true }
]
```

The first object has no `gap` key (deep equality).

### readOutbox reads JSON lines and tolerates a missing file
`readOutbox('/nonexistent/outbox.jsonl')` equals `[]`.

## run.test.ts

### run folder layout and the exact first summary line
`startRun({ root: tmp(), mode: 'every-scenario', seed: 7 })`.
- `dir` matches `runs/\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d-every-scenario-7$`.
- `event({ type: 'hello' })`. A `Checker(rules1)` gets `expect('r1', true, 'a', 'ok')` and `violation('r1', 'order 1', 'it broke')`. `finish(checker, { egress: [{ host: 'h', at: 't' }] })`.
- `summary.md`: first line is exactly `Untriaged violations: 1 · known gaps: 0 · observed-only: 0 · passes: 1`; the whole text matches `## FAIL: r1[\s\S]*- order 1: it broke`.
- `metrics.json`: `commit` is `unknown` (the temp folder is not a git repo), `coreVersion` equals `CORE_VERSION`, `seed` is 7, `egress` has 1 entry.
- `events.jsonl` matches `"type":"hello"`.

### same seed, same shuffle; another seed differs
With names `a` to `h` (8 names): `seeded(42).shuffle(names)` deep-equals a second `seeded(42).shuffle(names)`; it does not deep-equal `seeded(43).shuffle(names)`. With `r = seeded(1)`, 50 draws of `r.int(3, 5)` are all between 3 and 5.

### runSim: every-scenario order is seeded, replay repeats it, a crash is a violation
Scenarios `a`, `b`, `c`, `d` (each pushes its name to a list `seen`) and `boom` (throws `new Error('kaput')`), `fakeApp` start, the standard `envOpts`, rules `rules1`.

| Step | Action | Expected |
|---|---|---|
| 1 | `runSim` mode `every-scenario`, seed 5 | 1 failure; its `ruleId` is `scenario-crash` |
| 2 | clear `seen`, `runSim` mode `replay`, `replayDir` = step 1's dir | `seen` equals the order recorded in step 1 |
| 3 | | `metrics.json` exists in step 1's dir |

### runSim refuses before the app starts
`runSim` with no scenarios, a `start` that sets a flag, and `envOpts.fakes` `{ DB_NAME: 'shop' }`: rejects with an error matching `refused to start`; the flag is still false.

### readOutbox maps a product's own kind key to channel
File with the two lines `{"kind":"sms","to":"1","body":"x"}` and `{"channel":"push","to":"2","body":"y"}`. The channels read are `["sms","push"]`.

### the app gets a fresh HOME inside the run folder, never the developer's
- `start` records `env.HOME`. After `runSim(one({ start }))`: `HOME` differs from the process's `HOME`; it starts with the run's `dir`; the folder exists.
- With `envOpts.allow` set to `['HOME']`: the `HOME` that `start` sees equals the process's `HOME`.

### the guard checks what start returns, and stops the app
`start` returns the fake app with `env: { DB_NAME: 'production_shop' }` and a `stop` that sets a flag. `runSim` rejects with an error matching `refused to start[\s\S]*production_shop`; the flag is true.

### an after hook that throws is a violation and the summary is still written
`after` throws `new Error('rows is not iterable')`. `results.failures[0].who` is `after`; `summary.md` matches `scenario-crash[\s\S]*after`.

### a bad outbox line is reported, the good ones still read
- Scenario `a` writes `{"kind":"sms"}`, a newline, `not json`, a newline to its `outboxPath`. `results.failures[0].who` is `outbox`; `summary.md` exists in the run folder.
- A file with the same two lines: `readOutbox(file, onBad)` returns 1 message, and `onBad` was called once with `not json`.

### an unknown mode is refused
`runSim(one({ mode: 'bogus' }))` rejects with an error matching `unknown mode "bogus"`.

### a hung bot request times out and counts as a crash
A server that never answers; `start` returns its URL with a no-op `stop`; `httpTimeoutMs` is 100; scenario `a` calls `c.http('GET', '/x')`. `results.failures[0].ruleId` is `scenario-crash`. Close the server afterwards (`closeAllConnections`, then `close`).

### replay keeps each scenario's numbers when a scenario is added, and warns about it
Scenarios `a`, `b`, `c` each store `c.rng.int(0, 1000000)` under their name in `draws`. Run once, copy `draws`. Replay with the scenarios plus `aa` (same recording function). Expected: `draws.a` and `draws.c` equal the first run's; `aa` is not in `draws`; the replay's `summary.md` matches `Warning: replay: scenario "aa" is new`.

### replay warns when the commit differs from the recorded one
Run once; rewrite its `metrics.json` with `commit` set to `aaaaaaaaaaaa`; replay. The replay's `summary.md` matches `Warning: replay: the code is at commit unknown, the run was made at aaaaaaaaaaaa`.

### readCommit asks git, also for packed refs
In a new temp folder: `git init -q`; one empty commit (with `commit.gpgsign=false` and a throwaway name and email set through `-c`); `git pack-refs --all`. `readCommit(dir)` equals `git rev-parse --short=12 HEAD` in that folder.

### parseRules throws on a malformed rule line instead of dropping it
- `` - `a-b` [confirmed] ok `` gives 1 rule.
- `` - `a-b` [Confirmed] text `` throws an error matching `cannot read rule line`.
- `` - `b_c` [confirmed] text `` throws an error matching `cannot read rule line`.

### a single-scenario replay does not call the other scenarios new
Scenarios `a` and `b`. Run in mode `scenario` with `scenario: 'a'`, then replay it. The replay's `summary.md` does not match `is new since that run`.

### replay warns when the commit is unknown on both sides
Run once, replay. The replay's `summary.md` matches `Warning: replay: commit unknown`.

### a start that returns HOME is refused unless it is the run's own
`start` returns the fake app with `env: { HOME: '/somewhere/else' }`. `runSim` rejects with an error matching `refused to start[\s\S]*HOME`.

### stop() that throws still writes the summary, with a warning
`stop` closes the server and then throws `new Error('stop failed x')`. The run's `summary.md` matches `Warning: stop failed`.

### HOME is absolute when the root is relative
`start` records `env.HOME`. Run with `root` set to the temp folder's path relative to the current directory. The recorded `HOME` is an absolute path.
