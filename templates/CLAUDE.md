# web-dev

Loaded every session through `@.claude/web-dev/CLAUDE.md`. Keep it under 40 lines.

- Product: <≤3 lines from product.md>
- Stack: <framework · rendering · db/ORM · auth · styling · tests · hosting>
- Default branch: <main> · Language: <tr|en> · Remote: <origin|none>

## Invariants

1. Every change runs the web-dev cycle for its class (`wd class`): locate → intake →
   brief → approval → build → verify → close. Plan mode is not used.
2. Source files are written only when the approved brief's manifest lists them, only
   with Edit or Write, never on the default branch.
3. Code carries no comments. Every written symbol gets its note through `wd note set`
   in the same turn.
4. Known vulnerability classes never enter the code. A finding is accepted only through
   `Security exceptions:` in an approved brief.
5. Behavior changes ship with tests. UI changes pass `wd responsive`.
6. What is not in the user's words or the project files is asked with options.
7. Dependencies, destructive migrations and security exceptions exist only when the
   approved brief lists them.
8. A task ends with a pushed branch, an open PR, and `/clear`.
<project invariants agreed with the user, one line each>

## Where things are

- Skill router: the `web-dev` skill. If it does not fire, the protocol is still at
  `${CLAUDE_PLUGIN_ROOT}/procedures/locate.md` and `…/procedures/intake.md`, the brief
  format at `…/gates/brief.md`, the map schemas at `…/reference/maps.md`.
- Start locating with `wd map <path>` or `.claude/web-dev/maps/index.md`.
- Plan `.claude/web-dev/blueprint.md` · Requirements `product.md` · Stack `stack.md` ·
  Decisions `decisions.md` · Task `work/task.md` · CLI `node .claude/web-dev/wd.mjs`
