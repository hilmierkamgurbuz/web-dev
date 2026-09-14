# render-boundary — where and when UI is rendered, and what runs in the browser

**Decision type:** rendering mode and caching of a route, and the server/client split of its components.

## What must be known

- SEO need for this route (`product.md`).
- Personalization: identical for everyone, per role, or per user.
- Freshness: build time, minutes, seconds, or every request.
- Interactivity: which parts need state, event handlers or browser APIs.
- Framework and version rules (`stack.md`, `facts/`). Caching and rendering defaults differ between framework versions, so read the facts file. If there is none, distill the official docs for the installed version first.

## Decision logic

1. **Default to the server.** Render on the server or at build time. Ship JavaScript only for interactivity.
2. **Mode per route:**
   - public, same for everyone, rarely changes → static generation
   - public, changes on a schedule → static with explicit revalidation (state the seconds)
   - per-user, auth-gated or always live → dynamic per request, never cached across users
   - highly interactive app shell behind login → client rendering is acceptable, but the data still comes through validated APIs
3. **Client components at the leaves.** Mark only the component that needs interactivity as client (`'use client'`, a hydrated island, `client:*`). Never a whole page for one button. Pass server data down as props.
4. **Fetch where the data lives.** Server components, loaders or `load` functions fetch on the server, in parallel when independent. Avoid request waterfalls.
5. **Caching is always explicit.** Every fetch or route states its cache and revalidation policy in code, using the framework's documented option. Relying on a default is forbidden, because defaults change between versions.
6. **Auth-gated or user-specific output** is never written to a shared cache or CDN.
7. **Hydration safety.** Nothing in render depends on `Date.now`, random values, `window` or locale without a stable server value.
8. **Streaming and loading states** for slow data. Each async boundary has loading and error UI.

Output line for the brief's `Design → Render boundary`:

```
<route>: <static | revalidate Ns | dynamic | client> · client components: <list> · data: <where fetched> · cache: <policy>
```

## Forbidden outcomes

- Fetching in `useEffect`/`onMounted` data the server could have rendered.
- A page-level client boundary added for a single interactive element.
- Implicit caching, and shared caching of personalized responses.
- Secrets or server-only modules imported into client components. Mark server-only modules with the framework's server-only guard.

## Boundary case (not an exit)

A widget embedded in third-party pages, or an offline-first feature, may be client-rendered by design. Record the reason as a decision.
