# EXPECTED.md — sveltekit

Ground truth facts for the static-analysis tool to extract from this fixture. SvelteKit 2 + Svelte 5 runes, native `+server.ts` REST endpoints, and a separate `@trpc/server` router under `src/lib/server/trpc` for RPC coverage.

## HTTP routes (SvelteKit native endpoints)

| METHOD | Path | Handler |
|---|---|---|
| GET | /api/products | src/routes/api/products/+server.ts:GET |
| POST | /api/products | src/routes/api/products/+server.ts:POST |
| GET | /api/products/{slug} | src/routes/api/products/[slug]/+server.ts:GET |
| DELETE | /api/products/{slug} | src/routes/api/products/[slug]/+server.ts:DELETE |

Total: 4 HTTP routes.

`src/routes/products/[slug]/+page.server.ts` is a page data/actions module, not a JSON HTTP route; its `load` function and form actions are listed separately below (page loads and form actions are typically POSTed to the page's own URL with an `?/actionName` query, not a distinct REST path).

## Page load functions

| File:export | Type | Notes |
|---|---|---|
| src/routes/products/[slug]/+page.server.ts:load | PageServerLoad | reads product via `findProductBySlug(params.slug)`; throws `error(404, ...)` when missing |

## Form actions (SvelteKit `actions`)

| File:action | Auth | Validation | DB |
|---|---|---|---|
| src/routes/products/[slug]/+page.server.ts:actions.default | none (no `requireUser` call) | none (`request.formData()` read directly, no zod schema) | r products (via `findProductBySlug`) |
| src/routes/products/[slug]/+page.server.ts:actions.addToCart | `requireUser(locals)` | `AddToCartSchema.parse(...)` (zod) | none |

`actions.default` is an intentionally unauthenticated, unvalidated form action (POST to `/products/{slug}` with no action query maps to it).

## RPC procedures (tRPC — src/lib/server/trpc)

`appRouter` (src/lib/server/trpc/router.ts) = `{ product: productRouter, health: publicProcedure.query }`.

| Procedure path | File:export | Type | Auth | Input validation |
|---|---|---|---|---|
| product.list | src/lib/server/trpc/product.ts:productRouter.list | query | publicProcedure (none) | none |
| product.create | src/lib/server/trpc/product.ts:productRouter.create | mutation | protectedProcedure (requires ctx.user, else TRPCError UNAUTHORIZED) | `CreateProductSchema` (zod) via `.input(...)` |
| product.remove | src/lib/server/trpc/product.ts:productRouter.remove | mutation | publicProcedure (none) — **intentionally unauthenticated mutation** | `z.string()` via `.input(...)` |
| health | src/lib/server/trpc/router.ts:appRouter.health | query | publicProcedure (none) | none |

`product.remove` is a mutating procedure (deletes a product) exposed as `publicProcedure` with no auth check — flag alongside the unauthenticated HTTP routes below.

## Frontend call sites

| File:enclosingFunction | Call | Resolves to | Status |
|---|---|---|---|
| src/routes/products/+page.svelte:\<module top-level\> | `trpc.product.list.query()` | RPC product.list | MATCHED |
| src/routes/products/+page.svelte:handleCreate | `trpc.product.create.mutate({ slug, name, price })` | RPC product.create | MATCHED |
| src/routes/products/+page.svelte:refreshFromRest | `fetch('/api/products')` | GET /api/products | MATCHED |
| src/routes/products/+page.svelte:handleRemove | `` fetch(`/api/products/${slug}`, { method: 'DELETE' }) `` | DELETE /api/products/{slug} | MATCHED |
| src/routes/products/+page.svelte:loadReviews | `fetch('/api/reviews')` | GET /api/reviews | UNMATCHED — no route exists at /api/reviews |

`src/routes/products/[slug]/+page.svelte` renders a native `<form method="POST" action="?/addToCart">` — this is a SvelteKit form action submission (progressive-enhancement form post), not a `fetch`/RPC call site; it targets `actions.addToCart` on `src/routes/products/[slug]/+page.server.ts`.

## Unauthenticated mutating endpoints (intentional)

- `DELETE /api/products/{slug}` (src/routes/api/products/[slug]/+server.ts:DELETE) — no `requireUser(locals)` call, mutates `products` via `deleteProductBySlug`.
- `product.remove` tRPC mutation (src/lib/server/trpc/product.ts:productRouter.remove) — `publicProcedure`, no auth guard, mutates `products`.
- `src/routes/products/[slug]/+page.server.ts:actions.default` form action — no `requireUser` call.

`POST /api/products` calls `requireUser(locals)`. `product.create` uses `protectedProcedure`. `actions.addToCart` calls `requireUser(locals)`.

## Endpoints with no schema validation (intentional)

- `DELETE /api/products/{slug}` — no body to validate (slug comes from the URL param only).
- `product.remove` — input is `z.string()` (the slug), which is itself minimal/permissive validation but performs no additional shape checking; the write itself (`deleteProductBySlug`) does no further validation of its own.
- `src/routes/products/[slug]/+page.server.ts:actions.default` — reads `request.formData()` directly with no zod schema.

All body-accepting endpoints otherwise validate: `POST /api/products` via `CreateProductSchema.parse(body)`; `product.create` via `.input(CreateProductSchema)`; `actions.addToCart` via `AddToCartSchema.parse(...)`.

## DB (in-memory store) reads / writes per function

`src/lib/server/db.ts` exports an in-memory array `products` standing in for a "products" table, plus accessor functions `findProductBySlug`, `createProduct`, `deleteProductBySlug`.

| File:function | Access | Store |
|---|---|---|
| src/lib/server/db.ts:findProductBySlug | r | products |
| src/lib/server/db.ts:createProduct | w | products |
| src/lib/server/db.ts:deleteProductBySlug | r, w | products (r via `findIndex`, w via `splice`) |
| src/routes/api/products/+server.ts:GET | r | products (direct read of the exported array) |
| src/routes/api/products/+server.ts:POST | w | products (via `createProduct`) |
| src/routes/api/products/[slug]/+server.ts:GET | r | products (via `findProductBySlug`) |
| src/routes/api/products/[slug]/+server.ts:DELETE | r, w | products (via `deleteProductBySlug`) |
| src/routes/products/[slug]/+page.server.ts:load | r | products (via `findProductBySlug`) |
| src/routes/products/[slug]/+page.server.ts:actions.default | r | products (via `findProductBySlug`) |
| src/routes/products/[slug]/+page.server.ts:actions.addToCart | — | none |
| src/lib/server/trpc/product.ts:productRouter.list | r | products (direct read of the exported array) |
| src/lib/server/trpc/product.ts:productRouter.create | w | products (via `createProduct`) |
| src/lib/server/trpc/product.ts:productRouter.remove | r, w | products (via `deleteProductBySlug`) |

## Environment variables

| File | Variable | Client-exposed? |
|---|---|---|
| src/lib/server/db.ts | DATABASE_URL | No — imported from `$env/static/private`, server-only build-time env, never sent to the client. |
| src/lib/components/SiteHeader.svelte | PUBLIC_SITE_NAME | Yes — imported from `$env/static/public`; SvelteKit inlines `$env/static/public` values into client-side code by design (intentionally public, not a leak). |

## Page → component usage

- `src/routes/+layout.svelte` → `SiteHeader` (src/lib/components/SiteHeader.svelte); renders `{@render children()}` for the matched page
- `src/routes/+page.svelte` → no components (plain markup + link to /products)
- `src/routes/products/+page.svelte` → `ProductCard` (src/lib/components/ProductCard.svelte), one per item in `products`
- `src/routes/products/[slug]/+page.svelte` → `ProductCard` (src/lib/components/ProductCard.svelte)

Component tree summary:
```
+layout.svelte
├─ SiteHeader
└─ {@render children()}
   ├─ +page.svelte                 (route "/")
   ├─ products/+page.svelte        (route "/products")
   │  └─ ProductCard (×N)
   └─ products/[slug]/+page.svelte (route "/products/{slug}")
      └─ ProductCard
```
