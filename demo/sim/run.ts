// Generated adapter. In a real project this imports ./core/runner.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeatures } from '../../skills/simulate/core/features.ts';
import { parseRules } from '../../skills/simulate/core/rules.ts';
import { runSim } from '../../skills/simulate/core/runner.ts';
import type { RunOpts } from '../../skills/simulate/core/runner.ts';
import { scenarios } from './scenarios.ts';
import { startDemo } from './start.ts';

const here = dirname(fileURLToPath(import.meta.url));

export function runDemo(o: {
  mode?: RunOpts['mode']; scenario?: string; replayDir?: string; seed?: number;
  fixed?: boolean; fakes?: Record<string, string>; root?: string; start?: RunOpts['start'];
} = {}) {
  const fixed = o.fixed ?? process.env.DEMO_FIXED === '1';
  return runSim({
    root: o.root ?? here,
    mode: o.mode ?? 'every-scenario',
    scenario: o.scenario,
    replayDir: o.replayDir,
    seed: o.seed,
    rules: parseRules(readFileSync(join(here, 'RULES.md'), 'utf8')),
    features: parseFeatures(readFileSync(join(here, 'FEATURES.md'), 'utf8')),
    scenarios,
    start: o.start ?? startDemo,
    envOpts: {
      allow: [],
      fakes: { DB_NAME: 'shop_sim', DEMO_FIXED: fixed ? '1' : '0', ...o.fakes },
      dbVar: 'DB_NAME',
      forbiddenHosts: ['shop.example.com'],
      copyDir: join(here, '..'),
    },
    // Let the app's delayed reminders fire, then look for orders nobody finished.
    async after(c) {
      await new Promise((r) => setTimeout(r, 400));
      const rows = (await c.http('GET', '/courier/dispatches')).body as { id: string; state: string; updatedAt: number }[];
      c.checker.stuck(rows, ['delivered', 'closed'], 100, Date.now(), 'no-stuck-dispatch');
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode = 'every-scenario', arg] = process.argv.slice(2);
  const { results, dir } = await runDemo({
    mode: mode as RunOpts['mode'],
    scenario: mode === 'scenario' ? arg : undefined,
    replayDir: mode === 'replay' ? arg : undefined,
  });
  console.log(`run dir: ${dir}`);
  console.log(readFileSync(join(dir, 'summary.md'), 'utf8').split('\n')[0]);
  process.exitCode = results.failures.length ? 1 : 0;
}
