import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Checker } from '../oracle.ts';
import { parseRules } from '../rules.ts';
import { readOutbox } from '../outbox.ts';

const rules = [
  { id: 'a', text: 'confirmed rule', status: 'confirmed' as const },
  { id: 'b', text: 'observed rule', status: 'observed' as const },
  { id: 'g', text: 'gap rule', status: 'confirmed' as const, gap: true },
];

test('violation kinds: failure, observed, gap; unknown id throws', () => {
  const c = new Checker(rules);
  c.violation('a', 'x', 'bad');
  c.violation('b', 'x', 'odd');
  c.violation('g', 'x', 'unknown answer');
  assert.throws(() => c.violation('zzz', 'x', 'y'), /unknown rule id "zzz"/);
  const r = c.results();
  assert.deepEqual([r.failures.length, r.observed.length, r.gaps.length], [1, 1, 1]);
  assert.equal(r.failures[0].kind, 'failure');
});

test('expect counts a pass or records a violation', () => {
  const c = new Checker(rules);
  c.expect('a', true, 'x', 'fine');
  c.expect('a', false, 'x', 'broken');
  assert.equal(c.results().passes, 1);
  assert.equal(c.results().failures[0].text, 'broken');
});

test('stuck respects the settle window and terminal states', () => {
  const c = new Checker(rules);
  c.stuck(
    [
      { id: 'old', state: 'pending', updatedAt: 0 },
      { id: 'fresh', state: 'pending', updatedAt: 950 },
      { id: 'done', state: 'delivered', updatedAt: 0 },
    ],
    ['delivered'],
    100,
    1000,
    'a',
  );
  assert.deepEqual(c.results().failures.map((v) => v.who), ['old']);
  assert.equal(c.results().passes, 2);
});

test('agree needs deep equality across roles', () => {
  const c = new Checker(rules);
  c.agree('o1', { customer: { t: 1, l: [1] }, shop: { t: 1, l: [1] } }, 'a');
  assert.equal(c.results().failures.length, 0);
  c.agree('o2', { customer: { t: 1 }, shop: { t: 2 } }, 'a');
  assert.equal(c.results().failures.length, 1);
});

test('transitions flags a step the table does not allow', () => {
  const c = new Checker(rules);
  const allowed = { placed: ['accepted', 'cancelled'], accepted: ['delivered'] };
  c.transitions('o1', ['placed', 'accepted', 'delivered'], allowed, 'a');
  assert.equal(c.results().failures.length, 0);
  c.transitions('o2', ['placed', 'cancelled', 'delivered'], allowed, 'a');
  assert.match(c.results().failures[0].text, /cancelled -> delivered/);
});

test('parseRules reads RULES.md lines', () => {
  const md = '# Rules\n- `x-1` [confirmed] Never do x (source: owner)\n- `y-2` [observed, gap] Maybe y (source: code)\nnoise';
  assert.deepEqual(parseRules(md), [
    { id: 'x-1', status: 'confirmed', text: 'Never do x (source: owner)' },
    { id: 'y-2', status: 'observed', text: 'Maybe y (source: code)', gap: true },
  ]);
});

test('readOutbox reads JSON lines and tolerates a missing file', () => {
  assert.deepEqual(readOutbox('/nonexistent/outbox.jsonl'), []);
});
