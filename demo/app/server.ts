// A tiny marketplace API. Planted bugs are on unless DEMO_FIXED=1 (see ../PLANTED.md).
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendSms } from './sms.ts';

const FIXED = process.env.DEMO_FIXED === '1';
const DB_NAME = process.env.DB_NAME;
if (!DB_NAME) throw new Error('DB_NAME is required');
const dbFile = join(process.env.DB_DIR ?? tmpdir(), DB_NAME);

type Item = { name: string; priceCents: number; qty: number };
type Order = {
  id: string; cartId: string; phone: string; items: Item[]; code?: string;
  subtotalCents: number; totalCents: number; status: string; history: string[];
  dispatch: { state: string; updatedAt: number };
};
const orders = new Map<string, Order>();
let seq = 0;
const save = () => writeFileSync(dbFile, JSON.stringify([...orders.values()]));

function move(o: Order, status: string, dispatch?: string) {
  o.status = status;
  o.history.push(status);
  if (dispatch) o.dispatch = { state: dispatch, updatedAt: Date.now() };
  save();
}

const customerView = (o: Order) => ({ id: o.id, status: o.status, totalCents: o.totalCents, items: o.items, history: o.history });
// Planted bug 3: with a code, the shop sees the total before the discount.
const shopView = (o: Order) => ({ ...customerView(o), totalCents: !FIXED && o.code ? o.subtotalCents : o.totalCents });

function remind(o: Order) {
  setTimeout(() => {
    const body = `Your order ${o.id} is being prepared`;
    if (FIXED) sendSms(o.phone, body).catch(() => {});
    // Planted bug 5: this reminder ignores OUTBOX_PATH and always goes to the network.
    else fetch('https://sms.example.invalid/send', { method: 'POST', body }).catch(() => {});
  }, 150);
}

type Reply = [number, unknown];
const NO: Reply = [404, { error: 'not found' }];
const conflict = (o: Order, action: string): Reply => [409, { error: `cannot ${action} an order that is ${o.status}` }];

function place(b: any): Reply {
  if (!b?.cartId || !b.phone || !Array.isArray(b.items) || !b.items.length) return [400, { error: 'cartId, phone and items are required' }];
  // Planted bug 1: without this check two checkouts of one cart make two orders.
  const twin = FIXED ? [...orders.values()].find((o) => o.cartId === b.cartId) : undefined;
  if (twin) return [200, customerView(twin)];
  if (b.code && b.code !== 'SAVE10') return [422, { error: 'unknown code' }];
  const subtotalCents = b.items.reduce((s: number, i: Item) => s + i.priceCents * i.qty, 0);
  const totalCents = b.code ? subtotalCents - Math.floor(subtotalCents / 10) : subtotalCents;
  const o: Order = {
    id: `o${++seq}`, cartId: b.cartId, phone: b.phone, items: b.items, code: b.code, subtotalCents, totalCents,
    status: 'placed', history: ['placed'], dispatch: { state: 'pending', updatedAt: Date.now() },
  };
  orders.set(o.id, o);
  save();
  return [201, customerView(o)];
}

function route(method: string, parts: string[], body: any): Reply {
  const [role, kind, id, action] = parts;
  if (role === 'customer' && kind === 'orders' && !id && method === 'POST') return place(body);
  if (role === 'courier' && kind === 'dispatches') return [200, [...orders.values()].map((o) => ({ id: o.id, ...o.dispatch }))];
  if (role === 'courier' && kind === 'offers' && !id) {
    return [200, [...orders.values()].filter((o) => o.dispatch.state === 'offered').map((o) => ({
      orderId: o.id, pickup: 'shop', totalCents: o.totalCents,
      // Planted bug 2: the offer carries the customer's phone number.
      ...(FIXED ? {} : { customerPhone: o.phone }),
    }))];
  }
  const o = orders.get(id);
  if (!o) return NO;
  if (method === 'GET' && role === 'customer') return [200, customerView(o)];
  if (method === 'GET' && role === 'shop') return [200, shopView(o)];
  if (method !== 'POST') return NO;

  if (role === 'customer' && action === 'cancel') {
    if (!['placed', 'accepted', 'assigned'].includes(o.status)) return conflict(o, 'cancel');
    move(o, 'cancelled', 'closed');
  } else if (role === 'shop' && action === 'accept') {
    if (o.status !== 'placed') return conflict(o, 'accept');
    move(o, 'accepted', 'offered');
    sendSms(o.phone, `Your order ${o.id} was accepted`);
    remind(o);
  } else if (role === 'shop' && action === 'reject') {
    if (o.status !== 'placed') return conflict(o, 'reject');
    // Planted bug 6: a rejected order's dispatch is never closed, so it stays pending.
    move(o, 'rejected', FIXED ? 'closed' : undefined);
  } else if (role === 'courier' && kind === 'offers' && action === 'accept') {
    if (o.dispatch.state !== 'offered' || o.status !== 'accepted') return conflict(o, 'take');
    move(o, 'assigned', 'assigned');
  } else if (role === 'courier' && action === 'pickup') {
    if (o.status !== 'assigned') return conflict(o, 'pick up');
    move(o, 'picked_up', 'picked_up');
  } else if (role === 'courier' && action === 'deliver') {
    // Planted bug 4: a cancelled order may still be marked delivered.
    if (o.status !== 'picked_up' && !(!FIXED && o.status === 'cancelled')) return conflict(o, 'deliver');
    move(o, 'delivered', 'delivered');
    sendSms(o.phone, `Your order ${o.id} was delivered`);
  } else return NO;
  return [200, customerView(o)];
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  let text = '';
  for await (const chunk of req) text += chunk;
  const parts = new URL(req.url ?? '/', 'http://x').pathname.split('/').filter(Boolean);
  let reply: Reply;
  try {
    reply = parts[0] === 'health' ? [200, { ok: true }] : route(req.method ?? 'GET', parts, text ? JSON.parse(text) : undefined);
  } catch (e) {
    reply = [500, { error: String(e) }];
  }
  res.writeHead(reply[0], { 'content-type': 'application/json' });
  res.end(JSON.stringify(reply[1]));
}

createServer(handle).listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
