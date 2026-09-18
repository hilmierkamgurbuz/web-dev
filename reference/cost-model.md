# cost model — deciding performance from a number, not a habit

`Cost = Frequency × Scale(n) × UnitCost`

| Frequency | Multiplier |
|---|---|
| per animation frame or scroll/pointer event | ×60 |
| per render of a component | ×10 |
| per user interaction | ×1 |
| per request to the server | ×1 × concurrent users from `product.md` |
| per page load | ×0.1 |
| per build | ×0 at runtime |

Unit cost, cheapest to most expensive, each tier about ×10: memory read → computation →
DOM read → DOM write or layout → serialization → network round trip → database round trip
or cold start.

`n` comes from `product.md` (data sizes, users). If it is not recorded there, it is an
OPEN QUESTION. The budget is `product.md`'s performance section.

Current Core Web Vitals thresholds, at the 75th percentile of field data: **LCP ≤ 2.5 s**,
**INP ≤ 200 ms**, **CLS ≤ 0.1**, with **TTFB ≤ 0.8 s** as a supporting diagnostic. FID is
retired and is never a target; seeing it in generated text means the source was stale.

## Choosing

- Differ by less than ×10 and the costlier one stays well inside the budget → choose the
  more readable one.
- Differ by ×10 or more on a per-frame, per-render or per-request path → choose the cheaper one.
- Either way, record the reasoning in the brief.

An optimization without a number from this model or a measurement is labeled
"hypothesis" and says what would confirm it.
