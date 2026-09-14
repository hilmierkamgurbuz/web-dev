# Example: a postflight that closes

```markdown
# Postflight: Buyer order cancellation

- [Y] Brief honored — only manifest paths were written; every acceptance criterion is met (evidence below)
- [Y] Located, not scanned — locate stopped at step 3; delegated searches stopped at step 4
- [Y] Questions closed — no [OPEN] remains; durable answers promoted: R-011, D-031
- [Y] Security — touched files scan clean; exceptions used: -; logic risks from the brief handled: buyerId from session in order.service.cancel, refund idempotency key = order id, amount from DB, rate limit on action
- [Y] Tests — `wd verify` → `verify: typecheck ok · lint ok · test ok (148 passed) · build ok`
- [Y] Responsive — `wd responsive` → `responsive: 3 viewports × 1 path · 0 findings`
- [Y] Maps — `wd note missing` → `0 missing`; `wd check` → `0 error(s), 1 warning(s)`
- [Y] Review — web-dev-reviewer → `VERDICT: PASS`
- [Y] Git — branch `feat/buyer-order-cancellation`, pushed, PR `https://github.com/acme/market/pull/212`
- [Y] Clean code — no comments added, no dead code, no debug output, no TODO left

## Acceptance evidence
- Cancel button visibility by status — order.service.test.ts "exposes cancel only before shipping"; screenshot shots/orders-id-360.png
- One refund on retry — order.service.test.ts "refund is idempotent by order id"
- 403 / 409 — order.service.test.ts "rejects foreign buyer", "rejects shipped order"
- Emails — order.service.test.ts "sends buyer and seller notifications"
- Viewports — wd responsive report, 0 findings

## Follow-ups
- Seller-initiated cancellation (out of scope, proposed as next task)

The one warning from wd check: blueprint lists route /seller/orders not built yet (INFO-level plan item carried from bootstrap).
```

Final message to the user, in the user's language:

```
Görev kapandı — PR: https://github.com/acme/market/pull/212
✓ Alıcı, kargolanana kadar siparişini iptal edebiliyor
✓ Tek ve otomatik tam iade (tekrarlanan istekte ikinci iade yok)
✓ Yetkisiz/kargolanmış siparişte 403/409
✓ Alıcı ve satıcıya e-posta
✓ 360/768/1440 px doğrulandı
Sonraki göreve geçmeden önce /clear çalıştırmanı öneririm; tüm durum dosyalarda kayıtlı.
```
