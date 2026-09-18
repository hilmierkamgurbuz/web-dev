---
paths:
  - "**/*.css"
  - "**/*.scss"
  - "**/*.sass"
  - "**/*.less"
  - "**/*.module.*"
  - "**/tailwind.config.*"
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.vue"
  - "**/*.svelte"
  - "**/*.astro"
---

# Style conventions (web-dev)

- Mobile-first: base styles for the smallest viewport; wider layouts through the project's `min-width` breakpoints or container queries (`procedures/responsive.md`).
- Use design tokens (spacing, color, radius, typography) from the design system in `stack.md`; no magic numbers.
- No fixed widths wider than the minimum viewport; `max-width: 100%` on media; `dvh` instead of `vh`.
- Interactive targets are at least 44×44 px; focus is always visible; contrast meets the accessibility target.
- Respect `prefers-reduced-motion`, and `prefers-color-scheme` when dark mode is a requirement.
- Never hide overflow on `html`/`body` to mask a layout bug; never disable zoom.
- <project-specific style conventions agreed with the user>
