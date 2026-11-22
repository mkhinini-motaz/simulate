import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSafe, buildEnv, checkCopy, checkEnv } from '../guard.ts';

const good = { DB_NAME: 'shop_sim' };
const check = (env: Record<string, string>, forbiddenHosts?: string[]) => checkEnv(env, { dbVar: 'DB_NAME', forbiddenHosts });
const refuses = (env: Record<string, string>, word: string, hosts?: string[]) => {
  const v = check(env, hosts);
  assert.equal(v.ok, false);
  assert.match(v.reasons.join('\n'), new RegExp(word));
};

test('a clean sim env passes', () => assert.deepEqual(check(good), { ok: true, reasons: [] }));
test('missing db name is refused', () => refuses({}, 'missing'));
test('db name without _sim is refused', () => refuses({ DB_NAME: 'shop' }, '_sim'));
for (const word of ['prod', 'live', 'test']) {
  test(`db name containing ${word} is refused`, () => refuses({ DB_NAME: `my_${word.toUpperCase()}_sim` }, word));
}
test('whole words only: delivery_sim and products_sim pass, a_live_sim does not', () => {
  for (const ok of ['delivery_sim', 'products_sim', 'latest_sim']) assert.ok(check({ DB_NAME: ok }).ok, ok);
  refuses({ DB_NAME: 'a-live-b_sim' }, 'live');
});
test('SQLite files and URLs are read by their file name', () => {
  for (const v of ['database/shop_sim.sqlite', 'shop_sim.db', 'sqlite:///var/db/shop_sim.db', 'file:./data/shop_sim.sqlite3']) {
    assert.ok(check({ DB_NAME: v }).ok, v);
  }
  refuses({ DB_NAME: 'database/shop.sqlite' }, '_sim');
  refuses({ DB_NAME: 'sqlite:///var/db/prod_sim.db' }, 'prod');
});
test('a database host that is not local is refused unless listed; prod hosts always', () => {
  const url = (h: string) => `postgres://u:p@${h}:5432/shop_sim`;
  assert.ok(checkEnv({ URL: url('localhost') }, { dbVar: 'URL' }).ok);
  assert.ok(checkEnv({ URL: url('127.0.0.1') }, { dbVar: 'URL' }).ok);
  assert.equal(checkEnv({ URL: url('db.internal') }, { dbVar: 'URL' }).ok, false);
  assert.ok(checkEnv({ URL: url('db') }, { dbVar: 'URL', dbHosts: ['db'] }).ok);
  assert.equal(checkEnv({ URL: url('prod-db') }, { dbVar: 'URL', dbHosts: ['prod-db'] }).ok, false);
});
test('db name inside a URL is parsed', () => {
  assert.ok(checkEnv({ URL: 'mysql://u:p@localhost/shop_sim' }, { dbVar: 'URL' }).ok);
  assert.equal(checkEnv({ URL: 'mysql://u:p@localhost/shop' }, { dbVar: 'URL' }).ok, false);
});
for (const name of ['NODE_ENV', 'APP_ENV', 'RAILS_ENV', 'DJANGO_ENV', 'FLASK_ENV', 'ENVIRONMENT', 'ENV', 'RACK_ENV', 'MIX_ENV', 'ASPNETCORE_ENVIRONMENT', 'GO_ENV']) {
  for (const value of ['production', 'prod']) {
    test(`${name}=${value} is refused`, () => refuses({ ...good, [name]: value }, name));
  }
}
test('staging env names are fine', () => assert.ok(check({ ...good, NODE_ENV: 'development' }).ok));
// Fixtures are assembled from pieces so secret scanners (gitleaks, GitHub push protection) do not flag this file.
const live = 'li' + 've_';
const secrets: Record<string, string> = {
  'sk_live_': 'sk_' + live + 'abc123',
  'rk_live_': 'rk_' + live + 'abc123',
  'pk_live_': 'pk_' + live + 'abc123',
  AKIA: 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
  'xox': 'xo' + 'xb-1234-abcd',
  ghp_: 'gh' + 'p_abcdef',
  gho_: 'gh' + 'o_abcdef',
  github_pat_: 'github' + '_pat_abcdef',
  SendGrid: 'S' + 'G.abcdefghijklmnop.qrst',
  AIza: 'AI' + 'za' + 'A'.repeat(35),
  PRIVATE: '-----BEGIN RSA ' + 'PRIVATE KEY-----',
};
for (const [label, value] of Object.entries(secrets)) {
  test(`live secret pattern ${label} is refused`, () => refuses({ ...good, SOME_KEY: value }, 'SOME_KEY'));
}
test('forbidden host in any value is refused', () => {
  refuses({ ...good, API: 'https://API.RealShop.com/v1' }, 'realshop.com', ['realshop.com']);
});

test('buildEnv drops the real HOME unless HOME is allowed', () => {
  const base = { PATH: '/bin', HOME: '/h' };
  assert.deepEqual(buildEnv({ allow: [], fakes: {}, base }), { PATH: '/bin' });
  assert.deepEqual(buildEnv({ allow: ['HOME'], fakes: {}, base }), { PATH: '/bin', HOME: '/h' });
});

test('buildEnv keeps only the base three, allowed names and fakes', () => {
  const env = buildEnv({
    allow: ['KEEP_ME'],
    fakes: { DB_NAME: 'x_sim', HOME: '/fake' },
    base: { PATH: '/bin', HOME: '/h', TMPDIR: '/t', LANG: 'C', KEEP_ME: '1', AWS_SECRET: 'no', NODE_ENV: 'production' },
  });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/fake', TMPDIR: '/t', LANG: 'C', KEEP_ME: '1', DB_NAME: 'x_sim' });
});

test('checkCopy refuses .env and .env.* at top level and one level down', () => {
  const dir = mkdtempSync(join(tmpdir(), 'copy-'));
  writeFileSync(join(dir, '.env.example'), '');
  writeFileSync(join(dir, '.env.sim'), '');
  assert.ok(checkCopy(dir).ok);
  mkdirSync(join(dir, 'api'));
  writeFileSync(join(dir, 'api', '.env.production'), '');
  assert.match(checkCopy(dir).reasons.join(), /api.*\.env\.production/);
  writeFileSync(join(dir, '.env'), '');
  assert.equal(checkCopy(dir).reasons.length, 2);
  assert.equal(checkCopy(join(dir, 'nope')).ok, false);
});

test('checkCopy finds a deep .env, skips node_modules and vendor, survives a broken symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'copy-'));
  mkdirSync(join(dir, 'apps/api/config'), { recursive: true });
  mkdirSync(join(dir, 'vendor/x'), { recursive: true });
  writeFileSync(join(dir, 'vendor/x/.env'), '');
  symlinkSync(join(dir, 'nowhere'), join(dir, 'broken'));
  assert.ok(checkCopy(dir).ok);
  writeFileSync(join(dir, 'apps/api/config/.env'), '');
  assert.match(checkCopy(dir).reasons.join(), /apps\/api\/config\/\.env/);
  rmSync(dir, { recursive: true });
});

test('assertSafe lists every reason', () => {
  assert.throws(() => assertSafe(check({}), check({ DB_NAME: 'prod' })), /missing[\s\S]*_sim[\s\S]*prod/);
  assert.doesNotThrow(() => assertSafe(check(good)));
});

test('separate host variables and ?host= are checked like a URL host', () => {
  const ck = (env: Record<string, string>, dbHosts?: string[]) => checkEnv({ DB_NAME: 'shop_sim', ...env }, { dbVar: 'DB_NAME', dbHosts });
  assert.equal(ck({ DB_HOST: 'db.internal' }).ok, false);
  assert.equal(ck({ PGHOST: '10.0.0.5' }).ok, false);
  assert.ok(ck({ DB_HOST: '127.0.0.1' }).ok);
  assert.ok(ck({ DB_HOST: 'DB' }, ['db']).ok);
  const url = (q: string) => ({ URL: `postgres://u:p@localhost/shop_sim${q}` });
  assert.equal(checkEnv(url('?host=other.example'), { dbVar: 'URL' }).ok, false);
  assert.ok(checkEnv(url('?host=localhost'), { dbVar: 'URL' }).ok);
});

test('a malformed % in the name is a refusal, not a throw; dbHosts match any case', () => {
  assert.equal(checkEnv({ DB: 'shop%' }, { dbVar: 'DB' }).ok, false);
  assert.ok(checkEnv({ URL: 'postgres://u:p@DB/shop_sim' }, { dbVar: 'URL', dbHosts: ['DB'] }).ok);
});

test('assertSafe throws on a verdict that is not ok even with no reasons', () => {
  assert.throws(() => assertSafe({ ok: false, reasons: [] }), /simulate refused to start/);
});

test('an empty host variable is refused with a fix', () => {
  const v = checkEnv({ DB_NAME: 'shop_sim', DB_HOST: '' }, { dbVar: 'DB_NAME' });
  assert.equal(v.ok, false);
  assert.match(v.reasons.join('\n'), /DB_HOST is empty[\s\S]*unset it or set an explicit local host/);
});

test('host variables are checked even when the database variable is missing', () => {
  const v = checkEnv({ DB_HOST: 'db.internal' }, { dbVar: 'DB_NAME' });
  assert.match(v.reasons.join('\n'), /missing[\s\S]*db\.internal/);
});

test('a URL with an empty hostname is refused', () => {
  const v = checkEnv({ URL: 'postgres:///x_sim' }, { dbVar: 'URL' });
  assert.equal(v.ok, false);
  assert.match(v.reasons.join('\n'), /no host[\s\S]*explicit local host/);
});

test('checkCopy returns a reason for a file or an unreadable folder instead of throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'copy-'));
  writeFileSync(join(dir, 'afile'), '');
  const v = checkCopy(join(dir, 'afile'));
  assert.equal(v.ok, false);
  assert.match(v.reasons.join('\n'), /cannot read/);
  mkdirSync(join(dir, 'locked'));
  chmodSync(join(dir, 'locked'), 0o000);
  try {
    assert.equal(checkCopy(dir).ok, false);
  } finally {
    chmodSync(join(dir, 'locked'), 0o700);
  }
});

test('a plain name is percent-decoded first, then cut at its last slash', () => {
  assert.deepEqual(checkEnv({ D: 'a%2Fshop' }, { dbVar: 'D' }).reasons, ['database name "shop" (D) does not end in _sim']);
  assert.ok(checkEnv({ D: 'a%2Fshop_sim' }, { dbVar: 'D' }).ok);
});

test('the _sim suffix is case-sensitive', () => {
  assert.deepEqual(checkEnv({ D: 'shop_SIM' }, { dbVar: 'D' }).reasons, ['database name "shop_SIM" (D) does not end in _sim']);
});

test('a value with a colon but no scheme goes through new URL and is refused', () => {
  assert.deepEqual(checkEnv({ D: 'host:5432/x_sim' }, { dbVar: 'D' }).reasons, [
    'database name "5432" (D) does not end in _sim',
    'database URL has no host: set an explicit local host (localhost or 127.0.0.1)',
  ]);
});

test('the private key pattern stays on one line', () => {
  const head = '-----BEGIN RSA ';
  const tail = 'PRIVATE KEY-----';
  assert.deepEqual(check({ ...good, K: `${head}${tail}\nMIIE` }).reasons, ['K holds a live secret (private key)']);
  assert.ok(check({ ...good, K: `${head}\n${tail}` }).ok);
});

test('each secret reason carries its exact label', () => {
  const live = 'li' + 've_';
  const want: [string, string][] = [
    ['sk_' + live + 'abc', 'Stripe live secret key'],
    ['rk_' + live + 'abc', 'Stripe live restricted key'],
    ['pk_' + live + 'abc', 'Stripe live publishable key'],
    ['AK' + 'IA' + 'ABCDEFGHIJKLMNOP', 'AWS access key id'],
    ['xo' + 'xb-1', 'Slack token'],
    ['gh' + 'p_abc', 'GitHub token'],
    ['github' + '_pat_abc', 'GitHub token'],
    ['S' + 'G.abcdefghijklmnop', 'SendGrid key'],
    ['AI' + 'za' + 'A'.repeat(35), 'Google API key'],
    ['-----BEGIN ' + 'PRIVATE KEY-----', 'private key'],
  ];
  for (const [value, label] of want) assert.deepEqual(check({ ...good, K: value }).reasons, [`K holds a live secret (${label})`]);
});
