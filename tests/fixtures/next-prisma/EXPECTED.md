# EXPECTED.md — next-prisma

Ground truth facts for the static-analysis tool to extract from this fixture.

## HTTP routes (Next.js App Router route handlers)

| METHOD | Path | Handler |
|---|---|---|
| GET | /api/orders | src/app/api/orders/route.ts:GET |
| POST | /api/orders | src/app/api/orders/route.ts:POST |
| GET | /api/orders/{id} | src/app/api/orders/[id]/route.ts:GET |
| PATCH | /api/orders/{id} | src/app/api/orders/[id]/route.ts:PATCH |
| POST | /api/contact | src/app/api/contact/route.ts:POST |
| POST | /api/webhooks/stripe | src/app/api/webhooks/stripe/route.ts:POST |

Total: 6 routes across 4 route files.

## Server actions / RPC procedures

| Name | File:export | Notes |
|---|---|---|
| cancelOrderAction | src/features/orders/actions/cancel-order.ts:cancelOrderAction | file has `'use server'` directive; calls `auth()` then `CancelOrderSchema.parse(input)` then `cancelOrder(orderId)` |

## Frontend call sites

| File:enclosingFunction | Call | Resolves to | Status |
|---|---|---|---|
| src/features/orders/hooks/useOrders.ts:useOrders | `fetch('/api/orders')` | GET /api/orders | MATCHED |
| src/features/orders/hooks/useOrders.ts:useOrder | `fetch(\`/api/orders/${id}\`)` | GET /api/orders/{id} | MATCHED |
| src/features/orders/hooks/useOrders.ts:updateOrderStatus | `fetch(\`/api/orders/${id}\`, { method: 'PATCH' })` | PATCH /api/orders/{id} | MATCHED |
| src/features/orders/hooks/useOrders.ts:removeCartItem | `fetch('/api/cart/items', { method: 'DELETE' })` | DELETE /api/cart/items | UNMATCHED — no route exists at /api/cart/items |
| src/features/orders/components/CancelOrderButton.tsx:handleClick | `cancelOrderAction({ orderId })` | server action cancelOrderAction | MATCHED (RPC, not HTTP) |
| src/features/profile/profile.api.ts:getProfile | `request('/api/profile')` → inside src/lib/api-client.ts:request → `fetch(\`${process.env.NEXT_PUBLIC_API_BASE}${path}\`)` with path literal `/api/profile` | GET /api/profile | UNMATCHED — resolvable literal path via wrapper, but no such route exists |
| src/features/profile/profile.api.ts:getProfileDynamic | `request(buildPath())` → path built by local helper `buildPath()` returning `` `/api/${resource}/${version}` `` | GET (path not staticaly known beyond the wrapper) | UNRESOLVED — path argument is not a string literal/simple param interpolation, it is the return value of a local function call |

Notes:
- `src/lib/api-client.ts:request(path, init)` is a generic fetch wrapper. Its own literal call site is `fetch(\`${process.env.NEXT_PUBLIC_API_BASE}${path}\`, init)`; the HTTP method is whatever `init.method` the caller supplies (defaults to GET when omitted, as in both profile.api.ts call sites).
- Server-rendered pages (`src/app/orders/page.tsx`, `src/app/orders/[id]/page.tsx`) call `listOrders`/`getOrder` directly as in-process function calls (server component → service function), not HTTP fetches. They are not frontend call sites and must not be reported as route calls.

## Unauthenticated mutating routes (intentional)

- `POST /api/contact` (src/app/api/contact/route.ts:POST) — no `auth()` call, writes to the database (`prisma.contactMessage.create`). Intentionally public (contact form).
- `POST /api/webhooks/stripe` (src/app/api/webhooks/stripe/route.ts:POST) — no `auth()` call. Intentionally public (external webhook); relies on the `stripe-signature` header / `STRIPE_WEBHOOK_SECRET` instead of session auth.

All other mutating routes (`POST /api/orders`, `PATCH /api/orders/{id}`) call `auth()` and reject when there is no session user.

## Routes with no schema validation (intentional)

- `PATCH /api/orders/{id}` (src/app/api/orders/[id]/route.ts:PATCH) — reads `await req.json()` and passes the raw body straight to `prisma.order.update({ data: body })` with no zod schema.

All other body-accepting routes validate:
- `POST /api/orders` — `CreateOrderSchema.parse(await req.json())`
- `POST /api/contact` — `ContactSchema.safeParse(body)`

## DB reads / writes per function

| File:function | Access | Model(s) |
|---|---|---|
| src/app/api/orders/route.ts:GET | r | Order |
| src/app/api/orders/route.ts:POST | w | Order, OrderItem |
| src/app/api/orders/[id]/route.ts:GET | r | Order |
| src/app/api/orders/[id]/route.ts:PATCH | w | Order |
| src/app/api/contact/route.ts:POST | w | ContactMessage |
| src/app/api/webhooks/stripe/route.ts:POST | — | none |
| src/features/orders/order.service.ts:listOrders | r | Order |
| src/features/orders/order.service.ts:getOrder | r | Order |
| src/features/orders/order.service.ts:createOrder | w | Order, OrderItem |
| src/features/orders/order.service.ts:cancelOrder | r, w | Order (r via findUnique, w via update) |
| src/features/orders/order.service.ts:formatOrderTotal | — | none (internal helper, no DB access) |
| src/features/orders/actions/cancel-order.ts:cancelOrderAction | — (indirect) | none directly; delegates to order.service.ts:cancelOrder |

Prisma model `Order` maps to database table `orders` (`@@map("orders")` in prisma/schema.prisma). Models `User`, `OrderItem`, `ContactMessage` use their default table names.

## Environment variables

| File | Variable | Client-exposed? |
|---|---|---|
| src/lib/db.ts | DATABASE_URL | No (server-only) |
| src/app/api/webhooks/stripe/route.ts | STRIPE_WEBHOOK_SECRET | No (server-only) |
| src/lib/api-client.ts | NEXT_PUBLIC_API_BASE | Yes (`NEXT_PUBLIC_` prefix, intentionally public) |
| src/features/orders/components/CancelOrderButton.tsx | NEXT_PUBLIC_STRIPE_SECRET_KEY | Yes — **intentionally dangerous**: name suggests a secret key, but the `NEXT_PUBLIC_` prefix means Next.js inlines its value into the client JS bundle, leaking it to the browser. |

prisma/schema.prisma also references `env("DATABASE_URL")` in the `datasource` block (build-time/server config, not a runtime `process.env` read in application code).

## Page → component usage

- `src/app/layout.tsx` (RootLayout) → renders `{children}` (no feature components imported)
- `src/app/orders/page.tsx` (OrdersPage, server component) → `OrderList` (src/features/orders/components/OrderList.tsx) → `OrderCard` (src/features/orders/components/OrderCard.tsx)
- `src/app/orders/[id]/page.tsx` (OrderDetailPage, server component, exports `metadata`) → `OrderCard` (src/features/orders/components/OrderCard.tsx), `CancelOrderButton` (src/features/orders/components/CancelOrderButton.tsx, `'use client'`)

Component tree summary:
```
RootLayout
├─ OrdersPage
│  └─ OrderList
│     └─ OrderCard
└─ OrderDetailPage
   ├─ OrderCard
   └─ CancelOrderButton (client)
```

## Middleware

- `src/middleware.ts` — default export wraps `auth()` from `@/auth`; `export const config = { matcher: ['/orders/:path*'] }`.

## Tests

- `src/features/orders/order.service.test.ts` — vitest unit test for `listOrders`, mocks `@/lib/db`.
