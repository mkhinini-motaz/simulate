// The safety wall. It fails closed: anything it cannot prove safe is refused.
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type Verdict = { ok: boolean; reasons: string[] };

// HOME is not kept: it holds ~/.aws, ~/.netrc and the like. The runner gives the app a fresh one in the run folder.
// A plan that needs the real one (version-manager shims) lists HOME in `allow`.
const KEEP = ['PATH', 'TMPDIR', 'LANG'];

// Like `env -i`: nothing from the developer's shell gets in unless listed.
export function buildEnv(opts: {
  allow: string[];
  fakes: Record<string, string>;
  base?: Record<string, string | undefined>;
}): Record<string, string> {
  const base = opts.base ?? process.env;
  const env: Record<string, string> = {};
  for (const name of [...KEEP, ...opts.allow]) {
    const value = base[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...opts.fakes };
}

const ENV_NAMES = ['NODE_ENV', 'APP_ENV', 'RAILS_ENV', 'DJANGO_ENV', 'FLASK_ENV', 'ENVIRONMENT', 'ENV', 'RACK_ENV', 'MIX_ENV', 'ASPNETCORE_ENVIRONMENT', 'GO_ENV'];

const SECRETS: [string, RegExp][] = [
  ['Stripe live secret key', /sk_live_/],
  ['Stripe live restricted key', /rk_live_/],
  ['Stripe live publishable key', /pk_live_/],
  ['AWS access key id', /AKIA[0-9A-Z]{16}/],
  ['Slack token', /xox[baprs]-/],
  ['GitHub token', /gh[pos]_|github_pat_/],
  ['SendGrid key', /SG\.[\w-]{16,}/],
  ['Google API key', /AIza[\w-]{35}/],
  ['private key', /-----BEGIN .*PRIVATE KEY-----/],
];

const LOOPBACK = ['localhost', '127.0.0.1', '::1', '[::1]'];
const BAD_WORD = /(^|[_.-])(prod|production|live|test|testing)([_.-]|$)/i;

// "shop_sim", a URL like mysql://u:p@localhost/shop_sim, a SQLite file path, or sqlite:/file: URL.
function dbOf(value: string): { name: string; hosts: string[] } {
  const bare = (p: string) => {
    try { p = decodeURIComponent(p); } catch { /* keep the raw text; the name check judges it */ }
    return p.split('/').pop()!.replace(/\.(sqlite3?|db)$/, '');
  };
  if (!value.includes(':') || /^[a-z]:[\\/]/i.test(value)) return { name: bare(value), hosts: [] };
  try {
    const u = new URL(value);
    if (u.protocol === 'sqlite:' || u.protocol === 'file:') return { name: bare(u.pathname), hosts: [] };
    // libpq lets `?host=` override the authority, so it is a host to check too.
    const hosts = [u.hostname, u.searchParams.get('host') ?? ''].filter(Boolean).map((h) => h.toLowerCase());
    return { name: bare(u.pathname.replace(/^\/+/, '').split('/')[0]), hosts };
  } catch {
    return { name: value, hosts: [] };
  }
}

// Separate host variables used instead of (or beside) a URL.
const HOST_VARS = ['DB_HOST', 'DATABASE_HOST', 'PGHOST', 'MYSQL_HOST'];

export function checkEnv(
  env: Record<string, string | undefined>,
  opts: { dbVar: string; forbiddenHosts?: string[]; dbHosts?: string[] },
): Verdict {
  const reasons: string[] = [];
  const raw = env[opts.dbVar];
  if (!raw) {
    reasons.push(`${opts.dbVar} is missing: the database name must be set and end in _sim`);
  } else {
    const { name, hosts } = dbOf(raw);
    if (!name.endsWith('_sim')) reasons.push(`database name "${name}" (${opts.dbVar}) does not end in _sim`);
    const bad = name.match(BAD_WORD)?.[2].toLowerCase();
    if (bad) reasons.push(`database name "${name}" contains "${bad}"`);
    for (const v of HOST_VARS) if (env[v]) hosts.push(env[v]!.trim().toLowerCase());
    const listed = (opts.dbHosts ?? []).map((h) => h.toLowerCase());
    for (const host of hosts) {
      const hostBad = host.match(BAD_WORD)?.[2].toLowerCase();
      if (hostBad) reasons.push(`database host "${host}" contains "${hostBad}"`);
      if (!LOOPBACK.includes(host) && !listed.includes(host)) {
        reasons.push(`database host "${host}" is not local; list it in dbHosts only if it is the copy's own server`);
      }
    }
  }
  for (const name of ENV_NAMES) {
    const v = env[name]?.trim().toLowerCase();
    if (v === 'production' || v === 'prod') reasons.push(`${name}=${env[name]} is a production setting`);
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    for (const [label, re] of SECRETS) {
      if (re.test(value)) reasons.push(`${key} holds a live secret (${label})`);
    }
    for (const host of opts.forbiddenHosts ?? []) {
      if (host && value.toLowerCase().includes(host.toLowerCase())) reasons.push(`${key} points at forbidden host ${host}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function isRealEnvFile(name: string): boolean {
  if (name === '.env.example' || name === '.env.sim') return false;
  return name === '.env' || name.startsWith('.env.');
}

// A copy of the project must not carry real secrets. Walks every folder except node_modules, vendor and .git*.
// lstat: a symlink is not followed, so a broken one cannot throw.
export function checkCopy(dir: string): Verdict {
  const reasons: string[] = [];
  if (!existsSync(dir)) return { ok: false, reasons: [`copy directory ${dir} does not exist`] };
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const path = join(d, entry);
      if (isRealEnvFile(entry)) reasons.push(`${path} is a real env file; remove it from the copy`);
      if (entry === 'node_modules' || entry === 'vendor' || entry.startsWith('.git')) continue;
      if (lstatSync(path).isDirectory()) walk(path);
    }
  };
  walk(dir);
  return { ok: reasons.length === 0, reasons };
}

export function assertSafe(...verdicts: Verdict[]): void {
  const reasons = verdicts.flatMap((v) => v.reasons);
  if (reasons.length) throw new Error(`simulate refused to start:\n- ${reasons.join('\n- ')}`);
}
