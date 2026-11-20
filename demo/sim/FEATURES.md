# Features

Every route in `demo/app/server.ts`, grouped by area. The runner reports any feature whose routes no scenario called.

## ordering
- `place-order` A customer places an order (source: demo/app/server.ts:67)
  - POST /customer/orders
- `track-order` A customer reads their order (source: demo/app/server.ts:78)
  - GET /customer/orders/:id
- `cancel-order` A customer cancels before pickup (source: demo/app/server.ts:82)
  - POST /customer/orders/:id/cancel

## shop operations
- `shop-view` A shop reads an order (source: demo/app/server.ts:79)
  - GET /shop/orders/:id
- `shop-accept` A shop accepts an order (source: demo/app/server.ts:85)
  - POST /shop/orders/:id/accept
- `shop-reject` A shop rejects an order (source: demo/app/server.ts:90)
  - POST /shop/orders/:id/reject

## dispatch and couriers
- `offers` A courier lists open offers and takes one (source: demo/app/server.ts:69)
  - GET /courier/offers
  - POST /courier/offers/:id/accept
- `deliver` A courier picks up and delivers (source: demo/app/server.ts:97)
  - POST /courier/orders/:id/pickup
  - POST /courier/orders/:id/deliver
- `dispatch-board` The list of every dispatch and its state (source: demo/app/server.ts:68)
  - GET /courier/dispatches

## notifications
- `sms-on-accept` The customer gets an SMS when the shop accepts (source: demo/app/sms.ts); no route of its own
  - OUTBOX sms

## platform
- `health` skip: used by sim/start.ts to wait for the app, not a user feature (source: demo/app/server.ts:115)
  - GET /health
