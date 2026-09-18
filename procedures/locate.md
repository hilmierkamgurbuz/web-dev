# locate — where a task lives, before anything else is read

**Step 0 of every task, including a one-line fix.** Skipping it is the most expensive mistake this harness prevents: a repo scan costs tokens and still misses the callers a change breaks.

## Order — stop at the first step that answers

1. **`.claude/web-dev/maps/index.md`** — find the feature row: its shards, entry files, routes, pages and tables. `UNMAPPED` or no row means go to step 2.
2. **`.claude/web-dev/blueprint.md`** — find the feature, its arrows, and the folder layout. This decides the attachment point for new work.
3. **The one layer map the task touches:**
   - `apimap.md` — endpoints, auth, schemas, and which frontend code calls them
   - `uimap.md` — routes, layouts, component trees, client/server boundary
   - `datamap.md` — tables, who reads and writes them, env and config surface
4. **`wd map <path>`** — one file's header and symbol lines; `wd find <symbol>` when step 3 gave a name. Open a whole `codemap-<shard>.md` only when the task spans the shard: it costs ten to twenty times one file's entry.
5. **Source, narrowly** — `Read` with `offset`/`limit` taken from the symbol's `L` range. Read only the symbols the change needs, plus the callers named by `used-by` or `callers:`.
6. **Grep/Glob, last resort** — only inside the directories steps 2–4 narrowed down. Write down why the maps could not answer; that becomes a map repair in the brief.

A delegated search goes to the `Explore` subagent, which follows the same order and reports the step it stopped at.

## Before step 1

- The `[web-dev]` line in context shows map status. If the maps are absent (a fresh clone) run `wd maps` once, then start at step 1.
- A new project with no code yet skips to `bootstrap.md`.

## Output

Write it to `.claude/web-dev/work/locate.md` so it survives compaction. Its `Write` line becomes the manifest, `Callers affected` feeds the acceptance criteria and tests, and `wd class` reads the block to pick the class.

```
Locate:
- Found at step: <1-6>
- Feature: <sys as in blueprint.md, or NEW>
- Read: <path:Lstart-end, …>
- Write: <paths to create or modify>
- Callers affected: <from used-by / apimap callers / uimap parents, or ->
- Contracts touched: <METHOD /path, table, env var, or ->
- Map repairs: <STALE/ORPHAN/MOVED/UNRESOLVED entries on this path, or ->
- Unresolved: <what the maps could not answer, or ->
```

Then run `wd class`. `touch` goes straight to the change; `task` and `arch` continue at `intake.md`. If the work turns out bigger than the class said, re-run it and pick up from intake — the class is a floor, not a licence.

## Rules

- A `STALE`, `ORPHAN`, `MOVED` or `UNRESOLVED` marker on the task's path is repaired inside the task and listed under `Map repairs`. A bare `MISSING` — no note yet — is normal in an adopted repo and is owed only for files this task writes.
- A change to an exported symbol, a route, a table or an env var always lists its callers. Changing a contract without its consumers is a broken task.
- `Unresolved` is not a guess slot. If the answer decides the design, it becomes a question in intake.
