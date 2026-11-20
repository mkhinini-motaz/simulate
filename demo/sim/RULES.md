# Rules for the demo marketplace

`confirmed` means the developer said so. `observed` means the skill read it in the code or docs and nobody confirmed it: a violation is information, not a failure. `, gap` marks a rule the product knowingly breaks today: a violation is a known gap.

- `no-egress` [confirmed] The app never contacts a host outside the sandbox (source: skill hard rule 2).
- `one-order-per-cart` [confirmed] Two checkouts of the same cart create one order (source: developer, 2026-11-20, once means once).
- `no-phone-to-courier` [confirmed] A courier never sees the customer's phone number (source: developer, 2026-11-20, privacy between users).
- `views-agree` [confirmed] Customer and shop see the same status and the same total for one order (source: developer, 2026-11-20, totals agree).
- `legal-transitions` [confirmed] An order only moves along placed, accepted, assigned, picked_up, delivered, or to rejected or cancelled before pickup (source: demo/app/server.ts:82).
- `no-stuck-dispatch` [confirmed] Every courier dispatch reaches delivered or closed soon after its order ends (source: developer, 2026-11-20, nothing waits forever).
- `no-cancel-after-pickup` [confirmed] A customer cannot cancel once the courier has picked up (source: demo/app/server.ts:83).
- `total-matches-items` [confirmed] The total equals the items, minus 10% with the SAVE10 code (source: developer, 2026-11-20, from demo/app/server.ts:55).
- `sms-on-accept-and-delivery` [confirmed] The customer gets an SMS when the shop accepts and when the order is delivered (source: developer, 2026-11-20).
- `notify-on-reject` [observed] The customer is told when the shop rejects an order (source: demo/app/server.ts:90, not confirmed).
- `discount-once-per-customer` [confirmed, gap] A customer can use SAVE10 only once (source: developer, 2026-11-20, fix planned).
