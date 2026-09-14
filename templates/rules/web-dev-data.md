---
paths:
  - "prisma/**"
  - "drizzle/**"
  - "**/migrations/**"
  - "**/db/**"
  - "**/models/**"
  - "**/entities/**"
  - "**/schema/**"
  - "**/*.sql"
---

# Data conventions (web-dev)

- Evolve schemas with expand/contract: add, backfill, switch readers, then remove in a later task. Destructive steps are declared in the brief's `Migrations:` line.
- Integrity lives in the database: `NOT NULL`, unique constraints, foreign keys, check constraints where the rule is absolute.
- Every query pattern on a hot path has a supporting index. The cost model decides what is hot.
- No N+1 queries on per-request paths; load relations explicitly.
- Each table has one owning module (`procedures/ownership.md`).
- Columns holding personal data are listed in `product.md` with their purpose and retention.
- Migrations are never edited after they are merged; a fix is a new migration.
- <project-specific data conventions agreed with the user>
