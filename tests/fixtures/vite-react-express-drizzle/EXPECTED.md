# EXPECTED.md — vite-react-express-drizzle

Ground truth facts for the static-analysis tool to extract from this fixture. Monorepo: `apps/api` (Express 5 + drizzle-orm/pg) and `apps/web` (Vite + React SPA), pnpm workspaces.

## HTTP routes (apps/api)

Mount points, from `apps/api/src/app.ts`: `app.use('/api/posts', postsRouter)` and `app.use('/api/posts', commentsRouter)` (both routers mounted at the same `/api/posts` prefix), plus one inline route.

| METHOD | Path | Handler | Auth | Validation |
|---|---|---|---|---|
| GET | /api/posts | apps/api/src/controllers/posts.controller.ts:listPosts (routed via apps/api/src/routes/posts.ts) | none | none |
| GET | /api/posts/{id} | apps/api/src/controllers/posts.controller.ts:getPost | none | none |
| POST | /api/posts | apps/api/src/controllers/posts.controller.ts:createPost | requireAuth | validate(CreatePostSchema) |
| DELETE | /api/posts/{id} | apps/api/src/controllers/posts.controller.ts:deletePost | requireAuth | none |
| GET | /api/posts/{postId}/comments | apps/api/src/controllers/comments.controller.ts:listComments (routed via apps/api/src/routes/comments.ts, `.route('/:postId/comments')`) | none | none |
| POST | /api/posts/{postId}/comments | apps/api/src/controllers/comments.controller.ts:createComment | none | none |
| GET | /health | apps/api/src/app.ts inline handler (anonymous arrow function passed to `app.get('/health', ...)`) | none | none |

Total: 7 routes.

## Server actions / RPC procedures

None. This fixture uses plain REST endpoints only, no server actions or RPC framework.

## Frontend call sites (apps/web)

| File:enclosingFunction | Call | Resolves to | Status |
|---|---|---|---|
| apps/web/src/features/posts/usePosts.ts:usePosts | `api.get('/api/posts')` | GET /api/posts | MATCHED |
| apps/web/src/features/posts/usePosts.ts:usePost | `api.get(\`/api/posts/${id}\`)` | GET /api/posts/{id} | MATCHED |
| apps/web/src/features/posts/usePosts.ts:createPost | `api.post('/api/posts', body)` | POST /api/posts | MATCHED |
| apps/web/src/features/posts/usePosts.ts:deletePost | `api.delete(\`/api/posts/${id}\`)` | DELETE /api/posts/{id} | MATCHED |
| apps/web/src/features/posts/usePosts.ts:updatePost | `api.put(\`/api/posts/${id}\`, body)` | PUT /api/posts/{id} | UNMATCHED — no PUT route exists on /api/posts/{id} (only GET and DELETE are defined there) |
| apps/web/src/features/posts/usePosts.ts:useComments | `api.get(\`/api/posts/${postId}/comments\`)` | GET /api/posts/{postId}/comments | MATCHED |
| apps/web/src/features/posts/usePosts.ts:createComment | `api.post(\`/api/posts/${postId}/comments\`, body)` | POST /api/posts/{postId}/comments | MATCHED |
| apps/web/src/components/CommentForm.tsx:handleSubmit | `createComment(postId, { body })` | in-process call into usePosts.ts:createComment, which resolves as above | MATCHED (indirect, via local helper) |

All `api.*` calls go through `apps/web/src/api/http.ts`'s `axios.create({ baseURL: import.meta.env.VITE_API_URL })` instance; the paths passed to `api.get/post/put/delete` are the literal/template strings shown above (base URL is a separate host prefix, not part of route-path matching).

## Unauthenticated mutating routes (intentional)

- `POST /api/posts/{postId}/comments` (apps/api/src/controllers/comments.controller.ts:createComment, routed in apps/api/src/routes/comments.ts) — no `requireAuth` middleware, mutates the database. Intentionally unauthenticated.

All other mutating routes (`POST /api/posts`, `DELETE /api/posts/{id}`) use the `requireAuth` middleware.

## Routes with no schema validation (intentional)

- `DELETE /api/posts/{id}` — no body, no validate() middleware (expected; DELETE has no body to validate).
- `GET /api/posts/{postId}/comments` — no body.
- `POST /api/posts/{postId}/comments` (apps/api/src/controllers/comments.controller.ts:createComment) — accepts a body (`req.body`) but has no `validate(...)` middleware and no zod schema. Intentional gap.

Only `POST /api/posts` uses `validate(CreatePostSchema)`.

## DB reads / writes per function

| File:function | Access | Table(s) |
|---|---|---|
| apps/api/src/controllers/posts.controller.ts:listPosts | r | posts |
| apps/api/src/controllers/posts.controller.ts:getPost | r | posts |
| apps/api/src/controllers/posts.controller.ts:createPost | w | posts |
| apps/api/src/controllers/posts.controller.ts:deletePost | w | posts |
| apps/api/src/controllers/comments.controller.ts:listComments | r | comments |
| apps/api/src/controllers/comments.controller.ts:createComment | w | comments |

Drizzle tables (apps/api/src/db/schema.ts): `users` (pgTable "users", not read/written by any route handler in this fixture), `posts` (pgTable "posts"), `comments` (pgTable "comments").

## Environment variables

| File | Variable | Client-exposed? |
|---|---|---|
| apps/api/src/db/client.ts | DATABASE_URL | No (server-only, Node process env) |
| apps/api/src/server.ts | PORT | No (server-only, Node process env) |
| apps/web/src/api/http.ts | VITE_API_URL | Yes (`import.meta.env`, `VITE_` prefix is inlined into the client bundle by Vite — intentionally public) |
| apps/web/src/main.tsx | VITE_ADMIN_TOKEN | Yes — **intentionally dangerous**: name suggests an admin credential, but the `VITE_` prefix means Vite inlines its value into the client-side JS bundle, leaking it to the browser. |

## Page → component usage (apps/web)

- `apps/web/src/App.tsx` (App, react-router-dom `<Routes>`) → route `/` renders `PostsPage`, route `/posts/:id` renders `PostDetailPage` (client-side routes, not server HTTP routes)
- `apps/web/src/pages/PostsPage.tsx` (PostsPage) → `PostList` (apps/web/src/components/PostList.tsx) → `PostItem` (apps/web/src/components/PostItem.tsx)
- `apps/web/src/pages/PostDetailPage.tsx` (PostDetailPage) → `CommentForm` (apps/web/src/components/CommentForm.tsx)
- `apps/web/src/main.tsx` (entry point) → `App` (apps/web/src/App.tsx), wrapped in `BrowserRouter`

Component tree summary:
```
main.tsx
└─ App
   ├─ PostsPage        (route "/")
   │  └─ PostList
   │     └─ PostItem
   └─ PostDetailPage    (route "/posts/:id")
      └─ CommentForm
```

## Notes

- `apps/api/src/routes/posts.ts` and `apps/api/src/routes/comments.ts` are both mounted at the same `/api/posts` prefix in `apps/api/src/app.ts`; an analyzer must union both routers' sub-paths under that prefix rather than treating only one as authoritative.
- The `/health` route is defined inline in `apps/api/src/app.ts` with an anonymous handler, not in a routes/controllers file — it should still be reported as a route (handler attributed to `apps/api/src/app.ts`, no named export, e.g. `app.ts:<anonymous GET /health handler>`).
