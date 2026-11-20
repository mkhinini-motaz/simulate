# Planted bugs

Each bug is on unless `DEMO_FIXED=1`. The simulator must report all six, and nothing with `DEMO_FIXED=1`.

| # | Bug | Where | Rule it breaks | Scenario |
| --- | --- | --- | --- | --- |
| 1 | Two checkouts of one cart both create an order (no cart check) | `app/server.ts` `place` | `one-order-per-cart` | double-checkout |
| 2 | The courier's offer includes the customer's phone | `app/server.ts` offers route | `no-phone-to-courier` | happy-path |
| 3 | With a code, the shop's view shows the total before the discount | `app/server.ts` `shopView` | `views-agree` | discount-views |
| 4 | A cancelled order can be marked delivered | `app/server.ts` deliver | `legal-transitions` | cancel-then-deliver |
| 5 | One reminder ignores `OUTBOX_PATH` and calls `fetch` | `app/server.ts` `remind` | `no-egress` | any scenario that accepts an order |
| 6 | A rejected order's dispatch stays `pending` | `app/server.ts` reject | `no-stuck-dispatch` | reject-order, then the after-run check |

Two items are known and stay in both modes: the open gap `discount-once-per-customer` and the observed rule `notify-on-reject` (the app sends no SMS on rejection).
