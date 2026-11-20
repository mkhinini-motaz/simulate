import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Checker } from './oracle.ts';
import { coverageLine } from './features.ts';
import type { Coverage } from './features.ts';
import { CORE_VERSION } from './version.ts';

const pad = (n: number) => String(n).padStart(2, '0');

function stamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// Asks git for the commit of the folder the app ran from. Any problem gives "unknown".
export function readCommit(from: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: from, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function startRun(o: { root: string; mode: string; seed: number; scenario?: string; commitFrom?: string; warnings?: string[] }) {
  const started = new Date();
  const base = join(o.root, 'runs', `${stamp(started)}-${o.mode}-${o.seed}`);
  let dir = base;
  for (let n = 2; existsSync(dir); n++) dir = `${base}-${n}`;
  mkdirSync(dir, { recursive: true });
  const eventsPath = join(dir, 'events.jsonl');

  const event = (obj: Record<string, unknown>): void => {
    appendFileSync(eventsPath, JSON.stringify({ at: new Date().toISOString(), ...obj }) + '\n');
  };

  const finish = (checker: Checker, extra: Record<string, unknown> = {}, cov?: Coverage) => {
    const r = checker.results();
    const metrics = {
      mode: o.mode,
      seed: o.seed,
      scenario: o.scenario ?? null,
      commit: readCommit(o.commitFrom ?? o.root),
      coreVersion: CORE_VERSION,
      counts: { failures: r.failures.length, observed: r.observed.length, gaps: r.gaps.length, passes: r.passes },
      durations: { totalMs: Date.now() - started.getTime() },
      egress: [],
      ...extra,
      ...(cov ? { coverage: cov } : {}),
    };
    writeFileSync(join(dir, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
    writeFileSync(join(dir, 'summary.md'), summary(checker, cov, o.warnings));
    return metrics;
  };

  return { dir, event, finish };
}

function summary(checker: Checker, cov?: Coverage, warnings: string[] = []): string {
  const r = checker.results();
  const out = [`Untriaged violations: ${r.failures.length} · known gaps: ${r.gaps.length} · observed-only: ${r.observed.length} · passes: ${r.passes}`];
  if (cov) out.push(coverageLine(cov));
  for (const w of warnings) out.push(`Warning: ${w}`);
  out.push('');
  const section = (title: string, list: typeof r.failures) => {
    const ids = [...new Set(list.map((v) => v.ruleId))];
    for (const id of ids) {
      out.push(`## ${title}: ${id}`, '', checker.rule(id).text, '');
      for (const v of list.filter((x) => x.ruleId === id)) out.push(`- ${v.who}: ${v.text}`);
      out.push('');
    }
  };
  section('FAIL', r.failures);
  section('Known gap', r.gaps);
  section('Observed', r.observed);
  if (cov) {
    const list = (title: string, items: string[]) => {
      if (!items.length) return;
      out.push(`## ${title}`, '', ...items.slice(0, 30).map((x) => `- ${x}`), ...(items.length > 30 ? [`- and ${items.length - 30} more (metrics.json)`] : []), '');
    };
    list('Features not exercised', cov.features.notExercised);
    list('Routes never called', cov.routes.neverCalled);
    list('Features not measured (no route or evidence line)', cov.features.notMeasured);
    list('Called but missing from FEATURES.md', cov.unlisted);
  }
  return out.join('\n');
}
