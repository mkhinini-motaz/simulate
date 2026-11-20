// The app's senders (SMS, email, push, payment, webhook) must append one JSON
// line per message to env.OUTBOX_PATH instead of sending. A product's own outbox may name the
// channel `kind` or `type`; readOutbox copies it into `channel`.
import { existsSync, readFileSync } from 'node:fs';

export type OutboxMessage = { channel: string; to: string; body: string; [k: string]: unknown };

// A line that is not JSON is skipped and passed to onBad, so one bad line cannot sink the run.
export function readOutbox(path: string, onBad: (line: string) => void = () => {}): OutboxMessage[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        const m = JSON.parse(line);
        return [{ ...m, channel: m.channel ?? m.kind ?? m.type ?? 'unknown' } as OutboxMessage];
      } catch {
        onBad(line);
        return [];
      }
    });
}
