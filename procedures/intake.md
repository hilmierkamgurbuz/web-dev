# intake — turning what the user wrote into what the user wants

**Runs at step 0 of every task, after locate.** A request is not understood because the AI has an interpretation of it. It is understood when the user has confirmed the interpretation and every open point that shapes the result has an answer.

## 1. Keep the words

Copy the user's messages that define the task verbatim into the brief's `## Request (verbatim)`, in the user's language. Later messages that change the task are appended, not merged.

## 2. Restate

Write what you understood, in the user's language:
- Goal: one sentence stating the outcome, not the implementation.
- In scope / out of scope.
- What will visibly change for the end user.
- What existing behavior could be affected, taken from locate's `Callers affected`.

## 3. List the ambiguities

For each item, check `product.md`, `stack.md`, `decisions.md`, `facts/` and the maps first. Whatever those answer is not asked. What remains is an ambiguity when its answer would change at least one of:
- data shape or storage
- who can do what (authn/authz)
- what the user sees or does (flow, states, empty/error/loading)
- API contract
- rendering mode or caching
- dependencies, cost, or hosting
- acceptance criteria or tests

An ambiguity that changes none of these is not asked. Pick the conventional option and say so in the restatement.

**Never skipped without asking:** data model changes, authentication and authorization, rendering mode, hosting and deployment target, payments, personal data (PII, KVKK/GDPR), destructive migrations, new dependencies, anything irreversible or user-visible at launch.

## 4. Ask in rounds

Use AskUserQuestion. Round rules:
- At most 4 questions per round. Put irreversible questions first.
- Each question offers 2–4 concrete options. The recommended option comes first, and its label ends with `(Recommended)` in the user's language, for example `(Önerilen)`.
- Each option description is one line in the form `+ <main benefit> · − <main cost>`. Mention consequences, not features.
- Round 1 always includes a restatement check: "Is this what you want?" with the options `Yes, exactly` and `Partly — I'll clarify`. Its question text is the restatement from step 2.
- Never ask a question whose answer is already recorded. Never ask a yes/no question when the real choice has more than two shapes.
- Continue with further rounds until no ambiguity from step 3 remains. There is no round limit; there is a relevance limit.

Question shape:

```
question: "Siparişler iptal edildiğinde ödeme nasıl iade edilsin?"
header: "İade"
options:
  - label: "Otomatik tam iade (Önerilen)"
    description: "+ kullanıcı beklemez, destek yükü düşer · − kötüye kullanım riskine karşı iptal süresi sınırı gerekir"
  - label: "Manuel onaylı iade"
    description: "+ her iade kontrol edilir · − yönetici paneli ve bekleme süresi ekler"
  - label: "Kredi olarak iade"
    description: "+ nakit çıkışı yok · − bazı ülkelerde yasal olarak yetersiz, kullanıcı memnuniyeti düşer"
```

## 5. Route every answer

| The answer binds… | Goes to |
|---|---|
| only this task | the brief's `## Decisions` |
| future tasks — a product rule, a user-facing requirement | `product.md` as `R-###`, and listed in the brief's `## Durable` |
| future tasks — a technology or architecture choice | `stack.md` or `decisions.md` as `D-###`, and listed in `## Durable` |

Recorded decisions are not re-asked or re-argued. If the user reverses one, write a new `D-###` that supersedes the old id.

## 6. Contribute

Intake is not transcription. Say so explicitly when the request:
- carries a security or privacy risk
- will not work on mobile
- conflicts with a recorded requirement
- has a cost or scale problem visible through the cost model
- is missing an obviously required state (error, empty, loading, permission denied)

Present the concern as a question with options. The decision stays with the user.

## 7. Delegation

If the user says to decide yourself, choose the recommended option. Record it with `by: delegated`, and still show the choice in the approval summary so the user sees what was decided.

## 8. Exit condition

Intake ends when the restatement is confirmed and the brief has no `[OPEN]`. Only then is the brief shown for approval.
