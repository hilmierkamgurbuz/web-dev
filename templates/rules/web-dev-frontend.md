---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.vue"
  - "**/*.svelte"
  - "**/components/**"
  - "**/app/**"
  - "**/pages/**"
---

# Frontend conventions (web-dev)

- Server-render by default. A client boundary sits on the smallest interactive component (`procedures/render-boundary.md`).
- Every data-driven view has loading, empty, error and permission-denied states.
- Use semantic elements: `button` for actions, `a` for navigation, labels bound to inputs, `alt` on meaningful images, headings in order.
- Forms validate with the same schema the server uses, show field errors next to the field, and disable double submission.
- List keys are stable ids, never array indexes for lists that change.
- User-facing strings go through the i18n layer when `product.md` lists more than one language.
- No inline style objects for layout; use the styling system from `stack.md`.
- Never read secrets, and never import server-only modules into client components.
- <project-specific frontend conventions agreed with the user>
