// A local proxy that refuses everything and records who the app tried to reach.
// Limit: an app that ignores HTTP_PROXY / HTTPS_PROXY is not caught here. Node's
// own fetch needs NODE_USE_ENV_PROXY=1 (the runner sets it). The strong wall is
// one container holding the whole simulator (runner, copy, database) with `--network none`; this trap only makes leaks visible.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Socket } from 'node:net';

export type EgressAttempt = { host: string; at: string };

function hostOf(target: string | undefined, fallback: string | undefined): string {
  const raw = target ?? fallback ?? 'unknown';
  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`).hostname;
  } catch {
    return raw;
  }
}

export async function startEgressTrap() {
  const seen: EgressAttempt[] = [];
  const sockets = new Set<Socket>();
  const record = (host: string) => seen.push({ host, at: new Date().toISOString() });

  const server = createServer((req, res) => {
    record(hostOf(req.url, req.headers.host));
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('egress blocked by simulate\n');
  });
  // HTTPS goes through CONNECT: req.url is "host:port".
  server.on('connect', (req, socket) => {
    record(hostOf(req.url, undefined));
    socket.end('HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\n\r\n');
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    attempts: () => [...seen],
    close: () =>
      new Promise<void>((ok) => {
        for (const s of sockets) s.destroy();
        server.close(() => ok());
      }),
  };
}
