# Core spec

`CORE_VERSION`: `0.1.1`

This file describes the simulator core, in words, so that Claude can build it into `sim/core/` of a project. The skill's hard rules depend on this core being exact. Build what is written here, nothing more, nothing less. `references/core-cases.md` holds the test cases the rebuilt core must pass.

## Setup

- Language: TypeScript as ESM, run directly by Node 24 or later (native type stripping, no build step). Use only erasable TypeScript: no enums, no namespaces, no constructor parameter properties.
- Imports between core files use the `.ts` extension (`./oracle.ts`). Type-only imports use `import type`. Built-in modules use the `node:` prefix. No dependencies.
- `sim/package.json` holds `{"type":"module"}`. Exclude `sim/` from the project's `tsconfig` and linters.
- Files, all in `sim/core/`: `version.ts`, `rng.ts`, `rules.ts`, `outbox.ts`, `egress.ts`, `guard.ts`, `oracle.ts`, `features.ts`, `run.ts`, `runner.ts`. Dependencies between them: `rules` imports the `Rule` type from `oracle`; `features` and `run` as stated below; `runner` imports from all the others.
- Messages quoted in backticks below are the exact text. A `${x}` inside one stands for the value. Tests match on them.

## version.ts

Exports `CORE_VERSION`, a string constant, `'0.1.1'`. The runner writes it to `metrics.json`. `PLAN.md` records it on its `Core:` line.

## rng.ts

A seeded random source: the same seed always gives the same sequence.

```ts
export function seeded(seed: number): { next(): number; int(min: number, max: number): number; pick<T>(arr: T[]): T; shuffle<T>(arr: T[]): T[] };
export type Rng = ReturnType<typeof seeded>;
```

- State: one unsigned 32-bit integer, started as the seed converted to unsigned 32-bit (`seed >>> 0`).
- `next()` is the mulberry32 generator. One call does these steps, all in unsigned 32-bit arithmetic:
  1. Add `0x6d2b79f5` to the state (wrapping at 2^32) and keep it as the new state. Call the new state `t`.
  2. Set `t` to the 32-bit integer product of `t` XOR (`t` shifted right 15) and `t` OR 1.
  3. Set `t` to `t` XOR (`t` plus the 32-bit integer product of `t` XOR (`t` shifted right 7) and `t` OR 61). In code: `t ^= t + Math.imul(t ^ (t >>> 7), t | 61)`. The sum is not wrapped on its own: the `^` converts it to a signed 32-bit integer, which has the same bits as wrapping at 2^32. Steps 2 and 3 use `Math.imul`, so the intermediate values are signed 32-bit; only the returned value is made unsigned (step 4).
  4. Return the unsigned value of `t` XOR (`t` shifted right 14), divided by 4294967296. The result is in the range from 0 up to but not including 1. Pinned values: `seeded(1)` returns `0.6270739405881613`, `0.002735721180215478`, `0.5274470399599522`, `0.9810509674716741`, `0.9683778982143849` (the first test case of `rng.test.ts` checks them).
- `int(min, max)` returns `min + floor(next() * (max - min + 1))`: a whole number from `min` to `max`, both included.
- `pick(arr)` returns `arr[int(0, arr.length - 1)]`.
- `shuffle(arr)` returns a new array and leaves the input alone. It is Fisher-Yates from the end: for `i` from `length - 1` down to 1, draw `j = int(0, i)` and swap positions `i` and `j`.

## rules.ts

Parses `sim/RULES.md`.

```ts
export function parseRules(markdown: string): Rule[];   // Rule is declared in oracle.ts
```

- The text is split on newlines and each line is trimmed.
- A rule line has exactly this shape: a dash and a space, the id in backticks (lowercase letters, digits and hyphens only), a space, the status in square brackets (`confirmed` or `observed`, optionally followed by a comma, a space and `gap`), a space, then the text (at least one character, rest of the line).
- A matching line gives `{ id, status, text }`, plus `gap: true` only when `, gap` is present (the key is absent otherwise).
- A trimmed line that starts with a dash, a space and a backtick but does not match the shape throws `RULES.md: cannot read rule line: ${the trimmed line}`. Examples: an uppercase status, an underscore in the id.
- A rule line with no text after the status (for example `- `a` [confirmed]`, or `- `a` [confirmed] ` once trimmed) does not match the shape, so it throws the same error. The check for the throw is only that the trimmed line starts with ``- ` ``; an id with a space in it also throws.
- Every other line (headings, free text) is ignored.

## outbox.ts

Reads the file the app's senders write to instead of sending (`OUTBOX_PATH`): one JSON object per line.

```ts
export type OutboxMessage = { channel: string; to: string; body: string; [k: string]: unknown };
export function readOutbox(path: string, onBad?: (line: string) => void): OutboxMessage[];
```

- A missing file gives an empty array.
- Lines that are empty or only whitespace are skipped.
- Each other line is parsed as JSON. The message is the parsed object with `channel` set to its own `channel`, else its `kind`, else its `type`, else the text `unknown`. All other keys are kept. "Its own", "else" use `??`: only a missing key or `null` falls through to the next one; an empty string is kept as the channel. The message is a shallow copy made by object spread, with no check on the shape: a JSON array, number, string or `true` is not refused. An array or string spreads into index keys (`[1]` gives `{ "0": 1, channel: "unknown" }`), a number or `true` gives just `{ channel: "unknown" }`.
- A line that cannot be parsed, or whose mapping fails (JSON `null` is the only value that makes it fail), is skipped and handed to `onBad` (default: do nothing). One bad line never stops the others.

## egress.ts

A local HTTP proxy that refuses everything and records which host the app tried to reach. Limit, to keep in a code comment: an app that ignores `HTTP_PROXY` and `HTTPS_PROXY` is not caught. Node's own `fetch` needs `NODE_USE_ENV_PROXY=1` (the runner sets it). The strong wall is one container holding the whole simulator with `--network none`; the trap only makes leaks visible.

```ts
export type EgressAttempt = { host: string; at: string };
export function startEgressTrap(): Promise<{ url: string; attempts(): EgressAttempt[]; close(): Promise<void> }>;
```

- Listens on port 0 (the system picks) on `127.0.0.1`. `url` is `http://127.0.0.1:<port>`.
- Every plain proxied request is recorded and answered with status 502, content type `text/plain`, body `egress blocked by simulate` plus a newline.
- Every CONNECT request (HTTPS) is recorded and answered by writing `HTTP/1.1 502 Bad Gateway`, `connection: close`, a blank line, and ending the socket with `socket.end(reply)` (a graceful end, not `destroy()`).
- A record is `{ host, at }`: `at` is the current time as an ISO string. Host extraction: take the request target (`req.url`; for CONNECT it is `host:port`); when it is missing use the `Host` header; when that is missing too use `unknown`. When the text lacks `://`, put `http://` in front. Parse it as a URL and use its hostname. When parsing fails, use the raw text (the target or header as it was, without the added `http://`). The target is `req.url` when it is not undefined, even an empty string; the `Host` header is used only when `req.url` is undefined, which does not happen for requests a real client sends. So a plain proxied request is judged by its `req.url`: an absolute-form target (`http://sms.example.invalid/send`, what a proxy client sends) gives its hostname, while a path-only target such as `/send` is parsed as `http:///send` and gives the host `send`. The `Host` header is never consulted in that case. CONNECT uses only `req.url` (there is no header fallback).
- `attempts()` returns a copy of the records so far, in order.
- `close()` destroys every open socket (the trap tracks them), then closes the server, and resolves when closed.

## guard.ts

The safety wall. It fails closed: anything it cannot prove safe is refused.

```ts
export type Verdict = { ok: boolean; reasons: string[] };
export function buildEnv(opts: { allow: string[]; fakes: Record<string, string>; base?: Record<string, string | undefined> }): Record<string, string>;
export function checkEnv(env: Record<string, string | undefined>, opts: { dbVar: string; forbiddenHosts?: string[]; dbHosts?: string[] }): Verdict;
export function checkCopy(dir: string): Verdict;
export function assertSafe(...verdicts: Verdict[]): void;
```

A verdict is `ok` exactly when `reasons` is empty. Every refusal adds one reason; checks do not stop at the first.

### buildEnv

Works like `env -i`: nothing from the developer's shell gets in unless listed.
- `base` defaults to the process environment.
- The kept names are `PATH`, `TMPDIR`, `LANG`, followed by the names in `allow`. A name is copied only when its value in `base` is not undefined.
- Then every entry of `fakes` is merged on top and wins.
- `HOME` is not kept by default (it holds `~/.aws`, `~/.netrc` and the like). A plan that needs the real one lists `HOME` in `allow`. A fake `HOME` in `fakes` wins over both.

### checkEnv

Constants:
- Environment-name variables: `NODE_ENV`, `APP_ENV`, `RAILS_ENV`, `DJANGO_ENV`, `FLASK_ENV`, `ENVIRONMENT`, `ENV`, `RACK_ENV`, `MIX_ENV`, `ASPNETCORE_ENVIRONMENT`, `GO_ENV`.
- Loopback hosts: `localhost`, `127.0.0.1`, `::1`, `[::1]`.
- Bad-word pattern (case-insensitive): the word `prod`, `production`, `live`, `test` or `testing` bounded on each side by the start or end of the text or one of `_`, `.`, `-`. So `delivery_sim`, `products_sim` and `latest_sim` pass; `my_PROD_sim` and `a-live-b_sim` do not. The matched word is reported in lowercase. The pattern is the single regular expression `/(^|[_.-])(prod|production|live|test|testing)([_.-]|$)/i` used with `match` (no global flag), with the boundaries inside the match, so only the leftmost match counts and one word is reported: `a_live_test_sim` reports `live`, `x_test_live_sim` reports `test`. The alternation backtracks, so `production` is reported whole, never as `prod`. A name made only of a bad word (`test`) matches too.
- Host variables: `DB_HOST`, `DATABASE_HOST`, `PGHOST`, `MYSQL_HOST`.
- Secret patterns, label then pattern:

| Label | Pattern |
|---|---|
| Stripe live secret key | contains `sk_live_` |
| Stripe live restricted key | contains `rk_live_` |
| Stripe live publishable key | contains `pk_live_` |
| AWS access key id | `AKIA` followed by 16 uppercase letters or digits |
| Slack token | contains `xox` then one of `b`, `a`, `p`, `r`, `s`, then `-` |
| GitHub token | contains `ghp_`, `gho_` or `ghs_`, or contains `github_pat_` |
| SendGrid key | `SG.` followed by 16 or more letters, digits, `_` or `-` |
| Google API key | `AIza` followed by 35 letters, digits, `_` or `-` |
| private key | `-----BEGIN ` then any characters, then `PRIVATE KEY-----`; the regular expression is `/-----BEGIN .*PRIVATE KEY-----/` without the `s` flag, so `.` does not cross a line break and the whole match sits on one line (`-----BEGIN RSA PRIVATE KEY-----` matches; a header split by a line break does not) |

Reading the database variable `dbVar`:
- `dbOf(value)` gives a database name and a list of hosts.
  - A value with no `:` in it, or one that starts with a drive letter, colon and a slash or backslash (`C:\data\x`), is a plain name or file path: the name is made in this order: percent-decode the whole value first (when decoding fails keep the raw text), then take its last `/` segment, then remove a trailing `.sqlite`, `.sqlite3` or `.db` removed. No hosts.
  - Otherwise parse it as a URL with `new URL(value)`; a missing scheme is not guessed, so `host:5432/x_sim` parses with the scheme `host:`, an empty hostname and the first path segment `5432`, and is refused (name `5432` does not end in `_sim`; empty host). For the schemes `sqlite:` and `file:` the name comes from the URL path the same way as above, no hosts. For any other scheme the hosts are the URL's hostname and the value of the `host` query parameter (when present), both lowercased; an empty `host` parameter is dropped, and an empty hostname is dropped only when a non-empty `host` parameter is present (libpq lets `?host=` override the authority). The name is the first path segment after removing leading slashes (cut at `/` before decoding), then percent-decoded and cut at its last `/` and stripped of the suffix as above.
  - When URL parsing throws, the name is the whole value and there are no hosts.
  - The suffix removal and the percent-decoding apply to every name, also for non-sqlite URLs (`postgres://h/shop_sim.db` gives `shop_sim`). When the URL has an empty hostname (`postgres:///shop_sim`) and no `host` parameter, the host list holds one empty host, which check 4 refuses. A name that decodes to the empty string fails the `_sim` check as usual.

Checks, in this order, collecting reasons:
1. `dbVar` unset or empty: `${dbVar} is missing: the database name must be set and end in _sim`. Checks 2 and 3 then do not run. Check 4 still runs, on the host variables alone, so every reason shows at once. Checks 5 and 6 still run.
2. The name does not end in `_sim` (case-sensitive: `shop_SIM` is refused): `database name "${name}" (${dbVar}) does not end in _sim`.
3. The name matches the bad-word pattern: `database name "${name}" contains "${word}"`.
4. Hosts: the hosts from `dbOf` (none when `dbVar` was missing), plus the trimmed lowercase value of each host variable whose value in `env` is not undefined. A host variable that is empty or only spaces gives `${var} is empty: unset it or set an explicit local host` and adds no host. An empty host from `dbOf` (a URL with an empty hostname) gives `database URL has no host: set an explicit local host (localhost or 127.0.0.1)`, with no other host check. For every other host: when it matches the bad-word pattern, `database host "${host}" contains "${word}"`; and when it is not loopback and not in `dbHosts` (compared in lowercase), `database host "${host}" is not local; list it in dbHosts only if it is the copy's own server`. Both can apply to one host: a host with `prod` in its name is refused even when it is listed.
5. For each environment-name variable: a value that, trimmed and lowercased, is `production` or `prod` gives `${name}=${value} is a production setting` (value as set).
6. For every entry of `env` whose value is not undefined, in entry order: each secret pattern that matches the value gives `${key} holds a live secret (${label})`; then each non-empty `forbiddenHosts` entry that appears in the value (case-insensitive) gives `${key} points at forbidden host ${host}`.

### checkCopy

Checks that a copy of the project carries no real secrets.
- A directory that does not exist gives not ok with the single reason `copy directory ${dir} does not exist`.
- Otherwise it walks every folder. For each entry (file or folder): when its name is a real env file, add `${path} is a real env file; remove it from the copy`, where `path` is the folder path joined with the entry name. A real env file is any name that is `.env` or starts with `.env.`, except `.env.example` and `.env.sim`.
- The order inside one entry: first the env-file name check (so a file or folder named like a real env file is reported even when it is also skipped, and a real-env-named folder is reported and then walked into), then the skip test, then the directory test. A skipped name (`node_modules`, `vendor`, `.git*`) is never walked, but is still checked by name first (a `.git*` name cannot be a real env file, so this only matters in theory). Entries come in the order `readdirSync` returns them, depth first, so the reasons follow that order.
- A folder that cannot be read, or a `dir` that exists but is a file, makes `readdirSync` throw; `checkCopy` catches it and returns not ok with the reason `cannot read the copy at ${dir}: ${error message}`. Reasons found before the failure are kept.
- It does not descend into `node_modules`, `vendor` or any name starting with `.git`. It uses `lstat`, so a symlink is never followed and a broken symlink cannot throw. Only real directories are walked into.

### assertSafe

Takes any number of verdicts, joins all their reasons in order. When there is at least one, throws an `Error` whose message is `simulate refused to start:` followed by a newline and the reasons, each on its own line starting with `- `. Otherwise returns. A verdict with `ok: false` and no reasons also refuses: when no verdict gave a reason but one is not ok, the single reason is `a safety check failed without giving a reason`.

## oracle.ts

The rule checker. Violations are recorded, never thrown (except for an unknown rule id).

```ts
export type Rule = { id: string; text: string; status: 'confirmed' | 'observed'; gap?: boolean };
export type Violation = { ruleId: string; who: string; text: string; kind: 'failure' | 'observed' | 'gap'; extra?: Record<string, unknown> };
export class Checker {
  rules: Rule[];                                   // public, as given
  constructor(rules: Rule[]);
  rule(id: string): Rule;
  violation(ruleId: string, who: string, text: string, extra?: Record<string, unknown>): void;
  expect(ruleId: string, ok: boolean, who: string, text: string): void;
  stuck(entities: { id: string; state: string; updatedAt: number }[], terminal: string[], settleMs: number, now: number, ruleId: string): void;
  agree(id: string, views: Record<string, unknown>, ruleId: string): void;
  transitions(id: string, states: string[], allowed: Record<string, string[]>, ruleId: string): void;
  results(): { failures: Violation[]; observed: Violation[]; gaps: Violation[]; passes: number };
}
export type Results = ReturnType<Checker['results']>;
```

- `rule(id)` returns the rule with that id, or throws `unknown rule id "${id}"; add it to sim/RULES.md`.
- `violation` is the one sink. It looks the rule up (so an unknown id throws). The kind is `gap` when the rule has `gap`, else `observed` when its status is `observed`, else `failure`. It stores `{ ruleId, who, text, kind }`, plus `extra` only when given. Observed rules and gaps are information, not failures.
- `expect` looks the rule up first (an unknown id throws even when `ok` is true). When `ok` it adds one to the pass count; otherwise it calls `violation(ruleId, who, text)`.
- `stuck`: for each entity it is stuck when its state is not in `terminal` and `now - updatedAt` is greater than `settleMs` (strictly). It calls `expect(ruleId, !stuck, entity.id, 'stuck in "${state}" for ${now - updatedAt} ms (terminal: ${terminal joined with ", "})')`. Every entity counts: a not-stuck one is a pass.
- `agree`: passes when every view in `views` is deep strictly equal (Node's `isDeepStrictEqual`) to the first view. It calls `expect(ruleId, same, id, 'roles disagree: ${JSON.stringify(views)}')`. One call is one pass or one violation.
- `transitions`: for each consecutive pair `from`, `to` in `states`: a pair with equal states is skipped; otherwise `expect(ruleId, (allowed[from] ?? []).includes(to), id, 'illegal transition ${from} -> ${to}')`.
- `results()` returns the stored violations split by kind (in the order recorded) and the pass count.

## features.ts

Parses `sim/FEATURES.md` and reports coverage. The file format, which `parseFeatures` must read:

```
## area
- `feature-id` What it does (source: where it was found)
  - POST /orders
  - GET /orders/:id
- `nightly-report` A scheduled job mails the daily report (source: app/Console/Kernel.php:40)
  - OUTBOX mail          seen when the outbox holds a message on that channel
  - EVENT report-sent    seen when a scenario logs ctx.event({ type: 'report-sent' })
- `feature-id` skip: why no scenario covers it (source: developer, 2026-11-20)
```

A feature with no route and no evidence line is "not measured". Put this format as a comment at the top of the file.

```ts
export type Route = { method: string; path: string };
export type Evidence = { kind: 'OUTBOX' | 'EVENT'; name: string };
export type Feature = { id: string; area: string; text: string; skip?: string; routes: Route[]; evidence: Evidence[] };
export type Seen = { outbox: string[]; events: string[] };
export type Coverage = {
  features: { total: number; exercised: number; skipped: number; notExercised: string[]; notMeasured: string[] };
  routes: { total: number; called: number; skipped: number; neverCalled: string[] };
  unlisted: string[];
};
export function parseFeatures(markdown: string): Feature[];
export function coverage(features: Feature[], calls: Route[], seen?: Seen): Coverage;   // seen defaults to no outbox channels and no events
export function inventoryDiff<T extends Route>(features: Feature[], list: T[]): { added: T[]; removed: string[] };
export function coverageLine(c: Coverage): string;
```

### parseFeatures

Reads line by line, counting lines from 1. The current area starts as `general`; a line starting with `## ` sets it to the rest of the line, trimmed.
- Feature line: starts with a dash, space, an id in backticks (lowercase letters, digits, hyphens), a space, and the text (rest of the line). The line is matched as it is, not trimmed, and must start at column 0. The text must have at least one character after the single space, so `- `a` ` with nothing after the space is not a feature line; the line is then ignored, since it is not indented. The text is not trimmed. It starts a new feature `{ id, area, text, routes: [], evidence: [] }`. When the text starts with `skip: ` followed by at least one character, the feature also gets `skip` set to what follows `skip: ` (text stays the whole text). `skip:` with nothing after it, or `skip: ` with only the space, is plain text and gives no `skip`.
- Line endings: the file is split on `\n` or `\r\n`, so a CRLF file parses like an LF one and no `\r` reaches the line patterns.
- `## ` is recognised only at column 0 (a line starting with `## `, not an indented one). "Indented" for evidence and route lines means one or more whitespace characters of any kind (spaces or tabs) before the dash.
- Evidence line: indented, a dash, space, `OUTBOX` or `EVENT` (uppercase only), a space, one word (no spaces), nothing after but spaces. It is added to the latest feature as `{ kind, name }`. The explanations in the format sample above are not part of the line: the parser accepts only `  - OUTBOX mail`.
- Route line: indented, a dash, space, one or more HTTP methods separated by `|` (`GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `ANY`; case-insensitive), a space, a path (no spaces), nothing after but spaces. Each method is uppercased and the path is normalised: a trailing `(.:format)` removed (Rails), leading slashes removed, then one `/` put in front (Laravel paths lack the slash). One route is added to the latest feature per method (`GET|HEAD api/items` gives two routes).
- An indented line starting with a dash that matches none of the three shapes, or an evidence or route line that comes before any feature, throws `FEATURES.md line ${n}: cannot read "${trimmed line}"`. So `  - see notes` and `  - OUTBOX` fail.
- Everything else (the title, blank lines, free text) is ignored.

### Path matching

- A path segment is a parameter when it is, in full: `:name` (letters, digits, underscore), `{anything}` (so `{id?}` too), `[anything]`, or `<anything>` (so `<int:id>`).
- A listed route matches a call when: the route method is `ANY` or the call's method (uppercased, and split on `|` when it holds several) includes the route's method; and the call's path with everything from `?` on removed matches the route path, segment by segment, where a parameter segment matches any non-empty text without `/` and any other segment must match literally (regular-expression characters in it are escaped). One trailing `/` is allowed. The match is anchored on both ends. So `/orders/7.json` matches `/orders/:id`. Only a route's own segments are tested for being parameters (a call's path never is). The characters escaped in a literal segment are `. * + ? ^ $ ( ) | \`. A parameter segment is required: `{id?}` does not make the segment optional. A call path without a leading `/` never matches, because every route path starts with `/` (parseFeatures adds it). The call's method for matching is split on `|`, so a call made with `GET|HEAD` matches routes for either.

### coverage(features, calls, seen)

- Every route of every feature is an entry; an entry is called when at least one call matches it.
- A feature is skipped when it has `skip`. It is measured when it has at least one route or one evidence line. It is reached when one of its routes is called, or one of its evidence lines is seen: `OUTBOX name` is seen when `seen.outbox` includes the name, `EVENT name` when `seen.events` includes it.
- `features.total` is all features; `skipped` the skipped ones; `exercised` the non-skipped, measured, reached ones; `notExercised` the ids of non-skipped, measured, not reached ones; `notMeasured` the ids of non-skipped, not measured ones. Id lists keep the file order.
- `routes.total` counts every route entry; `called` counts the called ones (skipped features included); `skipped` counts entries belonging to skipped features; `neverCalled` lists the entries that are not called and whose feature is not skipped, each as `${method} ${path} (${feature id})`, with the path as parsed.
- `unlisted`: the calls that match no entry of any feature (skipped features included), each as `${METHOD uppercased} ${path without its query}`, without duplicates, in first-seen order. The call's method is uppercased as a whole and not split: a call with method `GET|HEAD` is listed as the one label `GET|HEAD /x`.

### inventoryDiff(features, list)

Compares the features file with the framework's route list taken again after new code. Parameters compare by position, not by name, and the leading slash is optional, so `api/orders/{order}` equals `/api/orders/:id`.
- The shape of a path: drop everything from `?`, drop a trailing `(.:format)`, put a `/` in front, collapse repeated slashes, drop one trailing slash (unless the path is just `/`), then replace every parameter segment (see above) by a bare `:`.
- A method list entry such as `GET|HEAD` counts as several methods.
- `added`: the entries of `list` (returned as given, with any extra fields such as a controller name) for which none of their methods is known for their shape. A method is known for a shape when a feature route has that shape and its method is `ANY` or the same method.
- `removed`: each feature route for which no entry of `list` has the same shape and a method list that includes the route's method (a route with method `ANY` needs only the shape), each as `${method} ${path} (${feature id})`, with the path as parsed (leading `/` added, `(.:format)` removed, not reduced to its shape). An `added` entry needs none of its methods known; when only some are known (`GET|HEAD` with `GET` listed) it is not added.

### coverageLine(c)

Returns exactly: `Coverage: features exercised ${exercised} of ${total} · skipped: ${skipped} · not exercised: ${notExercised.length} · not measured: ${notMeasured.length} · routes called ${called} of ${routes total}`. The separator is a space, a middle dot, a space.

## run.ts

One run's folder, event log, metrics and summary.

```ts
export function readCommit(from: string): string;
export function startRun(o: { root: string; mode: string; seed: number; scenario?: string; commitFrom?: string; warnings?: string[] }):
  { dir: string; event(obj: Record<string, unknown>): void; finish(checker: Checker, extra?: Record<string, unknown>, cov?: Coverage): object };
```

- `readCommit(from)`: runs `git rev-parse --short=12 HEAD` with `from` as working directory, without a shell, standard error ignored, and returns its trimmed output. An empty output or any failure gives `unknown`.
- `startRun`: the run folder is `<root>/runs/<stamp>-<mode>-<seed>` where `<stamp>` is the local time as `YYYY-MM-DD-HH-MM-SS` (every part zero-padded to two digits, year four). When that folder exists already, try the same name with `-2`, then `-3`, and so on, so the suffix goes after the seed (`...-every-scenario-3-2`). The folder is created (with parents). `root` may be relative. The folder is checked and created when `startRun` is called; nothing else happens until `event` or `finish`.
- `event(obj)` appends one line to `events.jsonl` in the folder: JSON of `{ at: <now as ISO string>, ...obj }`, then a newline.
- `finish(checker, extra, cov)` writes two files and returns the metrics object.
  - `metrics.json`: pretty JSON (two spaces) plus a trailing newline, with these keys in this order: `mode`, `seed`, `scenario` (the given scenario or `null`), `commit` (`readCommit(commitFrom ?? root)`), `coreVersion` (`CORE_VERSION`), `counts` (`failures`, `observed`, `gaps`, `passes`: the sizes and pass count from `checker.results()`), `durations` (`{ totalMs }`: milliseconds since `startRun`), `egress` (empty array), then every key of `extra` (which overrides any earlier key of the same name, such as `egress` and `durations`), then `coverage` when `cov` is given.
  - `summary.md`, built as follows. Line 1: `Untriaged violations: ${failures} · known gaps: ${gaps} · observed-only: ${observed} · passes: ${passes}`. When `cov` is given, line 2 is `coverageLine(cov)`. Then one line `Warning: ${w}` for each given warning (read when `finish` runs, so warnings added to the same array later still appear). `finish` may be called more than once: each call recomputes and overwrites both files; nothing guards against it, then an empty line. Then three kinds of section, in this order: failures with title `FAIL`, gaps with title `Known gap`, observed with title `Observed`. For each distinct rule id among that kind (in order of first appearance): the heading `## ${title}: ${id}`, an empty line, the rule's text, an empty line, then one line `- ${who}: ${text}` for each violation of that rule, then an empty line. When `cov` is given, then lists, each skipped when empty, each as `## ${heading}`, an empty line, up to 30 lines `- ${item}`, a final line `- and ${n} more (metrics.json)` when there are more than 30, and an empty line: `Features not exercised` (notExercised), `Routes never called` (neverCalled), `Features not measured (no route or evidence line)` (notMeasured), `Called but missing from FEATURES.md` (unlisted). All lines are joined with `\n`. Every line list ends with an empty line, so the file ends with exactly one newline after the last non-empty line (a run with no violations, no coverage and no warnings is the first line plus `\n`); there is no extra blank line at the end. `commit` is read with `readCommit` from `commitFrom` when given, else from `root`; a relative path works as the working directory.

## runner.ts

The run loop. It ties the guard, the trap, the bots and the oracle together.

```ts
export type Http = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
export type Ctx = {
  baseUrl: string; rng: Rng; checker: Checker; event: (obj: Record<string, unknown>) => void; outboxPath: string; http: Http;
  env: Record<string, string>;   // the copy's own environment (allowlist, fakes, proxy trap, OUTBOX_PATH); used to run a command in the copy
};
export type EnvOpts = {
  allow: string[]; fakes: Record<string, string>; base?: Record<string, string | undefined>;
  dbVar: string; forbiddenHosts?: string[];
  dbHosts?: string[];   // non-local database hosts that are the copy's own (a container name); local ones always pass
  copyDir: string;      // the clean copy the app runs from; checked for .env files, and the source of the commit in metrics.json
};
export type RunOpts = {
  root: string; mode: 'every-scenario' | 'scenario' | 'replay'; scenario?: string; replayDir?: string; seed?: number;
  rules: Rule[]; features?: Feature[];
  scenarios: Record<string, (ctx: Ctx) => Promise<void>>;
  start: (env: Record<string, string>) => Promise<{ baseUrl: string; stop: () => Promise<void>; env?: Record<string, string> }>;
  envOpts: EnvOpts;
  after?: (ctx: Ctx) => Promise<void>;
  httpTimeoutMs?: number;   // per bot request; default 30000
};
export function runSim(opts: RunOpts): Promise<{ results: Results; dir: string }>;
```

### Built-in rules

Added (as `confirmed`) to the given rules when no rule has the same id:
- `no-egress`: `The app never contacts a host outside the sandbox.`
- `scenario-crash`: `A scenario runs to the end without throwing.`

### The bot's HTTP client

Each `ctx.http(method, path, body, headers)`:
1. Records `{ method, path }` in the list of calls (before sending).
2. Sends `fetch(baseUrl + path)` with the method, headers `content-type: application/json` plus the given headers (which win), the body as JSON text (no body when `body` is undefined), and an abort after the timeout. Headers are one plain object: a given header whose name differs only in case (`Content-Type`) does not replace the default `content-type`; both are passed, and `fetch` joins their values (`application/json, text/plain`). To replace the default, give the key in lowercase.
3. Reads the response as text and tries to parse it as JSON; when that fails, the text itself is the body.
4. Writes the event `{ type: 'http', method, path, request: body, status, response: <parsed body>, ms: <elapsed> }` straight to the run's event log (so it does not count as a scenario event for coverage). The event is written only after the response text has been read: when `fetch` throws or the timeout fires, the call is still recorded (step 1) but no `http` event is written.
5. Returns `{ status, body }`. A network error or a timeout propagates to the scenario (and becomes a `scenario-crash`).

### runSim, in order

1. Mode: for `replay`, `replayDir` is required (`replay needs replayDir`); read `metrics.json` there and take `seed`, `scenario` (null means none), `order` and `commit` from it; they replace the options' seed and scenario. The mode must be one of `every-scenario`, `scenario`, `replay`, else `unknown mode "${mode}"; have: every-scenario, scenario, replay`. (The mode check comes first.)
2. The seed defaults to the current time in milliseconds modulo 1,000,000. Scenario names are the keys of `scenarios`, sorted. A given scenario (also one taken from a replay's `metrics.json`, which is when it matters) that does not exist throws `unknown scenario "${scenario}"; have: ${names joined with ", "}`. Mode `scenario` without a name throws `scenario mode needs a scenario name`. An empty string counts as no name everywhere: it is not looked up (no `unknown scenario` error), mode `scenario` with it throws the message above, and in the other modes all scenarios run; `metrics.json` still records it as given (`"scenario": ""`).
3. Start the egress trap. Everything after is in a try block; at the end (finally) the app is stopped when still running (errors ignored) and the trap is closed.
4. Environment: `buildEnv` from `allow`, `fakes`, `base`. Then set `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`, `https_proxy` to the trap's url, `NO_PROXY` to `127.0.0.1,localhost`, and `NODE_USE_ENV_PROXY` to `1`.
5. Guard before anything starts: `assertSafe(checkCopy(copyDir), checkEnv(env, { dbVar, forbiddenHosts, dbHosts }))`. A refusal throws and the app is never started.
6. The commit is `readCommit(copyDir)`.
7. Replay warnings (collected in a warnings list; only a replay can have a recorded commit, and an old `metrics.json` without a `commit` gives no commit warning): when the recorded commit exists and differs from the current one: `replay: the code is at commit ${commit}, the run was made at ${oldCommit}`; otherwise, when the recorded commit exists and the current one is `unknown` (this includes both being `unknown`; the first message needs the two values to differ, so equal real commits give no warning): `replay: commit unknown, cannot tell whether the code changed`.
8. The order to run: the single named scenario when one is given (also on replay of a one-scenario run); else on replay, the recorded order minus scenarios that no longer exist; else the sorted names shuffled with `seeded(seed).shuffle`. A replay whose `metrics.json` has no `order` key behaves like a first run for this step: the sorted names are shuffled with the seed from `metrics.json`, and neither the "no longer exists" nor the "is new" warning is made. A single named scenario that is gone never reaches this point (step 2 threw), so on a replay of a one-scenario run the "no longer exists" warning does not occur; the throw is the only outcome. For each recorded scenario in the order that no longer exists (an order-based replay): warning `replay: scenario "${n}" no longer exists and is skipped`. The "is new" warning is made only on a replay with no single scenario: for each existing scenario missing from the recorded order: warning `replay: scenario "${n}" is new since that run and is not replayed`. Print every warning made so far (steps 7 and 8, nothing else) to standard error as `simulate: ${warning}`, one `console.error` call each, before `startRun`. Warnings added later (`stop failed`, step 20) are never printed; they appear only in `summary.md`.
9. `startRun` with the mode, seed, scenario, `commitFrom: copyDir` and the warnings list (the same array).
10. HOME: when the built environment has no `HOME` key (a test of the key being present, not of its value: a `HOME` of `""` in `fakes` counts as present), set it to the absolute path `<run dir>/home` (resolved, so it is absolute even when `root` is relative) and create that folder. The app never sees the developer's `~/.aws` and the like.
11. `OUTBOX_PATH` is set to `<run dir>/outbox.jsonl`.
12. A `Checker` over the rules plus built-ins. The run's `event` function (given to scenarios as `ctx.event`) writes to the run's log and also remembers the object's `type` when it is a string (coverage's `EVENT` evidence).
13. Call `start(env)`; remember the app so it is stopped on any later failure.
14. Guard again, on what `start` added: `assertSafe(checkEnv({ ...env, ...started.env }, same options), <a verdict that fails with the reason "start returned a HOME other than the run's; list HOME in allow to use the real one" when started.env has a HOME that differs from env.HOME>)`. A refusal throws; the app is stopped by the finally block.
15. The context given to a scenario, made with a seed: `baseUrl` of the started app, `rng = seeded(seed)`, the checker, `event`, `outboxPath`, `http` as above (with `httpTimeoutMs` or 30000), and `env = { ...env, ...started.env }`.
16. Write the event `{ type: 'plan', order }`. For each scenario in order: write `{ type: 'scenario-start', name }`, then run it with a context seeded by `seedFor(seed, name)`: start from the run seed and, for each code point of the name in order (`[...name]`, so an astral character such as an emoji is one step), replace the value by `(value * 31 + c.charCodeAt(0)) mod 2^32` (unsigned 32-bit, `>>> 0`), where `c` is that code point as a string: for an astral character `charCodeAt(0)` is its high surrogate only, so the low surrogate adds nothing (`a😀` gives `((seed * 31 + 97) * 31 + 55357) >>> 0`). So adding a scenario never changes the numbers another one draws. When the scenario throws, record `violation('scenario-crash', name, <the first three lines of the error's stack, or its text when no stack, joined with " | ">)`. Measure each scenario's milliseconds.
17. The `after` hook, when given, runs with a context seeded by the run seed itself. When it throws: the same violation with `who` set to `after`.
18. Read the outbox with `readOutbox`; each bad line becomes `violation('scenario-crash', 'outbox', 'line is not JSON: ${first 80 characters of the line}')`.
19. For each recorded egress attempt: `violation('no-egress', 'app', 'tried to reach ${host}', { at })`.
20. Stop the app (mark it stopped first so the finally block does not stop it twice). A failing stop is not an error: add warning `stop failed: ${String(error)}` to the warnings list.
21. `finish` with extra `{ order, egress: <the attempts> (the one snapshot taken at step 19; `attempts()` is read once, so a request that reaches the trap while the app is stopping is in neither the violations nor the metrics), durations: { totalMs: <sum of scenario milliseconds>, scenarios: <name to milliseconds> } }` and, when `features` is given, `coverage(features, calls, { outbox: <channel of each outbox message>, events: <the remembered event types> })`.
22. Return `{ results: checker.results(), dir: <run dir> }`.
