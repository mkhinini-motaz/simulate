import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { Checker } from '../oracle.ts';
import { readOutbox } from '../outbox.ts';
import { parseRules } from '../rules.ts';
import { readCommit, startRun } from '../run.ts';
import { runSim } from '../runner.ts';
import { seeded } from '../rng.ts';
import { CORE_VERSION } from '../version.ts';

const rules = [{ id: 'r1', text: 'Rule one', status: 'confirmed' as const }];
const made: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'sim-')); made.push(d); return d; };
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

test('run folder layout and the exact first summary line', () => {
  const root = tmp();
  const run = startRun({ root, mode: 'every-scenario', seed: 7 });
  assert.match(run.dir, /runs\/\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d-every-scenario-7$/);
  run.event({ type: 'hello' });
  const c = new Checker(rules);
  c.expect('r1', true, 'a', 'ok');
  c.violation('r1', 'order 1', 'it broke');
  run.finish(c, { egress: [{ host: 'h', at: 't' }] });
  const summary = readFileSync(join(run.dir, 'summary.md'), 'utf8');
  assert.equal(summary.split('\n')[0], 'Untriaged violations: 1 · known gaps: 0 · observed-only: 0 · passes: 1');
  assert.match(summary, /## FAIL: r1[\s\S]*- order 1: it broke/);
  const m = JSON.parse(readFileSync(join(run.dir, 'metrics.json'), 'utf8'));
  assert.equal(m.commit, 'unknown');
  assert.equal(m.coreVersion, CORE_VERSION);
  assert.equal(m.seed, 7);
  assert.equal(m.egress.length, 1);
  assert.match(readFileSync(join(run.dir, 'events.jsonl'), 'utf8'), /"type":"hello"/);
});

test('same seed, same shuffle; another seed differs', () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  assert.deepEqual(seeded(42).shuffle(names), seeded(42).shuffle(names));
  assert.notDeepEqual(seeded(42).shuffle(names), seeded(43).shuffle(names));
  const r = seeded(1);
  assert.ok(Array.from({ length: 50 }, () => r.int(3, 5)).every((n) => n >= 3 && n <= 5));
});

async function fakeApp() {
  const server = createServer((_req, res) => res.end('{"ok":true}'));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, stop: () => new Promise<void>((ok) => server.close(() => ok())) };
}

test('runSim: every-scenario order is seeded, replay repeats it, a crash is a violation', async () => {
  const seen: string[] = [];
  const mk = (name: string) => async () => { seen.push(name); };
  const base = {
    root: tmp(),
    rules,
    scenarios: { a: mk('a'), b: mk('b'), c: mk('c'), d: mk('d'), boom: async () => { throw new Error('kaput'); } },
    start: () => fakeApp(),
    envOpts: { allow: [], fakes: { DB_NAME: 'x_sim' }, dbVar: 'DB_NAME', copyDir: tmp() },
  };
  const one = await runSim({ ...base, mode: 'every-scenario', seed: 5 });
  const firstOrder = [...seen];
  assert.equal(one.results.failures.length, 1);
  assert.equal(one.results.failures[0].ruleId, 'scenario-crash');
  seen.length = 0;
  await runSim({ ...base, mode: 'replay', replayDir: one.dir });
  assert.deepEqual(seen, firstOrder);
  assert.ok(existsSync(join(one.dir, 'metrics.json')));
});

test('runSim refuses before the app starts', async () => {
  let started = false;
  await assert.rejects(
    runSim({
      root: tmp(), mode: 'every-scenario', rules, scenarios: {},
      start: async () => { started = true; return fakeApp(); },
      envOpts: { allow: [], fakes: { DB_NAME: 'shop' }, dbVar: 'DB_NAME', copyDir: tmp() },
    }),
    /refused to start/,
  );
  assert.equal(started, false);
});

test('readOutbox maps a product\'s own kind key to channel', () => {
  const f = join(tmp(), 'outbox.jsonl');
  writeFileSync(f, JSON.stringify({ kind: 'sms', to: '1', body: 'x' }) + '\n' + JSON.stringify({ channel: 'push', to: '2', body: 'y' }) + '\n');
  assert.deepEqual(readOutbox(f).map((m) => m.channel), ['sms', 'push']);
});

const one = (over: Record<string, unknown> = {}, scenarios: Record<string, any> = { a: async () => {} }) => {
  const root = tmp();
  return {
    root, mode: 'every-scenario' as const, seed: 3, rules, scenarios,
    start: () => fakeApp(),
    envOpts: { allow: [], fakes: { DB_NAME: 'x_sim' }, dbVar: 'DB_NAME', copyDir: tmp() },
    ...over,
  };
};

test('the app gets a fresh HOME inside the run folder, never the developer\'s', async () => {
  let home = '';
  const o = one({ start: async (env: Record<string, string>) => { home = env.HOME; return fakeApp(); } });
  const { dir } = await runSim(o);
  assert.notEqual(home, process.env.HOME);
  assert.ok(home.startsWith(dir), `${home} is not inside ${dir}`);
  assert.ok(existsSync(home));
  // the real one only when the plan allows it
  await runSim(one({ envOpts: { ...o.envOpts, allow: ['HOME'] }, start: async (env: Record<string, string>) => { home = env.HOME; return fakeApp(); } }));
  assert.equal(home, process.env.HOME);
});

test('the guard checks what start returns, and stops the app', async () => {
  let stopped = false;
  const start = async () => { const app = await fakeApp(); return { ...app, stop: async () => { stopped = true; await app.stop(); }, env: { DB_NAME: 'production_shop' } }; };
  await assert.rejects(runSim(one({ start })), /refused to start[\s\S]*production_shop/);
  assert.ok(stopped);
});

test('an after hook that throws is a violation and the summary is still written', async () => {
  const { dir, results } = await runSim(one({ after: async () => { throw new Error('rows is not iterable'); } }));
  assert.equal(results.failures[0].who, 'after');
  assert.match(readFileSync(join(dir, 'summary.md'), 'utf8'), /scenario-crash[\s\S]*after/);
});

test('a bad outbox line is reported, the good ones still read', async () => {
  const scenarios = { a: async (c: any) => { writeFileSync(c.outboxPath, '{"kind":"sms"}\nnot json\n'); } };
  const { dir, results } = await runSim(one({}, scenarios));
  assert.equal(results.failures[0].who, 'outbox');
  assert.ok(existsSync(join(dir, 'summary.md')));
  const f = join(tmp(), 'o.jsonl');
  writeFileSync(f, '{"kind":"sms"}\nnot json\n');
  const bad: string[] = [];
  assert.equal(readOutbox(f, (l) => bad.push(l)).length, 1);
  assert.deepEqual(bad, ['not json']);
});

test('an unknown mode is refused', async () => {
  await assert.rejects(runSim(one({ mode: 'bogus' })), /unknown mode "bogus"/);
});

test('a hung bot request times out and counts as a crash', async () => {
  const hang = createServer(() => {});
  await new Promise<void>((ok) => hang.listen(0, '127.0.0.1', ok));
  const baseUrl = `http://127.0.0.1:${(hang.address() as AddressInfo).port}`;
  const start = async () => ({ baseUrl, stop: async () => {} });
  const { results } = await runSim(one({ start, httpTimeoutMs: 100 }, { a: async (c: any) => { await c.http('GET', '/x'); } }));
  hang.closeAllConnections();
  await new Promise((ok) => hang.close(ok));
  assert.equal(results.failures[0].ruleId, 'scenario-crash');
});

test('replay keeps each scenario\'s numbers when a scenario is added, and warns about it', async () => {
  const draws: Record<string, number> = {};
  const mk = (n: string) => async (c: any) => { draws[n] = c.rng.int(0, 1_000_000); };
  const base = one({}, { a: mk('a'), b: mk('b'), c: mk('c') });
  const first = await runSim(base);
  const before = { ...draws };
  const replay = await runSim({ ...base, mode: 'replay', replayDir: first.dir, scenarios: { ...base.scenarios, aa: mk('aa') } });
  assert.deepEqual(draws.a, before.a);
  assert.equal(draws.c, before.c);
  assert.equal('aa' in draws, false);
  assert.match(readFileSync(join(replay.dir, 'summary.md'), 'utf8'), /Warning: replay: scenario "aa" is new/);
});

test('replay warns when the commit differs from the recorded one', async () => {
  const base = one();
  const first = await runSim(base);
  const m = join(first.dir, 'metrics.json');
  writeFileSync(m, JSON.stringify({ ...JSON.parse(readFileSync(m, 'utf8')), commit: 'aaaaaaaaaaaa' }));
  const replay = await runSim({ ...base, mode: 'replay', replayDir: first.dir });
  assert.match(readFileSync(join(replay.dir, 'summary.md'), 'utf8'), /Warning: replay: the code is at commit unknown, the run was made at aaaaaaaaaaaa/);
});

test('readCommit asks git, also for packed refs', () => {
  const dir = tmp();
  const git = (...a: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: dir }).toString().trim();
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'x');
  git('pack-refs', '--all');
  assert.equal(readCommit(dir), git('rev-parse', '--short=12', 'HEAD'));
});

test('parseRules throws on a malformed rule line instead of dropping it', () => {
  assert.equal(parseRules('- `a-b` [confirmed] ok').length, 1);
  assert.throws(() => parseRules('- `a-b` [Confirmed] text'), /cannot read rule line/);
  assert.throws(() => parseRules('- `b_c` [confirmed] text'), /cannot read rule line/);
});

test('a single-scenario replay does not call the other scenarios new', async () => {
  const base = one({}, { a: async () => {}, b: async () => {} });
  const first = await runSim({ ...base, mode: 'scenario', scenario: 'a' });
  const replay = await runSim({ ...base, mode: 'replay', replayDir: first.dir });
  assert.doesNotMatch(readFileSync(join(replay.dir, 'summary.md'), 'utf8'), /is new since that run/);
});

test('replay warns when the commit is unknown on both sides', async () => {
  const base = one();
  const first = await runSim(base);
  const replay = await runSim({ ...base, mode: 'replay', replayDir: first.dir });
  assert.match(readFileSync(join(replay.dir, 'summary.md'), 'utf8'), /Warning: replay: commit unknown/);
});

test('a start that returns HOME is refused unless it is the run\'s own', async () => {
  const start = async () => ({ ...(await fakeApp()), env: { HOME: '/somewhere/else' } });
  await assert.rejects(runSim(one({ start })), /refused to start[\s\S]*HOME/);
});

test('stop() that throws still writes the summary, with a warning', async () => {
  const start = async () => { const app = await fakeApp(); return { ...app, stop: async () => { await app.stop(); throw new Error('stop failed x'); } }; };
  const { dir } = await runSim(one({ start }));
  assert.match(readFileSync(join(dir, 'summary.md'), 'utf8'), /Warning: stop failed/);
});

test('HOME is absolute when the root is relative', async () => {
  let home = '';
  const o = one({ start: async (env: Record<string, string>) => { home = env.HOME; return fakeApp(); } });
  const rel = relative(process.cwd(), o.root);
  await runSim({ ...o, root: rel });
  assert.ok(isAbsolute(home), home);
});
