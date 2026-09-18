# maps — what they contain and how a line is written

Maps live in `.claude/web-dev/maps/`, are gitignored, and are rebuilt on demand. They
merge two sources: mechanical facts extracted from the code, and semantic notes the AI
writes into `.claude/web-dev/notes/<shard>.md`, which is committed.

Read a map through `wd map <path>` or `wd find <symbol>` — one file's or one symbol's
lines. Open a whole `codemap-<shard>.md` only when the task genuinely spans the shard.

| Map | Answers | Exists when |
|---|---|---|
| `index.md` | feature → shards, entry files, routes, pages, tables, status | always |
| `codemap-<shard>.md` | files, every named function/component/hook, signature, line range, imports, used-by, db access, calls, notes | always |
| `apimap.md` | route ↔ handler ↔ auth ↔ input schema ↔ output ↔ tables ↔ frontend callers | routes exist |
| `uimap.md` | route → layout → component tree, client/server boundary, data fetching, metadata, last responsive check | UI exists |
| `datamap.md` | tables, columns, relations, reader and writer symbols, single-writer check, config surface (env, client-exposed prefixes, headers, cookies) | DB or env exists |

Every map starts with `<!-- stamp: <git short hash> <iso time> status: OK | DEGRADED <counts> -->`.

## Status vocabulary

Two different things, kept apart on purpose:

- **Undescribed** — `MISSING`. A symbol has no note yet. Normal in a repository being
  adopted. It never blocks a task and never makes a map `DEGRADED`; it only appears in
  `wd note missing`, and it blocks only for files the current task writes.
- **Wrong** — `STALE`, `ORPHAN`, `UNRESOLVED`, `MOVED`. The map asserts something the
  code no longer supports. These make the map `DEGRADED` and block when they sit on the
  task's own manifest paths.

`STALE` means the symbol's normalized body changed after its note was written;
formatting and comments never cause it. `MOVED` means a note followed a renamed or moved
symbol; confirm it, then `wd note set` clears the marker.

## Codemap line schema

```
## <path> | <K1|K2|K3> | sys: <feature> | role: <3-8 words>
imports: <paths> | used-by: <paths>
- [MARKER ]<signature> | L<start>-<end> | <note or -> | db: <r|w table, …> | calls: <symbols>
```

- Script-owned: signature, `L` range, imports, used-by, db, calls, and every marker.
- AI-owned through notes: `crit` (K1 core — the app does not boot or a core flow breaks;
  K2 feature; K3 leaf), `sys` (exactly as in `blueprint.md`), `role`, and each symbol note.
- A note is at most 20 words: what it does, the invariant it keeps, and how it fails. It
  never repeats the signature.
- A note is required for every exported symbol and for internal functions longer than
  5 lines. Trivial internal helpers may carry `-`.

## apimap line

```
<METHOD> <normalized path> | <handler file:symbol> | auth: <marker or NONE> | in: <schema or NONE> | out: <type or -> | db: <r|w table, …> | callers: <file:symbol, …> | note: <- or AI note>
```

Sections: `## Unmatched calls` (a fully resolved URL with no route: ERROR), `## Unresolved`
(visible, never ERROR), `## Dead routes` (INFO), `## Unauthenticated mutations` and
`## Unvalidated input` (ERROR unless the brief declares them). Path parameters normalize to `{}`.

## Notes file (`.claude/web-dev/notes/<shard>.md`, sorted by key)

```
<path> | role: <...> | sys: <...> | crit: <K1|K2|K3>
<path>#<symbol> | <note> | h:<hash written by wd>
```

Write notes only through `wd note set`, which takes JSON lines on stdin:
`{"key":"<path>#<symbol>","note":"..."}` or
`{"key":"<path>","role":"...","sys":"...","crit":"K2"}`. It stamps the hash, so the notes
file never has to be read before writing it.

## Shards

`shards.json` maps a path pattern to a shard; the first match wins and the last entry is
the catch-all. A shard has a token budget (`maxTokens`, default 4000). A shard past its
budget splits into numbered parts deterministically, so a file does not migrate between
shards because of an unrelated edit, and `index.md` lists the parts.

Maps store what is expensive to rediscover — contracts, invariants, call relationships,
the reason behind a non-obvious choice. They never store a directory tree or a file
listing, which the model can derive in one tool call.
