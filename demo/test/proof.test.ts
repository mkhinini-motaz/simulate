import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDemo } from '../sim/run.ts';
import { startDemo } from '../sim/start.ts';

const made: string[] = [];
const root = () => { const d = mkdtempSync(join(tmpdir(), 'demo-run-')); made.push(d); return d; };
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

test('with the bugs on, each of the 6 planted bugs is reported under its rule', async () => {
  const { results, dir } = await runDemo({ fixed: false, seed: 1, root: root() });
  const ids = new Set(results.failures.map((v) => v.ruleId));
  for (const id of ['one-order-per-cart', 'no-phone-to-courier', 'views-agree', 'legal-transitions', 'no-egress', 'no-stuck-dispatch']) {
    assert.ok(ids.has(id), `missing failure for ${id}; got ${[...ids].join(', ')}`);
  }
  assert.equal(results.gaps.length, 1);
  const [first, second] = readFileSync(join(dir, 'summary.md'), 'utf8').split('\n');
  assert.match(first, /^Untriaged violations: \d+ · known gaps: 1 · observed-only: 1 · passes: \d+$/);
  // Every route in FEATURES.md is called by some scenario; only the skipped health route is not.
  assert.equal(second, 'Coverage: features exercised 10 of 11 · skipped: 1 · not exercised: 0 · not measured: 0 · routes called 11 of 12');
});

test('with DEMO_FIXED=1 there are no failures (no false alarms)', async () => {
  const { results } = await runDemo({ fixed: true, seed: 1, root: root() });
  assert.deepEqual(results.failures, []);
  assert.equal(results.gaps.length, 1);
  assert.equal(results.observed.length, 1);
});

for (const [label, fakes] of [['a db name without _sim', { DB_NAME: 'shop' }], ['NODE_ENV=production', { NODE_ENV: 'production' }]] as const) {
  test(`refuses before the app starts: ${label}`, async () => {
    let started = false;
    await assert.rejects(
      runDemo({ fakes, root: root(), start: async (env) => { started = true; return startDemo(env); } }),
      /refused to start/,
    );
    assert.equal(started, false);
  });
}
