# responsive — every UI change works from a small phone to a wide desktop

**Decision type:** how a UI change adapts to viewport, input method and user settings, and how that is proven.

## What must be known

- Target devices, minimum viewport, browsers and accessibility target (`product.md`). Defaults when not recorded and the user delegates: 360 px minimum, evergreen browsers, WCAG 2.2 AA.
- Design system in use: tokens, component library, breakpoints (`stack.md`, `.claude/rules/web-dev-styles.md`).
- The routes that show the change (`uimap.md`). These go into the brief's `Verification → Responsive` line.

## Building rules

1. **Mobile-first.** Base styles target the smallest viewport. Larger layouts are added with `min-width` media or container queries, using the project's breakpoints — never ad-hoc pixel values.
2. **Fluid layout.**
   - Use flex/grid with wrapping; `max-width: 100%` on media.
   - Never set a fixed width wider than the minimum viewport.
   - Long words and URLs wrap (`overflow-wrap: anywhere` where needed).
3. **Viewport units.** Use `dvh`/`svh` instead of `vh` for full-height areas, and respect safe-area insets on fixed elements.
4. **Touch.**
   - Interactive targets are at least 44×44 CSS px, or spaced so that the effective target is.
   - Anything available on hover is also available on tap and focus.
5. **Text.** Body text is at least 16 px. Form inputs are at least 16 px, to prevent iOS zoom. Line length stays readable on wide screens.
6. **Media.** Images carry `width`/`height` or an aspect ratio, to prevent layout shift. Use `srcset`/`sizes` or the framework's image component, and lazy-load below the fold.
7. **Tables and wide content** sit in a horizontally scrollable container with a visible affordance, or switch to a stacked layout on small screens.
8. **Accessibility.**
   - Semantic elements; every control has an accessible name.
   - Visible focus.
   - Color contrast meets the target.
   - `prefers-reduced-motion` respected.
   - Dark mode follows `product.md`.
9. **States.** Loading, empty, error and permission-denied states are laid out at every viewport, not only the happy path.

## Proof

1. Run `wd responsive --path <route>` for each route in the brief.
   - It starts the dev server from `config.json` if one is not running.
   - It checks every configured viewport and writes screenshots to `.claude/web-dev/shots/`.
   - It prints a summary line and a JSON report.
2. **Automatic findings** fail the check: horizontal overflow, elements outside the viewport, tap targets below the minimum, text below the minimum size, a missing viewport meta tag, console errors, axe violations of serious or critical impact, and a missing title or description on public routes when `product.md` requires SEO.
3. **Visual review.** Open each screenshot with `Read` and look for what automation misses: overlapping elements, truncated labels, awkward wrapping, misaligned grids, sticky elements covering content, and unreadable contrast on images.
4. Fix, then re-run until the summary passes. The recorded result is tied to the hash of the UI files. Any later UI edit requires a new run before closing.
5. For a route behind authentication, the brief states how the check logs in, for example a seeded test user through the project's e2e auth setup. Secrets never appear in the brief.

## Forbidden outcomes

- Desktop-first styles patched downward with `max-width` overrides.
- `overflow-x: hidden` on `body`/`html` to hide an overflow instead of fixing it.
- Disabling zoom (`user-scalable=no`, `maximum-scale=1`).
- Closing a UI task without a recorded `wd responsive` pass for the current UI hash.
