// Starts the demo app as a child process with exactly the env the runner gives it.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'server.ts');

function freePort(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => ok(port));
    });
  });
}

export async function startDemo(env: Record<string, string>) {
  const port = await freePort();
  const dbDir = mkdtempSync(join(tmpdir(), 'demo-db-'));
  const child = spawn(process.execPath, [APP], {
    env: { ...env, PORT: String(port), DB_DIR: dbDir },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const stop = () =>
    new Promise<void>((ok) => {
      const done = () => { rmSync(dbDir, { recursive: true, force: true }); ok(); };
      if (child.exitCode !== null) return done();
      child.once('exit', done);
      child.kill('SIGTERM');
    });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('demo app exited during start');
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return { baseUrl, stop };
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  await stop();
  throw new Error('demo app did not become ready');
}
