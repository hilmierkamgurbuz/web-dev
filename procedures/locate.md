# locate — where a task lives, before anything else is read

**Runs as step 0 of every task, including bug fixes and one-line changes.** Skipping it is the most expensive mistake this skill prevents: a repo scan costs tokens, and it misses the callers a change breaks.

## Order — stop at the first step that answers

1. **`.claude/web-dev/maps/index.md`** — find the feature row: its shards, entry files, routes, pages and tables. `UNMAPPED` or no row means go to step 2.
2. **`.claude/web-dev/blueprint.md`** — find the feature, its arrows, and the folder layout. This decides the attachment point for new work.
3. **The one layer map the task touches:**
   - `apimap.md` — endpoints, auth, schemas, and which frontend code calls them
   - `uimap.md` — routes, layouts, component trees, client/server boundary
   - `datamap.md` — tables, who reads and writes them, env and config surface
4. **`codemap-<shard>.md`** — the file header and its symbol lines. The shard comes from step 1 or from `shards.json`.
5. **Source, narrowly** — `Read` with `offset`/`limit` taken from the symbol's `L` range. Read only the symbols the change needs, plus the callers named by `used-by` or `callers:`.
6. **Grep/Glob, last resort** — only inside the directories steps 2–4 narrowed down. Write down why the maps could not answer; that becomes a map repair in the brief.

A delegated search goes to the `Explore` subagent, which follows the same order. Its stopping step is reported in the postflight.

## Before step 1

- The `[web-dev]` report in context shows map status. If maps are absent (fresh clone) or the report says `rebuild needed`, run `wd maps` once, then start at step 1.
- A new project with no code yet skips to `bootstrap.md`.

## Output

Keep this block in the working context. Its `Write` line becomes the brief's manifest, and its `Callers affected` line feeds the acceptance criteria and tests.

```
Locate:
- Found at step: <1-6>
- Feature: <sys as in blueprint.md, or NEW>
- Read: <path:Lstart-end, …>
- Write: <paths to create or modify>
- Callers affected: <from used-by / apimap callers / uimap parents, or ->
- Contracts touched: <METHOD /path, table, env var, or ->
- Map repairs: <STALE/MISSING/ORPHAN/MOVED/UNRESOLVED entries on this path, or ->
- Unresolved: <what the maps could not answer, or ->
```

## Rules

- Map degradation is a finding, not an excuse. A marker on the task's path is repaired inside the task and listed under `Map repairs`.
- A change to an exported symbol, a route, a table or an env var always lists its callers. Changing a contract without its consumers is a broken task.
- Never re-read a file already read this session unless the maps show it changed.
- `Unresolved` is not a guess slot. If the answer decides the design, it becomes a question in intake.
