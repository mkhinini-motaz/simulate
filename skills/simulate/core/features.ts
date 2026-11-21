// sim/FEATURES.md lists every feature the product has, grouped by area, with the routes that reach it:
// ## area
// - `feature-id` What it does (source: where it was found)
//   - POST /orders
//   - GET /orders/:id
// - `nightly-report` A scheduled job mails the daily report (source: app/Console/Kernel.php:40)
//   - OUTBOX mail          seen when the outbox holds a message on that channel
//   - EVENT report-sent    seen when a scenario logs ctx.event({ type: 'report-sent' })
// - `feature-id` skip: why no scenario covers it (source: developer, 2026-11-20)
// A feature with no route and no evidence line is "not measured".

export type Route = { method: string; path: string };
export type Evidence = { kind: 'OUTBOX' | 'EVENT'; name: string };
export type Feature = { id: string; area: string; text: string; skip?: string; routes: Route[]; evidence: Evidence[] };
export type Seen = { outbox: string[]; events: string[] };
export type Coverage = {
  features: { total: number; exercised: number; skipped: number; notExercised: string[]; notMeasured: string[] };
  routes: { total: number; called: number; skipped: number; neverCalled: string[] };
  unlisted: string[];
};

const FEATURE = /^- `([a-z0-9-]+)` (.+)$/;
// A path may lack the leading slash (Laravel), end in `(.:format)` (Rails), and a method may be `GET|HEAD`.
const ROUTE = /^\s+- ((?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|ANY)(?:\|(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|ANY))*) (\S+)\s*$/i;
const EVIDENCE = /^\s+- (OUTBOX|EVENT) (\S+)\s*$/;

export function parseFeatures(markdown: string): Feature[] {
  let n = 0;
  const out: Feature[] = [];
  let area = 'general';
  for (const line of markdown.split(/\r?\n/)) {
    n++;
    if (line.startsWith('## ')) area = line.slice(3).trim();
    const f = line.match(FEATURE);
    if (f) {
      const skip = f[2].match(/^skip: (.+)$/)?.[1];
      out.push({ id: f[1], area, text: f[2], ...(skip ? { skip } : {}), routes: [], evidence: [] });
      continue;
    }
    const e = line.match(EVIDENCE);
    if (e && out.length) {
      out[out.length - 1].evidence.push({ kind: e[1] as Evidence['kind'], name: e[2] });
      continue;
    }
    const r = line.match(ROUTE);
    if (r && out.length) {
      const path = '/' + r[2].replace(/\(\.:format\)$/, '').replace(/^\/+/, '');
      for (const method of methods(r[1])) out[out.length - 1].routes.push({ method, path });
    } else if (/^\s+- /.test(line)) throw new Error(`FEATURES.md line ${n}: cannot read "${line.trim()}"`);
  }
  return out;
}

// Path parameters in any common style: :id, {id}, {id?}, [id], <id>, <int:id>.
const PARAM = /^(:\w+|\{[^}]+\}|\[[^\]]+\]|<[^>]+>)$/;
// A route list may give several methods in one entry ("GET|HEAD").
const methods = (m: string) => m.toUpperCase().split('|');

function matcher(route: Route): (c: Route) => boolean {
  const re = new RegExp(
    '^' + route.path.split('/').map((s) => (PARAM.test(s) ? '[^/]+' : s.replace(/[.*+?^$()|\\]/g, '\\$&'))).join('/') + '/?$',
  );
  return (c) => (route.method === 'ANY' || methods(c.method).includes(route.method)) && re.test(c.path.split('?')[0]);
}

export function coverage(features: Feature[], calls: Route[], seen: Seen = { outbox: [], events: [] }): Coverage {
  const label = (r: Route) => `${r.method} ${r.path}`;
  const all = features.flatMap((f) => f.routes.map((r) => ({ f, r, hit: matcher(r) })));
  const called = new Set(all.filter((x) => calls.some(x.hit)));
  const live = features.filter((f) => !f.skip);
  const measured = (f: Feature) => f.routes.length > 0 || f.evidence.length > 0;
  const reached = (f: Feature) =>
    all.some((x) => x.f === f && called.has(x)) ||
    f.evidence.some((e) => (e.kind === 'OUTBOX' ? seen.outbox : seen.events).includes(e.name));
  return {
    features: {
      total: features.length,
      exercised: live.filter((f) => measured(f) && reached(f)).length,
      skipped: features.length - live.length,
      notExercised: live.filter((f) => measured(f) && !reached(f)).map((f) => f.id),
      notMeasured: live.filter((f) => !measured(f)).map((f) => f.id),
    },
    routes: {
      total: all.length,
      called: all.filter((x) => called.has(x)).length,
      skipped: all.filter((x) => x.f.skip).length,
      neverCalled: all.filter((x) => !x.f.skip && !called.has(x)).map((x) => `${label(x.r)} (${x.f.id})`),
    },
    unlisted: [...new Set(calls.filter((c) => !all.some((x) => x.hit(c))).map((c) => `${c.method.toUpperCase()} ${c.path.split('?')[0]}`))],
  };
}

// Compares FEATURES.md with the framework's route list taken again after new code: routes new since the
// inventory, and routes it lists that no longer exist. Parameters compare by position, not by name, and a
// leading slash is optional, so `api/orders/{order}` equals `/api/orders/:id`.
// `added` returns the list's own entries, with any extra fields (a controller name), so the caller can open the code.
export function inventoryDiff<T extends Route>(features: Feature[], list: T[]): { added: T[]; removed: string[] } {
  const shape = (path: string) =>
    ('/' + path.split('?')[0].replace(/\(\.:format\)$/, '')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1').split('/').map((s) => (PARAM.test(s) ? ':' : s)).join('/');
  const listed = new Map<string, string[]>();
  for (const f of features) for (const r of f.routes) listed.set(shape(r.path), [...(listed.get(shape(r.path)) ?? []), r.method]);
  const known = (m: string, p: string) => (listed.get(p) ?? []).some((x) => x === 'ANY' || x === m);
  const added = list.filter((r) => !methods(r.method).some((m) => known(m, shape(r.path))));
  const removed = features.flatMap((f) =>
    f.routes
      .filter((r) => !list.some((l) => shape(l.path) === shape(r.path) && (r.method === 'ANY' || methods(l.method).includes(r.method))))
      .map((r) => `${r.method} ${r.path} (${f.id})`),
  );
  return { added, removed };
}

export function coverageLine(c: Coverage): string {
  const f = c.features;
  return `Coverage: features exercised ${f.exercised} of ${f.total} · skipped: ${f.skipped} · not exercised: ${f.notExercised.length} · not measured: ${f.notMeasured.length} · routes called ${c.routes.called} of ${c.routes.total}`;
}
