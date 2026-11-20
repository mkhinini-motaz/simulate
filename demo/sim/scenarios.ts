import { readOutbox } from '../../skills/simulate/core/outbox.ts';
import type { Ctx } from '../../skills/simulate/core/runner.ts';

const ALLOWED: Record<string, string[]> = {
  placed: ['accepted', 'rejected', 'cancelled'],
  accepted: ['assigned', 'cancelled'],
  assigned: ['picked_up', 'cancelled'],
  picked_up: ['delivered'],
};
const ITEMS = [{ name: 'pizza', priceCents: 1000, qty: 2 }, { name: 'cola', priceCents: 250, qty: 1 }];

async function place(c: Ctx, tag: string, over: Record<string, unknown> = {}) {
  const body = { cartId: `${tag}-${c.rng.int(1000, 9999)}`, phone: `+1555${c.rng.int(1000000, 9999999)}`, items: ITEMS, ...over };
  const res = await c.http('POST', '/customer/orders', body);
  return { body, id: res.body.id as string, res };
}
const step = (c: Ctx, role: string, id: string, action: string) => c.http('POST', `/${role}/orders/${id}/${action}`);
const cancel = (c: Ctx, id: string) => step(c, 'customer', id, 'cancel');
const view = async (c: Ctx, role: string, id: string) => (await c.http('GET', `/${role}/orders/${id}`)).body;

export const scenarios: Record<string, (c: Ctx) => Promise<void>> = {
  async 'happy-path'(c) {
    const { body, id } = await place(c, 'happy');
    await step(c, 'shop', id, 'accept');
    const offers = (await c.http('GET', '/courier/offers')).body as any[];
    const mine = offers.find((o) => o.orderId === id);
    c.checker.expect('no-phone-to-courier', !JSON.stringify(mine ?? {}).includes(body.phone), `courier offer ${id}`, `offer shows the customer phone: ${JSON.stringify(mine)}`);
    await c.http('POST', `/courier/offers/${id}/accept`);
    await step(c, 'courier', id, 'pickup');
    const late = await cancel(c, id);
    c.checker.expect('no-cancel-after-pickup', late.status === 409, `order ${id}`, `cancel after pickup returned ${late.status}`);
    await step(c, 'courier', id, 'deliver');
    const v = await view(c, 'customer', id);
    c.checker.transitions(id, v.history, ALLOWED, 'legal-transitions');
    const sms = readOutbox(c.outboxPath).filter((m) => m.to === body.phone);
    c.checker.expect('legal-transitions', v.status === 'delivered', `order ${id}`, `ended as ${v.status}`);
    c.checker.expect('total-matches-items', v.totalCents === 2250, `order ${id}`, `total ${v.totalCents}, items add up to 2250`);
    const said = (word: string) => sms.some((m) => m.body.includes(word));
    c.checker.expect('sms-on-accept-and-delivery', said('accepted') && said('delivered'), `order ${id}`, 'customer was not told about acceptance and delivery');
  },

  async 'double-checkout'(c) {
    const { body } = await place(c, 'twin');
    const [a, b] = await Promise.all([c.http('POST', '/customer/orders', body), c.http('POST', '/customer/orders', body)]);
    c.checker.expect('one-order-per-cart', a.body.id === b.body.id, `cart ${body.cartId}`, `two checkouts made orders ${a.body.id} and ${b.body.id}`);
    for (const id of new Set([a.body.id, b.body.id])) await cancel(c, id);
  },

  async 'discount-views'(c) {
    const { id } = await place(c, 'disc', { code: 'SAVE10' });
    await step(c, 'shop', id, 'accept');
    const pick = (v: any) => ({ status: v.status, totalCents: v.totalCents });
    c.checker.agree(`order ${id}`, { customer: pick(await view(c, 'customer', id)), shop: pick(await view(c, 'shop', id)) }, 'views-agree');
    c.checker.expect('total-matches-items', (await view(c, 'customer', id)).totalCents === 2025, `order ${id}`, 'discounted total is not 2025');
    await cancel(c, id);
  },

  async 'cancel-then-deliver'(c) {
    const { id } = await place(c, 'cancel');
    await step(c, 'shop', id, 'accept');
    await c.http('POST', `/courier/offers/${id}/accept`);
    await cancel(c, id);
    await step(c, 'courier', id, 'deliver');
    c.checker.transitions(id, (await view(c, 'customer', id)).history, ALLOWED, 'legal-transitions');
  },

  async 'reject-order'(c) {
    const { body, id } = await place(c, 'reject');
    await step(c, 'shop', id, 'reject');
    const told = readOutbox(c.outboxPath).some((m) => m.to === body.phone && /reject/i.test(m.body));
    c.checker.expect('notify-on-reject', told, `order ${id}`, 'customer was not told the shop rejected the order');
  },

  async 'discount-reuse'(c) {
    const phone = `+1555${c.rng.int(1000000, 9999999)}`;
    const first = await place(c, 'reuse-a', { phone, code: 'SAVE10' });
    const second = await place(c, 'reuse-b', { phone, code: 'SAVE10' });
    c.checker.expect('discount-once-per-customer', second.res.status === 422, phone, `second use of SAVE10 returned ${second.res.status}`);
    for (const o of [first, second]) if (o.id) await cancel(c, o.id);
  },
};
