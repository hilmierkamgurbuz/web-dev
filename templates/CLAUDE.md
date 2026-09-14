# web-dev project memory

Loaded every session through `@.claude/web-dev/CLAUDE.md` in the root CLAUDE.md. Keep it under 150 lines: it is re-read after every compaction.

## Project
- Product: <≤5 lines distilled from product.md>
- Stack: <framework · rendering · database/ORM · auth · styling · tests · hosting>
- Default branch: <main> · User language: <tr|en|…> · Remote: <origin|none>

## Invariants (binary — violated or not)
1. Every task runs locate → intake → brief → approval → build → verify → close. Plan mode is not used.
2. Source files are written only when listed in the approved brief's manifest, only with Edit/Write, never on the default branch.
3. Source code carries no comments. Every written symbol gets its note through `wd note set` in the same turn.
4. Known vulnerability classes never enter the code. A finding is accepted only through `Security exceptions:` in an approved brief.
5. Behavior changes ship with tests. UI changes pass `wd responsive` at every configured viewport.
6. Information not in the user's words or the project files is asked with options, never assumed.
7. Dependencies, destructive migrations and security exceptions exist only when the approved brief lists them.
8. A task ends with a pushed branch, an open PR, and a `/clear` recommendation to the user.
<project-specific invariants agreed with the user, one line each>

## Pointers
- Start locating at `.claude/web-dev/maps/index.md`; if maps are missing, run `node .claude/hooks/web-dev/wd.mjs maps`.
- Plan: `.claude/web-dev/blueprint.md` · Requirements: `.claude/web-dev/product.md` · Stack: `.claude/web-dev/stack.md` · Decisions: `.claude/web-dev/decisions.md`
- Current task: `.claude/web-dev/work/task.md` · Harness CLI: `node .claude/hooks/web-dev/wd.mjs`
