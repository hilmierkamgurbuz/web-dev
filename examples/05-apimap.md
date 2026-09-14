# Example: apimap.md

```
<!-- stamp: 3f2c9ab 2026-09-14T12:41:07Z status: DEGRADED 1 unmatched, 1 unauthenticated -->
# apimap

## Routes
GET /api/orders | src/app/api/orders/route.ts:GET | auth: auth | in: ListOrdersQuery | out: OrderListView | db: r orders | callers: src/features/orders/hooks/useOrders.ts:useOrders | note: cursor pagination, max 50
GET /api/orders/{} | src/app/api/orders/[id]/route.ts:GET | auth: auth | in: - | out: OrderWithItems | db: r orders, r order_items | callers: src/features/orders/hooks/useOrder.ts:useOrder | note: -
ACTION cancelOrder | src/features/orders/actions/cancel-order.ts:cancelOrder | auth: auth | in: CancelOrderInput | out: OrderStatusView | db: r orders, w orders | callers: src/features/orders/components/CancelOrderButton.tsx:CancelOrderButton | note: idempotent by order id
POST /api/contact | src/app/api/contact/route.ts:POST | auth: NONE | in: ContactSchema | out: - | db: w contact_messages | callers: src/app/contact/ContactForm.tsx:onSubmit | note: -
POST /api/webhooks/stripe | src/app/api/webhooks/stripe/route.ts:POST | auth: signature(stripe.webhooks.constructEvent) | in: raw | out: - | db: w orders, w refunds | callers: - | note: external caller

## Unmatched calls
src/features/cart/hooks/useCart.ts:removeItem → DELETE /api/cart/items/{} (no route)

## Unresolved
src/lib/api-client.ts:request → `${base}${path}` (dynamic path; wrapper depth limit)

## Dead routes
- none

## Unauthenticated mutations
POST /api/contact (declared in D-019: public form, rate limited, captcha)

## Unvalidated input
- none
```

How to read it:
- `{}` is a normalized path parameter. `[id]`, `:id`, `{id}` and `${id}` all normalize to it.
- `ACTION` lines are server actions or RPC procedures, named by export.
- `auth:` shows the first auth marker found on the handler's path (configured in `config.json` `authMarkers`), or `NONE`.
- `Unmatched calls` is an ERROR the task must fix. `Unresolved` is shown so a human or AI can confirm it by reading one place, and it is never guessed.
- A mutation under `Unauthenticated mutations` is an ERROR unless a brief or a decision declares it. The declaration id is shown next to it.
