import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../rng.ts';

test('seeded(1) gives the known mulberry32 sequence', () => {
  const r = seeded(1);
  assert.deepEqual([1, 2, 3, 4, 5].map(() => r.next()), [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849]);
});
