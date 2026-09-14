# security — what the gate blocks, what the brief must reason about

Two layers. **Enforced** rules are deterministic: the hook blocks the write and names the rule. **Reasoned** checks are logic-level risks no pattern can see: the brief's `Risk → Security` line states how each relevant item is handled, and the reviewer checks it against the diff.

## Enforced rules (blocked at write time and re-checked at turn end)

| Rule id | Blocks |
|---|---|
| `WD-SEC-EVAL` | `eval`, `new Function`, and string arguments to `setTimeout`/`setInterval` |
| `WD-SEC-XSS-HTML` | non-literal values in `dangerouslySetInnerHTML`, `.innerHTML`/`.outerHTML` assignment, `insertAdjacentHTML`, `document.write`, `v-html`, `{@html}` — unless the value is wrapped in a sanitizer call such as `DOMPurify.sanitize` or `sanitizeHtml` |
| `WD-SEC-SQL-INTERP` | template literals with interpolation, or string concatenation, passed to `query`, `execute`, `raw`, `$queryRawUnsafe`, `$executeRawUnsafe`, `sql.unsafe`, `knex.raw`, `sequelize.query` |
| `WD-SEC-CMD-INTERP` | `child_process` `exec`/`execSync` with non-literal commands, and `spawn` with `shell: true` and non-literal arguments |
| `WD-SEC-TLS-OFF` | `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED = '0'`, `strictSSL: false` |
| `WD-SEC-JWT` | `algorithms` containing `none`, `jwt.decode` result used without `verify`, and `ignoreExpiration: true` |
| `WD-SEC-CORS` | CORS origin `*` or `true` (reflect any) combined with `credentials: true` |
| `WD-SEC-REDIRECT` | redirect targets taken directly from request query, params or body |
| `WD-SEC-SSRF` | `fetch`/`axios`/`got`/`http.request` URLs taken directly from request query, params or body |
| `WD-SEC-PATH` | `fs` or `path.join`/`path.resolve` with request-derived segments and no containment check |
| `WD-SEC-PROTO` | deep merge or `Object.assign` of request bodies into existing objects; bracket assignment with request-derived keys |
| `WD-SEC-RANDOM` | `Math.random` in code that names tokens, secrets, passwords, ids, salts or codes |
| `WD-SEC-COOKIE` | session or auth cookies set without `httpOnly`, `secure` and `sameSite` |
| `WD-SEC-PUBLIC-ENV` | secret-looking names (`SECRET`, `PRIVATE`, `TOKEN`, `PASSWORD`, `KEY` except `PUBLISHABLE`/`PUBLIC_KEY`) behind a client-exposed prefix |
| `WD-SEC-SECRET` | hardcoded credentials: provider key formats, private key blocks, and high-entropy strings assigned to secret-looking names (plus gitleaks when installed) |
| `WD-SEC-HASH` | `md5`/`sha1` used for passwords, and password hashing with fast digests instead of argon2/bcrypt/scrypt |
| `WD-SEC-POSTMESSAGE` | `message` event listeners that never check `event.origin` |
| `WD-SEC-MIGRATION` | `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE` without `WHERE`, column type narrowing or renames in migration files — unless listed in the brief's `Migrations:` |
| `WD-DEP` | installing a package, or running an `npx`/`dlx`/`bunx` package, that is not declared in the brief's `Dependencies:` and not already installed |
| `WD-COMMENT` | comments added to source code |

Architectural rules come from the maps and are checked at `wd check` and at closing:
- `WD-API-UNAUTH` — a mutation route with `auth: NONE`
- `WD-API-UNVALIDATED` — a route with input but `in: NONE`
- `WD-API-UNMATCHED` — a caller pointing at a missing route
- `WD-DATA-MULTIWRITER` — a table with two owner modules

Each one is an ERROR unless declared in the approved brief.

## Exceptions

A finding is accepted only through an approved brief line:

```
- Security exceptions: WD-SEC-XSS-HTML | src/features/cms/Article.tsx | content is sanitized server-side by sanitizeArticle() before storage (D-031)
```

- No inline suppression exists.
- The AI never writes an exception into a brief that is already approved. Adding one changes the brief's hash, so approval is requested again and the user sees it.

## Comments

Comments added to source files are blocked. Explanations belong in notes (`wd note set`). Permitted pragmas, from `config.json` `comments.allowedPragmas`:
- `@ts-expect-error <reason>`
- `eslint-disable-next-line <rule>` — never for security rules
- `prettier-ignore`
- `webpackChunkName` and bundler hints
- `@vite-ignore`
- JSX pragmas
- coverage ignores
- `#__PURE__`
- the configured license header

Existing comments, generator output under `generated:` paths, and code before the baseline are not affected.

## Reasoned checklist — cover every item the change touches

- **Authentication/session:**
  - passwords hashed with argon2id or bcrypt
  - session rotated on login and invalidated on logout
  - brute-force rate limiting
  - account enumeration avoided in messages
  - MFA per `product.md`
- **Authorization:** checked at the owning module against the specific resource. Role and tenant boundaries covered by tests.
- **Input:** schema validation at every boundary (API, server action, webhook, queue message, file). Size limits.
- **Output:**
  - framework auto-escaping kept
  - HTML from users sanitized with an allowlist
  - `Content-Security-Policy` set or tightened for new script or style sources
- **CSRF:** cookie-authenticated mutations protected (SameSite plus origin check or token).
- **Uploads:**
  - type and size allowlist
  - stored outside the public root or served from a separate origin
  - randomized names, and no execution
  - signed URLs for private files
- **Outbound requests:** host allowlist for anything influenced by users.
- **Redirects:** relative paths or an allowlist.
- **Secrets:**
  - server-only env
  - `.env*` gitignored and `.env.example` without values
  - rotation noted if a secret was ever exposed
- **Payments/webhooks:**
  - amounts computed on the server
  - webhook signatures verified
  - idempotency keys
- **Personal data:**
  - collected only for a recorded purpose
  - redacted from logs
  - retention and deletion/export per `product.md` (KVKK/GDPR)
- **Headers:** `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors` or `X-Frame-Options`, `Permissions-Policy`.
- **Dependencies:**
  - declared in the brief
  - maintained
  - `osv-scanner` or `npm audit` clean or findings accepted as a decision
  - lockfile committed
- **Errors:** no stack traces or internal identifiers to clients. Server logs keep a request id.
