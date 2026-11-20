import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverage, coverageLine, inventoryDiff, parseFeatures } from '../features.ts';

const md = `# Features
## orders
- \`place\` Place an order (source: a.ts:1)
  - POST /orders
- \`track\` Read an order (source: a.ts:2)
  - GET /orders/:id
  - GET /orders/{id}/items
- \`refund\` Refund (source: a.ts:3)
  - post /orders/[id]/refund
## other
- \`nightly\` A scheduled job (source: jobs.ts:1)
- \`digest\` A mailed digest (source: jobs.ts:2)
  - OUTBOX mail
- \`socket\` A live update (source: ws.ts:1)
  - EVENT order-heard
- \`push\` skip: needs a real device (source: developer, 2026-11-20)
  - POST /devices
`;

test('parseFeatures reads areas, routes, skips and job lines', () => {
  const f = parseFeatures(md);
  assert.deepEqual(f.map((x) => [x.id, x.area, x.routes.length, x.skip ?? null]), [
    ['place', 'orders', 1, null],
    ['track', 'orders', 2, null],
    ['refund', 'orders', 1, null],
    ['nightly', 'other', 0, null],
    ['digest', 'other', 0, null],
    ['socket', 'other', 0, null],
    ['push', 'other', 1, 'needs a real device (source: developer, 2026-11-20)'],
  ]);
  assert.equal(f[2].routes[0].method, 'POST');
  assert.deepEqual(f[4].evidence, [{ kind: 'OUTBOX', name: 'mail' }]);
});

test('coverage matches path parameters in each style and ignores query strings', () => {
  const c = coverage(parseFeatures(md), [
    { method: 'POST', path: '/orders' },
    { method: 'get', path: '/orders/42/items?page=2' },
    { method: 'GET', path: '/admin/secret' },
  ], { outbox: ['mail'], events: ['something-else'] });
  assert.deepEqual(c.features, { total: 7, exercised: 3, skipped: 1, notExercised: ['refund', 'socket'], notMeasured: ['nightly'] });
  assert.deepEqual(c.routes, { total: 5, called: 2, skipped: 1, neverCalled: ['GET /orders/:id (track)', 'POST /orders/[id]/refund (refund)'] });
  assert.deepEqual(c.unlisted, ['GET /admin/secret']);
  assert.equal(coverageLine(c), 'Coverage: features exercised 3 of 7 · skipped: 1 · not exercised: 2 · not measured: 1 · routes called 2 of 5');
});

test('a method mismatch is not a hit, ANY matches every method', () => {
  const f = parseFeatures('- `a` x\n  - GET /a\n- `b` y\n  - ANY /b');
  const c = coverage(f, [{ method: 'POST', path: '/a' }, { method: 'DELETE', path: '/b' }]);
  assert.deepEqual(c.features.notExercised, ['a']);
  assert.deepEqual(c.unlisted, ['POST /a']);
});

test('inventoryDiff names new and removed routes after new code', () => {
  const features = parseFeatures(['## orders', '- `order` Order (source: x)', '  - GET /orders/:id', '  - POST /orders', '  - DELETE /orders/:id', '- `hook` Webhook (source: y)', '  - ANY /webhook'].join('\n'));
  const list = [
    { method: 'GET|HEAD', path: 'orders/{order}' },
    { method: 'POST', path: 'orders' },
    { method: 'GET|HEAD', path: 'orders/export', action: 'ExportController' },
    { method: 'POST', path: 'webhook' },
  ];
  assert.deepEqual(inventoryDiff(features, list), { added: [{ method: 'GET|HEAD', path: 'orders/export', action: 'ExportController' }], removed: ['DELETE /orders/:id (order)'] });
  assert.equal(coverage(features, [{ method: 'GET|HEAD', path: '/orders/7' }]).features.exercised, 1);
});

test('parseFeatures reads Laravel and Rails route lists and fails on a line it cannot read', () => {
  const f = parseFeatures('- `a` x\n  - GET|HEAD api/items\n  - GET /orders/:id(.:format)\n');
  assert.deepEqual(f[0].routes, [
    { method: 'GET', path: '/api/items' }, { method: 'HEAD', path: '/api/items' }, { method: 'GET', path: '/orders/:id' },
  ]);
  const c = coverage(f, [{ method: 'GET', path: '/orders/7.json' }, { method: 'GET', path: '/api/items' }]);
  assert.deepEqual(c.routes.neverCalled, ['HEAD /api/items (a)']);
  assert.throws(() => parseFeatures('- `a` x\n  - OUTBOX\n'), /line 2/);
});

test('inventoryDiff agrees with parseFeatures on Rails (.:format) paths', () => {
  const f = parseFeatures('## o\n- `orders` O\n  - GET /orders/:id(.:format)');
  assert.deepEqual(inventoryDiff(f, [{ method: 'GET', path: '/orders/:id(.:format)' }]), { added: [], removed: [] });
});

test('a bullet that is not an HTTP method is not a route', () => {
  assert.throws(() => parseFeatures('## o\n- `a` A\n  - see notes'), /cannot read/);
});
