# data-source — where a value lives and where it is read from

**Decision type:** the home of a piece of state or data.

## What must be known

- The authority: which system or user action creates the truth for this value (from `product.md` / `decisions.md` / `datamap.md`). No authority recorded → OPEN QUESTION.
- Who reads it: the components and routes involved (`uimap.md`, `apimap.md` callers).
- Freshness need: always live, seconds, minutes, or build time.
- Whether it must survive reload, be shareable by link, or follow the user across devices.
- Sensitivity: public, user-private, secret.

## Decision logic — take the first that fits

1. **Derivable from other state?** Compute it where it is used, or memoize it by cost-model result. Never store it.
2. **Must survive reload and be shareable or bookmarkable** (filters, tabs, pagination, search)? → **URL state** (route params or search params).
3. **Owned by the server, or visible to other users or devices?** → **server state**.
   - Read it in a server component, loader or route handler where the framework allows.
   - Otherwise use one query cache with **one cache key per resource**, and invalidate it on every mutation of that resource.
4. **In-progress user input?** → **form state**, kept in the form, and validated by the same schema the server uses.
5. **Ephemeral and UI-only** (open or closed, hover, focus)? → **local component state**, lifted only to the nearest common parent that needs it.
6. **Per-device, non-sensitive preference?** → `localStorage` or IndexedDB with a schema version and a safe default.
7. **Sensitive** (tokens, session, PII)? → server session or an `httpOnly` `Secure` `SameSite` cookie. Never web storage, never the URL.
8. **Constant for a deployment?** → config or env.
   - Secrets are server-only and never carry a client-exposed prefix (`NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`, `NUXT_PUBLIC_`).

Output line for the brief's `Design → Data source`:

```
<value>: <class> · authority: <who> · read in: <where> · invalidated by: <mutation or ->
```

## Forbidden outcomes

- A server-owned value copied into a global client store and kept in sync by effects. That creates two sources of truth.
- Derived values stored in state and updated in `useEffect`/watchers.
- The same resource fetched under different cache keys, or mutated without invalidating its key.
- Secrets or tokens in client bundles, web storage or URLs.
- A value with two authorities. Apply `ownership.md`.

## Boundary case (not an exit)

An optimistic update may write to the client cache first. The server response remains the authority: on failure the cache rolls back, and the rollback path is an acceptance criterion with a test.
