# ownership — who writes, who reads

**Decision type:** the single writer of an entity, a table, a piece of shared state, or a route.

## What must be known

- The entity and its lifecycle: create, update, status transitions, delete.
- Current writers: `datamap.md` lists writer symbols per table; `codemap` `db: w` fields show them per function.
- The authorization rule for each write (`product.md` / `decisions.md`). No rule recorded → OPEN QUESTION.

## Decision logic

1. Each entity or table has **one owning module**: a service, repository, server action module, or store slice. Every write goes through the functions of that module.
2. **Authorization lives at the owner**, next to the write. It is not left to a caller, a UI guard, or middleware alone. It checks that this user may do this action on this specific resource, not merely that a user is logged in.
3. **Status transitions are explicit functions** (`cancel`, `ship`), never a generic `update(status)` open to any value.
4. **Readers may be many.** Readers never write back through a side path.
5. If `datamap.md` shows **two writers**, or the task would create a second one, STOP. Either:
   - move the write into the owner and have the other caller call the owner, or
   - turn the second writer into a command sent to the owner, such as a queue, event or API call.
   Record the choice.
6. **Routes** belong to one feature (`sys`). A shared contract type lives in one place and is imported by both server and client.
7. **Client state** that several components change has one store or context owner exposing named actions. Components never mutate it directly.

## Forbidden outcomes

- UI code or a route handler writing a table directly while an owner module exists.
- An authorization check only in the UI or only in the router.
- A trusted client-supplied owner id (`userId` in the body) used to decide whose record is written.
- `blueprint.md` arrows in both directions between two features.

## Boundary case (not an exit)

A migration or seed script may write tables directly. It is declared in the brief's `Migrations:` line, it runs outside request paths, and it is idempotent.
