# abstraction-level — whether to add an abstraction

**Decision type:** extracting a component, hook, utility, service layer, wrapper or configuration option.

This procedure runs in the opposite direction from the others. **The default is no new abstraction.** The burden of proof is on adding one.

## What must be known

- How many places need the same behavior today. Count them from the codemap: symbol notes and `calls:`/`used-by` fields. Never estimate.
- Whether those places change for the same reason. Shared code that changes for different reasons couples features.
- Whether a recorded requirement asks for variability (`product.md`, `decisions.md`).

## Decision logic

1. **Fewer than 3 real occurrences** → do not extract. Duplication is cheaper than the wrong abstraction.
2. **3 or more occurrences that change for the same reason** → extract into the owning feature, or into `lib/` / `shared/` only when two or more features use it. Name it for what it does, not for where it came from.
3. **Configuration options, props or flags count as abstraction.** Add one only for a variation that exists today, never "for later".
4. **Wrappers around a library** are justified in three cases only:
   - they enforce a security or correctness rule in one place (one HTTP client that attaches auth and handles errors, one sanitizer call)
   - swapping the library is a recorded requirement
   - the library's API is used in 3+ places in the same shape
5. **Generic UI components** — a design-system button or input — come from the chosen component library or the recorded design system, not from ad-hoc generalization inside a feature.
6. **Prefer composition** (children, slots, render props, composables) over inheritance or configuration objects.

## Forbidden outcomes

- Speculative interfaces, factories or plugin systems with one implementation.
- `utils`/`helpers` files that collect unrelated functions from several features.
- An abstraction that hides a security check, so a caller cannot see that authorization happens.
- A refactor that changes behavior without tests proving the behavior is unchanged.

## Boundary case (not an exit)

A framework convention may require a layer even with one use, such as a NestJS module/provider or a tRPC router file. Follow the convention and record nothing.
