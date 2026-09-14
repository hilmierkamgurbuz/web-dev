# Example: an approved brief

Project: marketplace app (Next.js App Router, Prisma, Postgres, Auth.js, Tailwind, Vitest, Playwright). User language: Turkish.

```markdown
# Brief: Buyer order cancellation

## Request (verbatim)
> alıcılar siparişlerini iptal edebilsin, parası da geri yatsın

## Understanding
- Goal: A buyer cancels their own order before it ships and gets an automatic full refund.
- In scope: cancel button on order detail, cancel endpoint, refund through Stripe, status change, email to buyer and seller.
- Out of scope: partial refunds, seller-initiated cancellation, admin panel.
- Located: step 3 (apimap) · feature: orders
- Attachment point: src/features/orders/order.service.ts (owner of order status)

## Decisions
- Q: Who may cancel and until when? → A: buyer, until shipped · by: user · → durable R-011
- Q: Refund type? → A: automatic full refund to original payment method · by: user · → durable D-031
- Q: Confirmation step? → A: modal with reason select (optional) · by: user
- Q: Email content language? → A: buyer's locale, fallback tr · by: recorded R-006

## Acceptance
- [ ] A buyer sees "Siparişi iptal et" on their order detail while status is `paid` or `preparing`, and not afterwards.
- [ ] Confirming cancels the order, triggers one Stripe refund, and shows the updated status without reload.
- [ ] A second click or retry does not create a second refund.
- [ ] Another user's order cannot be cancelled (403), and a shipped order returns 409.
- [ ] Buyer and seller receive an email.
- [ ] The flow works at 360, 768 and 1440 px.

## Design
- Data source: order status: server state · authority: order.service · read in: order detail server component · invalidated by: cancelOrder action (revalidatePath)
- Render boundary: /orders/[id]: dynamic · client components: CancelOrderButton, CancelDialog · data: server component · cache: no-store (per user)
- API contract: server action cancelOrder · in: CancelOrderInput(zod: orderId uuid, reason enum?) · out: OrderStatusView · auth: session user = order.buyerId · errors: 401, 403, 404, 409 · idempotent: yes (refund idempotency key = order id) · callers updated: CancelOrderButton
- Ownership: order status → order.service.cancel only; refunds → payments.service.refundOrder only
- Cost: per interaction ×1; one DB transaction + one Stripe call; within budget

## Risk
- Security: authz at order.service by buyerId from session (never from input); CSRF covered by server action origin check; refund amount read from DB, not client; Stripe errors not leaked; rate limit 5/min per user on cancelOrder
- Security exceptions: -
- Migrations: add column orders.cancel_reason (nullable text), additive only
- Dependencies: -
- Assumptions: Stripe payment intent id is stored on every paid order (verified in datamap: orders.payment_intent_id not null) 

## Verification
- Tests: order.service.test.ts (transitions, 403/409, idempotency), cancel-order.spec.ts (e2e buyer flow)
- Responsive: /orders/[id] with seeded order
- Map repairs: STALE order.service.ts#getOrder

## Git
- Branch: feat/buyer-order-cancellation

## Durable
- R-011
- D-031

## Manifest
- prisma/schema.prisma
- prisma/migrations/20260914120000_order_cancel_reason/migration.sql
- src/features/orders/order.service.ts
- src/features/orders/order.service.test.ts
- src/features/orders/actions/cancel-order.ts
- src/features/orders/components/CancelOrderButton.tsx
- src/features/orders/components/CancelDialog.tsx
- src/features/payments/payments.service.ts
- src/features/notifications/emails/order-cancelled.tsx
- e2e/cancel-order.spec.ts
- generated: node_modules/.prisma/**
```
