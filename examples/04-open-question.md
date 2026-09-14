# Example: a procedure stops with an OPEN QUESTION

Project: marketplace app (Next.js App Router + Prisma). Task: "add order cancellation".

`ownership.md` runs and asks who is allowed to change an order's status to `cancelled`. `product.md` has `R-004 buyers can track orders` but no rule about who may cancel or until when. `decisions.md` has nothing on refunds.

Wrong behavior: assuming "buyers can cancel until shipped" and writing a `PATCH /api/orders/{}` handler.

Correct output:

```
OPEN QUESTION — no code written.

Who may cancel an order, and until when, is not recorded. This decides the API's
authorization rule, the order state machine, and whether a refund flow is part
of this task.
```

The same question is then asked with AskUserQuestion:

```
question: "Bir siparişi kim, hangi aşamaya kadar iptal edebilsin?"
header: "İptal yetkisi"
options:
  - label: "Alıcı, kargolanana kadar (Önerilen)"
    description: "+ yaygın beklenti, destek yükü düşük · − satıcı hazırlığa başlamışsa emek boşa gider"
  - label: "Alıcı ve satıcı, kargolanana kadar"
    description: "+ stok sorunu olan satıcı da iptal edebilir · − satıcı kaynaklı iptal için alıcıya bildirim ve iade akışı gerekir"
  - label: "Sadece destek ekibi"
    description: "+ tam kontrol · − yönetici paneli gerekir, kullanıcı bekler"
```

After the answer:
- It becomes `R-011` in `product.md`, because every future order task depends on it.
- It is listed in the brief's `## Durable` section.
- `ownership.md` resumes with a single writer for the order status: the order service's `cancel` function.

Note that the question came with its consequences and a recommendation. It was never a bare "who can cancel?".
