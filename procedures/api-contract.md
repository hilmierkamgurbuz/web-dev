# api-contract — adding or changing an endpoint, server action, or RPC procedure

**Decision type:** the contract between a frontend caller and a server handler.

## What must be known

- **Consumers:** the `callers:` list in `apimap.md` for this path. For a new endpoint, the components that will call it.
- **Authentication and authorization rule** (`product.md` / `decisions.md`). A missing rule is an OPEN QUESTION.
- **Input:** fields, types, limits and formats.
- **Output:** fields exposed to the caller, and fields that must never leave the server.
- **Error cases** the caller must handle.
- **Behavior:** idempotency (retries, double submit), pagination, rate limits.

## Decision logic

1. **Validate at the boundary** with the project's schema library (the `validationMarkers` in `config.json`). The handler works only with parsed, typed data.
   - The same schema, or a type inferred from it, is used by the client form.
2. **Authenticate, then authorize against the specific resource** at the owning module (`ownership.md`). Resource ids from the client are looked up, never trusted as ownership proof.
3. **Response shape is explicit.** Map domain objects to a response type; never return raw database rows.
4. **One error shape** for the project, for example `{ "error": { "code": "...", "message": "..." } }`:
   - Correct status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict, 422 semantic, 429 rate limited.
   - No stack traces or internal messages in responses.
5. **Mutations:**
   - Cookie-authenticated mutations are CSRF-safe: `SameSite` cookies plus an origin check, or the framework's CSRF token.
   - Retried or double-submitted mutations are idempotent (idempotency key, or a unique constraint).
6. **Lists** are paginated with a server-side maximum page size.
7. **Expensive or abuse-prone endpoints** (auth, search, uploads, email sending) are rate limited.
8. **A breaking change updates every caller** from `apimap.md` in the same task, or introduces a new versioned path and keeps the old one.
9. **Logging** records the request id, route and outcome — never passwords, tokens, or full personal data.

Output line for the brief's `Design → API contract`:

```
<METHOD /path> · in: <Schema> · out: <Type> · auth: <rule> · errors: <codes> · idempotent: <yes/no/n.a.> · callers updated: <list>
```

## Forbidden outcomes

- A handler reading `req.body` / `request.json()` without parsing it through a schema.
- A mutation without authentication, unless `apimap.md` would list it under `Unauthenticated mutations` and the brief declares why (for example a public contact form with rate limiting and captcha).
- A caller left in `## Unmatched calls` after the task.
- Over-exposed fields such as password hashes, internal flags, or other users' data.

## Boundary case (not an exit)

Webhooks from third parties authenticate by signature verification over the raw body instead of a user session. The signature check comes before any parsing side effect, and the event id makes processing idempotent.
