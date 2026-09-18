# Example: notes in, codemap out

## What the AI writes (through `wd note set`)

```
node .claude/web-dev/wd.mjs note set <<'EOF'
{"key":"src/features/orders/order.service.ts","role":"order lifecycle and status transitions","sys":"orders","crit":"K1"}
{"key":"src/features/orders/order.service.ts#cancel","note":"buyer-only cancel before shipping; refunds via payments once; throws Forbidden, Conflict"}
{"key":"src/features/orders/order.service.ts#getOrder","note":"loads order with items for its buyer or seller; null when not visible"}
{"key":"src/features/orders/order.service.ts#toStatusView","note":"-"}
EOF
```

`wd` stamps each symbol's body hash. The notes file is never opened to write this.

## What is committed (`.claude/web-dev/notes/server.md`, sorted)

```
src/features/orders/order.service.ts | role: order lifecycle and status transitions | sys: orders | crit: K1
src/features/orders/order.service.ts#cancel | buyer-only cancel before shipping; refunds via payments once; throws Forbidden, Conflict | h:4be1a09c
src/features/orders/order.service.ts#getOrder | loads order with items for its buyer or seller; null when not visible | h:0d77e2f1
src/features/orders/order.service.ts#toStatusView | - | h:9a13c5b0
```

## What the AI reads (`.claude/web-dev/maps/codemap-server.md`, rendered, gitignored)

```
<!-- stamp: 3f2c9ab 2026-09-14T12:41:07Z status: OK -->
## src/features/orders/order.service.ts | K1 | sys: orders | role: order lifecycle and status transitions
imports: src/lib/db.ts, src/features/payments/payments.service.ts, src/features/notifications/notify.ts | used-by: src/features/orders/actions/cancel-order.ts, src/app/orders/[id]/page.tsx
- cancel(orderId: string, actor: SessionUser, reason?: CancelReason): Promise<OrderStatusView> | L18-57 | buyer-only cancel before shipping; refunds via payments once; throws Forbidden, Conflict | db: r orders, w orders | calls: payments.refundOrder, notify.orderCancelled, toStatusView
- getOrder(orderId: string, actor: SessionUser): Promise<OrderWithItems | null> | L59-74 | loads order with items for its buyer or seller; null when not visible | db: r orders, r order_items | calls: -
- toStatusView(order: Order): OrderStatusView | L76-80 | - | db: - | calls: -
```

## Markers

A single edit to `getOrder`'s body produces:

```
- STALE getOrder(orderId: string, actor: SessionUser): Promise<OrderWithItems | null> | L59-77 | loads order with items for its buyer or seller; null when not visible | db: r orders, r order_items, r users | calls: -
```

- The post-write hook reports `notes owed: src/features/orders/order.service.ts#getOrder (STALE)`.
- Re-writing the note with `wd note set` clears the marker.
- Running Prettier over the whole file changes no hash, because hashes ignore whitespace and comments.

| Marker | Meaning | Clears when |
|---|---|---|
| `MISSING` | symbol has no note | a note is written |
| `STALE` | normalized body changed after the note | the note is re-written (even unchanged, to confirm it) |
| `MOVED` | a note followed the symbol by body hash after a rename or file move | `wd note set` confirms it at the new key |
| `ORPHAN` | the note's symbol no longer exists | `wd note set` with `{"key":"…","delete":true}`, or the symbol returns |

Note rules: at most 20 words, what it does, the invariant it keeps, how it fails. No repeat of the signature. `-` is allowed only for internal helpers of 5 lines or fewer.
