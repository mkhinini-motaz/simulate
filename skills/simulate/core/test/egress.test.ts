import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { request } from 'node:http';
import { startEgressTrap } from '../egress.ts';

test('records a plain proxied request and a CONNECT, both answered 502', async () => {
  const trap = await startEgressTrap();
  const { port } = new URL(trap.url);

  const plain = await new Promise<number>((ok, bad) => {
    const req = request({ host: '127.0.0.1', port, path: 'http://sms.example.invalid/send', headers: { host: 'sms.example.invalid' } }, (res) => {
      res.resume();
      ok(res.statusCode ?? 0);
    });
    req.on('error', bad);
    req.end();
  });
  assert.equal(plain, 502);

  const connectReply = await new Promise<string>((ok) => {
    const s = connect(Number(port), '127.0.0.1', () => s.write('CONNECT pay.example.invalid:443 HTTP/1.1\r\nhost: pay.example.invalid:443\r\n\r\n'));
    let data = '';
    s.on('data', (d) => (data += d));
    s.on('close', () => ok(data));
  });
  assert.match(connectReply, /^HTTP\/1\.1 502/);

  assert.deepEqual(trap.attempts().map((a) => a.host), ['sms.example.invalid', 'pay.example.invalid']);
  assert.match(trap.attempts()[0].at, /^\d{4}-\d\d-\d\dT/);
  await trap.close();
});
