import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startEgressTrap } from './egress.ts';
import { coverage } from './features.ts';
import { readOutbox } from './outbox.ts';
import type { Feature, Route } from './features.ts';
import { assertSafe, buildEnv, checkCopy, checkEnv } from './guard.ts';
import { Checker } from './oracle.ts';
import type { Rule, Results } from './oracle.ts';
import { seeded } from './rng.ts';
import type { Rng } from './rng.ts';
import { readCommit, startRun } from './run.ts';

export type Http = (
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => Promise<{ status: number; body: any }>;

export type Ctx = {
  baseUrl: string;
  rng: Rng;
  checker: Checker;
  event: (obj: Record<string, unknown>) => void;
  outboxPath: string;
  http: Http;
  // The copy's own environment (allowlist, fakes, proxy trap, OUTBOX_PATH). Use it to run a command in the copy,
  // for example a scheduled job: execFileSync('php', ['artisan', 'loyalty:release'], { cwd, env: c.env }).
  env: Record<string, string>;
};

export type EnvOpts = {
  allow: string[];
  fakes: Record<string, string>;
  base?: Record<string, string | undefined>;
  dbVar: string;
  forbiddenHosts?: string[];
  dbHosts?: string[]; // non-local database hosts that are the copy's own (a container name); local ones always pass
  copyDir: string; // the clean copy the app runs from; checked for .env files and used for the commit in metrics.json
};

export type RunOpts = {
  root: string;
  mode: 'every-scenario' | 'scenario' | 'replay';
  scenario?: string;
  replayDir?: string;
  seed?: number;
  rules: Rule[];
  features?: Feature[]; // from sim/FEATURES.md; adds the coverage report
  scenarios: Record<string, (ctx: Ctx) => Promise<void>>;
  // env: what start adds for the copy (its database host, ports, cache); merged into ctx.env for commands.
  start: (env: Record<string, string>) => Promise<{ baseUrl: string; stop: () => Promise<void>; env?: Record<string, string> }>;
  envOpts: EnvOpts;
  after?: (ctx: Ctx) => Promise<void>;
  httpTimeoutMs?: number; // per bot request; default 30000
};

// Rules the runner itself reports against; added as confirmed when missing.
const BUILT_IN: Rule[] = [
  { id: 'no-egress', text: 'The app never contacts a host outside the sandbox.', status: 'confirmed' },
  { id: 'scenario-crash', text: 'A scenario runs to the end without throwing.', status: 'confirmed' },
];

function makeHttp(baseUrl: string, event: Ctx['event'], calls: Route[], timeoutMs: number): Http {
  return async (method, path, body, headers) => {
    calls.push({ method, path });
    const t0 = Date.now();
    const res = await fetch(baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON: keep the text
    }
    event({ type: 'http', method, path, request: body, status: res.status, response: parsed, ms: Date.now() - t0 });
    return { status: res.status, body: parsed };
  };
}

const MODES = ['every-scenario', 'scenario', 'replay'];
// Each scenario gets its own seed from its name, so adding a scenario never changes another one's random values.
const seedFor = (seed: number, name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, seed);

export async function runSim(opts: RunOpts): Promise<{ results: Results; dir: string }> {
  let { mode, scenario, seed } = opts;
  if (!MODES.includes(mode)) throw new Error(`unknown mode "${mode}"; have: ${MODES.join(', ')}`);
  const warnings: string[] = [];
  let oldOrder: string[] | undefined;
  let oldCommit: string | undefined;
  if (mode === 'replay') {
    if (!opts.replayDir) throw new Error('replay needs replayDir');
    const old = JSON.parse(readFileSync(join(opts.replayDir, 'metrics.json'), 'utf8'));
    seed = old.seed;
    scenario = old.scenario ?? undefined;
    oldOrder = old.order;
    oldCommit = old.commit;
  }
  seed = seed ?? Date.now() % 1_000_000;
  const names = Object.keys(opts.scenarios).sort();
  if (scenario && !opts.scenarios[scenario]) throw new Error(`unknown scenario "${scenario}"; have: ${names.join(', ')}`);
  if (mode === 'scenario' && !scenario) throw new Error('scenario mode needs a scenario name');

  const rules = [...opts.rules];
  for (const r of BUILT_IN) if (!rules.some((x) => x.id === r.id)) rules.push(r);

  const trap = await startEgressTrap();
  let app: { stop: () => Promise<void> } | undefined;
  try {
    const { copyDir, dbVar, forbiddenHosts, dbHosts, ...envBits } = opts.envOpts;
    const env = buildEnv(envBits);
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) env[k] = trap.url;
    env.NO_PROXY = '127.0.0.1,localhost';
    env.NODE_USE_ENV_PROXY = '1'; // makes Node's fetch honour the proxy variables
    const dbCheck = { dbVar, forbiddenHosts, dbHosts };
    assertSafe(checkCopy(copyDir), checkEnv(env, dbCheck));

    const commit = readCommit(copyDir);
    if (oldCommit && oldCommit !== commit) warnings.push(`replay: the code is at commit ${commit}, the run was made at ${oldCommit}`);
    else if (oldCommit && commit === 'unknown') warnings.push('replay: commit unknown, cannot tell whether the code changed');
    const chosen = scenario ? [scenario] : oldOrder ? oldOrder.filter((n) => opts.scenarios[n]) : seeded(seed).shuffle(names);
    for (const n of oldOrder ?? []) if (!opts.scenarios[n]) warnings.push(`replay: scenario "${n}" no longer exists and is skipped`);
    if (oldOrder && !scenario) for (const n of names) if (!oldOrder.includes(n)) warnings.push(`replay: scenario "${n}" is new since that run and is not replayed`);
    for (const w of warnings) console.error(`simulate: ${w}`);

    const run = startRun({ root: opts.root, mode, seed, scenario, commitFrom: copyDir, warnings });
    if (!('HOME' in env)) {
      env.HOME = resolve(run.dir, 'home'); // a fresh HOME: the app never reads the developer's ~/.aws and the like
      mkdirSync(env.HOME);
    }
    const outboxPath = join(run.dir, 'outbox.jsonl');
    env.OUTBOX_PATH = outboxPath;
    const checker = new Checker(rules);
    const calls: Route[] = [];
    const eventTypes = new Set<string>();
    const event: Ctx['event'] = (obj) => {
      if (typeof obj.type === 'string') eventTypes.add(obj.type);
      run.event(obj);
    };
    const started = await opts.start(env);
    app = started;
    const homeBack = started.env?.HOME !== undefined && started.env.HOME !== env.HOME;
    assertSafe(checkEnv({ ...env, ...started.env }, dbCheck), { ok: !homeBack, reasons: homeBack ? ["start returned a HOME other than the run's; list HOME in allow to use the real one"] : [] }); // what start added (database host, name) is checked too
    const make = (rngSeed: number): Ctx => ({
      baseUrl: started.baseUrl,
      rng: seeded(rngSeed),
      checker,
      event,
      outboxPath,
      http: makeHttp(started.baseUrl, run.event, calls, opts.httpTimeoutMs ?? 30_000),
      env: { ...env, ...started.env },
    });

    const scenarioMs: Record<string, number> = {};
    run.event({ type: 'plan', order: chosen });
    for (const name of chosen) {
      const t0 = Date.now();
      run.event({ type: 'scenario-start', name });
      try {
        await opts.scenarios[name](make(seedFor(seed, name)));
      } catch (e) {
        checker.violation('scenario-crash', name, String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | '));
      }
      scenarioMs[name] = Date.now() - t0;
    }
    if (opts.after) {
      try {
        await opts.after(make(seed));
      } catch (e) {
        checker.violation('scenario-crash', 'after', String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | '));
      }
    }
    const outbox = readOutbox(outboxPath, (line) => checker.violation('scenario-crash', 'outbox', `line is not JSON: ${line.slice(0, 80)}`));

    const attempts = trap.attempts();
    for (const a of attempts) checker.violation('no-egress', 'app', `tried to reach ${a.host}`, { at: a.at });
    const stopping = app;
    app = undefined;
    await stopping.stop().catch((e) => warnings.push(`stop failed: ${String(e)}`));
    run.finish(
      checker,
      { order: chosen, egress: attempts, durations: { totalMs: Object.values(scenarioMs).reduce((a, b) => a + b, 0), scenarios: scenarioMs } },
      opts.features ? coverage(opts.features, calls, { outbox: outbox.map((m) => m.channel), events: [...eventTypes] }) : undefined,
    );
    return { results: checker.results(), dir: run.dir };
  } finally {
    if (app) await app.stop().catch(() => {});
    await trap.close();
  }
}
