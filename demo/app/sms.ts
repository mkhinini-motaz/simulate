import { appendFileSync } from 'node:fs';

// With OUTBOX_PATH set (the simulator) nothing is sent: one JSON line is written.
export async function sendSms(to: string, body: string): Promise<void> {
  const outbox = process.env.OUTBOX_PATH;
  if (outbox) {
    appendFileSync(outbox, JSON.stringify({ channel: 'sms', to, body }) + '\n');
    return;
  }
  await fetch('https://sms.example.invalid/send', { method: 'POST', body: JSON.stringify({ to, body }) });
}
