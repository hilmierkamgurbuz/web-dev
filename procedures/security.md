# security — what the gate blocks, what the brief must reason about

Two layers. **Enforced** rules are deterministic and taint-based: the write gate blocks the
change and its message names the rule, the line and the fix, so the detail is taught at the
moment it matters and is not preloaded here. **Reasoned** checks are the logic-level risks no
pattern can decide; the brief's `Risk → Security` line states how each relevant one is handled
and the reviewer checks it against the diff.

Static analysis misses roughly half of real vulnerabilities, and it misses most on exactly the
classes that rank highest — access control and business logic. A clean scan is a floor, never a
ceiling, and never evidence for the reasoned list below.

## Enforced (blocked at write time, re-checked at turn end)

Injection and execution: `WD-SEC-EVAL`, `WD-SEC-SQL-INTERP`, `WD-SEC-CMD-INTERP`,
`WD-SEC-XSS-HTML`, `WD-SEC-PROTO`.
Request-derived sinks: `WD-SEC-SSRF`, `WD-SEC-PATH`, `WD-SEC-REDIRECT`.
Transport and identity: `WD-SEC-TLS-OFF`, `WD-SEC-JWT`, `WD-SEC-CORS`, `WD-SEC-COOKIE`,
`WD-SEC-POSTMESSAGE`.
Secrets and crypto: `WD-SEC-SECRET`, `WD-SEC-PUBLIC-ENV`, `WD-SEC-RANDOM`, `WD-SEC-HASH`.
Change control: `WD-SEC-MIGRATION`, `WD-DEP`, `WD-COMMENT`.

Every sink rule requires taint: a value that reaches it from a request, a parameter, a header,
a cookie or a body. A hardcoded or server-derived value does not trip them, so a finding is
always about data that a user controls.

Architectural rules come from the maps and are checked by `wd check` and at closing:
`WD-API-UNAUTH` (a mutation route with `auth: NONE`), `WD-API-UNVALIDATED` (input with
`in: NONE`), `WD-API-UNMATCHED` (a caller pointing at a missing route), `WD-DATA-MULTIWRITER`
(a table with two owner modules). Each is an ERROR unless the approved brief declares it.

## Exceptions

A finding is accepted only through a line in an approved brief:

```
- Security exceptions: WD-SEC-XSS-HTML | src/features/cms/Article.tsx | content is sanitized server-side by sanitizeArticle() before storage (D-031)
```

No inline suppression exists. Adding an exception changes the brief's hash, so approval is
asked again and the user sees exactly what is being accepted.

## Comments

Comments added to source are blocked; explanations belong in notes (`wd note set`). The
permitted pragmas live in `config.json` `comments.allowedPragmas` — type and lint escapes,
bundler hints, JSX pragmas, coverage ignores, `#__PURE__`, and the configured license header.
`eslint-disable-next-line` never covers a security rule. `TODO` and `FIXME` are reported as a
warning rather than blocked, because the honest place for them is the note or a `wd defer`
entry. Existing comments, `generated:` output and code before the baseline are untouched.

## Reasoned checklist — cover every item the change touches

- **Authorization** — the top-ranked class and the one no pattern sees. Checked at the owning
  module, against the specific resource, not only the route. Role and tenant boundaries have
  tests. Object ids from the client are authorized, never trusted.
- **Authentication/session** — argon2id or bcrypt; session rotated on login and invalidated on
  logout; brute-force rate limiting; no account enumeration in messages; MFA per `product.md`.
- **Input** — schema validation at every boundary (API, server action, webhook, queue message,
  file) with size limits.
- **Output** — framework auto-escaping kept; user HTML sanitized with an allowlist;
  `Content-Security-Policy` set or tightened for new script and style sources.
- **CSRF** — cookie-authenticated mutations protected by SameSite plus an origin check or a
  token. A double-submit token cookie is deliberately readable by JS; that is not a defect.
- **Exceptional conditions** — no silently swallowed `catch` on an auth, payment or
  authorization path, no fail-open default, unhandled promise rejections handled. An error
  path that quietly grants access is the failure this list exists for.
- **Deserialization and parsing** — no `js-yaml.load` (use `safeLoad`/schema), no
  `node-serialize`, no `JSON.parse` of untrusted input into a merge. XML parsers with external
  entities disabled.
- **ReDoS** — no user input into a regex, and no nested quantifier on a user-supplied string.
- **Uploads** — type and size allowlist; stored outside the public root or on a separate
  origin; randomized names; never executed; signed URLs for private files.
- **Outbound requests** — host allowlist for anything a user influences.
- **Secrets** — server-only env; `.env*` gitignored and `.env.example` valueless; rotation
  noted if a secret was ever exposed.
- **Payments and webhooks** — amounts computed on the server; signatures verified; idempotency
  keys.
- **Personal data** — collected only for a recorded purpose; redacted from logs; retention,
  deletion and export per `product.md` (KVKK/GDPR).
- **Headers** — `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `frame-ancestors` or `X-Frame-Options`, `Permissions-Policy`.
- **Supply chain** — the dependency is in the brief and maintained; the lockfile is committed
  and installs are frozen (`npm ci` / `--frozen-lockfile`); lifecycle scripts stay disabled
  unless the brief allows a named package; a freshly published version waits out a release-age
  cooldown. `npm audit` clean is not diligence on its own: it only knows disclosed CVEs and is
  structurally blind to a version published an hour ago.
- **Errors** — no stack traces or internal identifiers to clients; server logs carry a request id.
- **If the app itself embeds an LLM or agent** — untrusted content is never concatenated into a
  system prompt, and model output never reaches `dangerouslySetInnerHTML`, `eval` or a shell.
  Tool scope and goal-hijack surface are an intake question, not an assumption.
