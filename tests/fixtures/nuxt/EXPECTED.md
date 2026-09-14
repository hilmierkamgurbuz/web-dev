# EXPECTED.md — nuxt

Ground truth facts for the static-analysis tool to extract from this fixture. Nuxt 3, file-based Nitro server routes, nuxt-auth-utils, zod, an in-memory array as the "datastore" (no Prisma/Drizzle in this fixture).

## HTTP routes (Nitro server routes)

| METHOD | Path | Handler |
|---|---|---|
| GET | /api/todos | server/api/todos/index.get.ts:default |
| POST | /api/todos | server/api/todos/index.post.ts:default |
| DELETE | /api/todos/{id} | server/api/todos/[id].delete.ts:default |
| ANY | /sitemap.xml | server/routes/sitemap.xml.ts:default |

Notes:
- Method is derived from the filename suffix for files under `server/api/` (`.get.ts`, `.post.ts`, `.delete.ts`).
- `server/routes/sitemap.xml.ts` lives under `server/routes/` (not `server/api/`), so its path has no `/api` prefix and is exactly `/sitemap.xml`. It has no method suffix, so it responds to any HTTP method (ANY).

Total: 4 routes.

## Server actions / RPC procedures

None. This fixture uses plain Nitro REST endpoints only, no RPC framework.

## Frontend call sites

| File:enclosingFunction | Call | Resolves to | Status |
|---|---|---|---|
| composables/useTodos.ts:fetchTodos | `$fetch('/api/todos')` | GET /api/todos | MATCHED |
| composables/useTodos.ts:createTodo | `$fetch('/api/todos', { method: 'POST', body: { title } })` | POST /api/todos | MATCHED |
| composables/useTodos.ts:removeTodo | `` $fetch(`/api/todos/${id}`, { method: 'DELETE' }) `` | DELETE /api/todos/{id} | MATCHED |
| composables/useTodos.ts:useStats | `useFetch('/api/stats')` | GET /api/stats | UNMATCHED — no route exists at /api/stats |

Notes:
- `pages/index.vue` (top-level `<script setup>`) calls `fetchTodos()` and, in `handleAdd`, `createTodo(newTitle.value)`. `pages/todos/[id].vue` (top-level `<script setup>`) calls `fetchTodos()` and, in `handleDelete`, `removeTodo(id)`. These are in-process calls into the composable functions above (auto-imported, no explicit import statement per Nuxt convention) — the actual `$fetch`/`useFetch` call sites are inside `composables/useTodos.ts` as listed in the table; the pages should not be double-counted as separate route call sites.

## Unauthenticated mutating routes (intentional)

- `DELETE /api/todos/{id}` (server/api/todos/[id].delete.ts) — no `requireUserSession(event)` call, mutates the in-memory `todos` array (splice). Intentionally unauthenticated.

`POST /api/todos` calls `await requireUserSession(event)` before mutating. `GET /api/todos` and `GET/ANY /sitemap.xml` are non-mutating reads and are not flagged.

## Routes with no schema validation

- `DELETE /api/todos/{id}` — takes no body (only a route param), so there is nothing to validate; not a validation gap on its own but is also unauthenticated (see above).

`POST /api/todos` is the only route that accepts a body, and it validates via `readValidatedBody(event, CreateTodoSchema.parse)`. No route in this fixture accepts a body without validation.

## DB (in-memory store) reads / writes per function

This fixture has no ORM/database client; `server/utils/todos.ts` exports an in-memory array `todos` that stands in for a "todos" table for the purposes of this fixture.

| File:function | Access | Store |
|---|---|---|
| server/api/todos/index.get.ts:default | r | todos |
| server/api/todos/index.post.ts:default | w | todos |
| server/api/todos/[id].delete.ts:default | r, w | todos (r via `findIndex`, w via `splice`) |
| server/routes/sitemap.xml.ts:default | — | none |

## Environment variables

| File | Variable | Client-exposed? |
|---|---|---|
| nuxt.config.ts | NUXT_SESSION_PASSWORD | No — set under `runtimeConfig.session.password` (not under `runtimeConfig.public`), so Nuxt keeps it server-only and does not inline it into the client bundle. |

No other file in this fixture reads `process.env`.

## Page → component usage

- `app.vue` → `NuxtLayout` (renders `layouts/default.vue`) → `NuxtPage` (renders the matched page: `pages/index.vue` at `/` or `pages/todos/[id].vue` at `/todos/{id}`)
- `layouts/default.vue` → renders `<slot />` only (no feature components)
- `pages/index.vue` → `TodoList` (components/TodoList.vue) → `TodoItem` (components/TodoItem.vue); calls composables `fetchTodos`, `createTodo`
- `pages/todos/[id].vue` → `TodoItem` (components/TodoItem.vue); calls composables `fetchTodos`, `removeTodo`

Component tree summary:
```
app.vue
└─ NuxtLayout (layouts/default.vue)
   └─ NuxtPage
      ├─ pages/index.vue
      │  └─ TodoList
      │     └─ TodoItem
      └─ pages/todos/[id].vue
         └─ TodoItem
```

All component references (`TodoList`, `TodoItem`, `NuxtLayout`, `NuxtPage`) are used without explicit import statements, relying on Nuxt's directory-based auto-import/auto-registration for `components/*.vue` and Nuxt's built-in components.
