import { isDeepStrictEqual } from 'node:util';

export type Rule = { id: string; text: string; status: 'confirmed' | 'observed'; gap?: boolean };
export type Violation = {
  ruleId: string;
  who: string;
  text: string;
  kind: 'failure' | 'observed' | 'gap';
  extra?: Record<string, unknown>;
};

export class Checker {
  rules: Rule[];
  private byId = new Map<string, Rule>();
  private found: Violation[] = [];
  private passed = 0;

  constructor(rules: Rule[]) {
    this.rules = rules;
    for (const r of rules) this.byId.set(r.id, r);
  }

  rule(id: string): Rule {
    const r = this.byId.get(id);
    if (!r) throw new Error(`unknown rule id "${id}"; add it to sim/RULES.md`);
    return r;
  }

  // The one sink. Observed rules and gaps are information, not failures.
  violation(ruleId: string, who: string, text: string, extra?: Record<string, unknown>): void {
    const r = this.rule(ruleId);
    const kind = r.gap ? 'gap' : r.status === 'observed' ? 'observed' : 'failure';
    this.found.push({ ruleId, who, text, kind, ...(extra ? { extra } : {}) });
  }

  expect(ruleId: string, ok: boolean, who: string, text: string): void {
    this.rule(ruleId);
    if (ok) this.passed++;
    else this.violation(ruleId, who, text);
  }

  // An entity not in a terminal state and untouched for longer than settleMs.
  stuck(
    entities: { id: string; state: string; updatedAt: number }[],
    terminal: string[],
    settleMs: number,
    now: number,
    ruleId: string,
  ): void {
    for (const e of entities) {
      const isStuck = !terminal.includes(e.state) && now - e.updatedAt > settleMs;
      this.expect(ruleId, !isStuck, e.id, `stuck in "${e.state}" for ${now - e.updatedAt} ms (terminal: ${terminal.join(', ')})`);
    }
  }

  // Every role's view of the same thing must be deep-equal.
  agree(id: string, views: Record<string, unknown>, ruleId: string): void {
    const names = Object.keys(views);
    const same = names.every((n) => isDeepStrictEqual(views[names[0]], views[n]));
    this.expect(ruleId, same, id, `roles disagree: ${JSON.stringify(views)}`);
  }

  transitions(id: string, states: string[], allowed: Record<string, string[]>, ruleId: string): void {
    for (let i = 1; i < states.length; i++) {
      const [from, to] = [states[i - 1], states[i]];
      if (from === to) continue;
      this.expect(ruleId, (allowed[from] ?? []).includes(to), id, `illegal transition ${from} -> ${to}`);
    }
  }

  results() {
    const of = (kind: Violation['kind']) => this.found.filter((v) => v.kind === kind);
    return { failures: of('failure'), observed: of('observed'), gaps: of('gap'), passes: this.passed };
  }
}
export type Results = ReturnType<Checker['results']>;
