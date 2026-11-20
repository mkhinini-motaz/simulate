// sim/RULES.md is the source of truth. One rule per line:
// - `rule-id` [confirmed] text (source: where it came from)
// - `rule-id` [observed, gap] text (source: ...)
import type { Rule } from './oracle.ts';

const LINE = /^- `([a-z0-9-]+)` \[(confirmed|observed)(, gap)?\] (.+)$/;

export function parseRules(markdown: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of markdown.split('\n')) {
    const m = LINE.exec(line.trim());
    if (!m && line.trim().startsWith('- `')) throw new Error(`RULES.md: cannot read rule line: ${line.trim()}`);
    if (m) rules.push({ id: m[1], status: m[2] as Rule['status'], text: m[4], ...(m[3] ? { gap: true } : {}) });
  }
  return rules;
}
