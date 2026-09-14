---
name: web-dev
description: >-
  Use for ALL web application development in JavaScript/TypeScript projects —
  starting a new web app from scratch or adopting an existing one, features,
  pages, components, API routes, database or schema changes, bug fixes,
  refactors, styling and responsive work, dependencies and stack decisions
  (React, Next.js, Vue, Nuxt, Svelte/SvelteKit, Node, Express, NestJS,
  Fastify, Hono). Whenever the user asks for anything that changes a web
  project's code, UI, API or data — even without naming this skill — use it.
  Provides question-first intake, an approved task brief instead of plan mode,
  hook-enforced security/comment/manifest gates, self-auditing code, API, UI
  and data maps, and a branch → PR → /clear task cycle.
---

# web-dev

A harness for building web applications at release quality. The model does not
change; the harness decides what it sees, what it may write, and what counts as
done. This file is the router. Everything else is opened only when the router
or a hook points at it.

`wd` below means `node .claude/hooks/web-dev/wd.mjs` run from the project root.
This skill's directory is `${CLAUDE_SKILL_DIR}`. The installer is `node ${CLAUDE_SKILL_DIR}/scripts/init_project.mjs <project root>`, used by `bootstrap.md` and `adopt.md`.

## Principles

1. **Ask, never assume.** Information that is not in the user's words or in the project files is unknown. Unknown information becomes a question with options, never a guess.
2. **The user's words are the spec.** The request is kept verbatim; the AI's reading of it is shown back and confirmed before it drives any code.
3. **The brief is the plan.** Plan mode is not used. The approved `.claude/web-dev/work/task.md` is the only plan, and the hooks enforce it.
4. **Distill once.** An expensive source — documentation, a code scan, a long discussion — is read once and distilled into maps, notes or facts. Afterwards the files are read, not the source.
5. **Hooks are the guarantee.** Enforcement lives in the project's `.claude/settings.json`, which runs in every session and inside every subagent. This file explains the rules; the hooks make them true.
6. **A map that lies is worse than no map.** Every map carries a status. A `STALE`, `MISSING`, `ORPHAN` or `UNRESOLVED` entry on a task's path is repaired inside that task.
7. **Code carries no comments.** Explanations of functions and connections live in notes and are rendered into the maps. The write gate rejects added comments.
8. **Secure by construction.** Known vulnerability classes are blocked at write time. Logic-level risks — authorization rules, business invariants — are declared in the brief and checked by the reviewer.
9. **Release quality from the first task.** Behavior changes ship with tests. UI changes are verified at mobile, tablet and desktop widths. There is no prototype mode.
10. **One task, one branch, one PR, then `/clear`.** All state lives on disk, so clearing the context loses nothing and keeps the next task's context clean.
11. **Never build on unverified enforcement.** The SessionStart hook puts a `[web-dev]` health report into context. If it is absent, hooks are not running (`disableAllHooks`, untrusted workspace, or not installed). Say so and write no code until it is back.

## Task cycle

```
locate + intake → brief → approval → build → verify → close → /clear
```

| Step | What happens | Open |
|---|---|---|
| 0 locate | Find where the task lives through the maps, never by scanning | `procedures/locate.md` |
| 0 intake | Verbatim request, restatement, ambiguity list, question rounds until nothing is `[OPEN]` | `procedures/intake.md` |
| 1 brief | Write `.claude/web-dev/work/task.md` in the brief format | `gates/brief.md` |
| 2 approval | Run `wd task hash`, then ask one AskUserQuestion whose question contains `[web-dev brief <hash8>]` with options `Approve` and `Revise`. Fallback: the user sends `APPROVE` or `ONAY` alone on a line. Only the hook records approval. | — |
| 3 build | Create the branch named in the brief, write only manifest paths with Edit/Write, write notes in the same turn, add tests | router procedures |
| 4 verify | `wd verify`; `wd responsive` when UI changed; `wd check`; reviewer subagent `web-dev-reviewer` | `procedures/responsive.md` |
| 5 close | Write `.claude/web-dev/work/postflight.md`, commit, push, open the PR with `wd pr-body`. The Stop hook verifies every item and closes the task. | `gates/postflight.md`, `procedures/git-flow.md` |
| 6 clear | Tell the user the task is closed, give the PR link, and recommend `/clear` before the next task | — |

Scope change during build: if the brief's premise turns out wrong, stop, raise an OPEN QUESTION, update `task.md`, and ask for approval again. Editing `task.md` voids the old approval by design.

## Loading channels and reading order

| Source | When |
|---|---|
| `CLAUDE.md` → `@.claude/web-dev/CLAUDE.md` (invariants, product summary, stack line) | Every session, already loaded |
| `[web-dev]` health report (SessionStart hook) | Every session, and again after `/clear` and compaction |
| This file | When the skill triggers |
| `procedures/locate.md`, `procedures/intake.md` | Step 0 of every task |
| `.claude/web-dev/maps/index.md` | Locate step 1, always first |
| `.claude/web-dev/blueprint.md` | Locate step 2, and whenever a task adds a file, route, page or table |
| `maps/apimap.md`, `maps/uimap.md`, `maps/datamap.md` | Locate step 3, only the layer the task touches |
| `maps/codemap-<shard>.md` | Locate step 4 |
| Source file with `Read` offset/limit taken from the map's `L`-range | Locate step 5 |
| `product.md`, `stack.md`, `decisions.md` | When intake or a procedure needs a recorded requirement or decision |
| `.claude/web-dev/facts/<pkg>@<version>.md` | When a decision rests on version-specific framework behavior |
| `gates/*.md`, `examples/*.md` | Task start and end; examples only when a format is unclear |

Open only what locate and the router select. A file already read this session is not re-read unless the health report says its map changed. A repo-wide Grep or Glob before locate steps 1–4 is a procedure violation. Broad searches go to the `Explore` subagent, which is map-first.

## Hard rules

- Write only paths listed in the approved brief's `## Manifest`. Reading is free but routed through locate.
- Write source files only with Edit or Write. Shell redirection, `sed -i`, `tee`, `cp` or `mv` onto source files are blocked.
- Never write under `.claude/web-dev/state/`. Never write approval records. The hooks own them.
- Never add comments to code. Allowed pragmas are listed in `procedures/security.md`.
- Never add a dependency, run an unknown `npx` package, write a destructive migration, or introduce a security exception unless the approved brief lists it.
- Never write code on the default branch.
- The notes for a written file are written in the same turn (`wd note set`). The Stop hook blocks the turn while they are missing.
- A map is never fixed by deleting the inconvenient entry. Markers clear by repairing the note or the code.
- If a procedure cannot produce an answer from recorded facts, the output is an OPEN QUESTION (`examples/04-open-question.md`), never a guess.
- Postflight is never skipped, and the task is never called done before the Stop hook reports it closed.

## Maps

Rendered by scripts into `.claude/web-dev/maps/`, which is gitignored and rebuilt on demand. They merge two sources: mechanical facts extracted from code, and semantic notes written by the AI into `.claude/web-dev/notes/<shard>.md`, which is committed.

| Map | Answers | Exists when |
|---|---|---|
| `index.md` | feature → shards, entry files, routes, pages, tables, status | always |
| `codemap-<shard>.md` | files, every named function/component/hook, signature, line range, imports, used-by, db access, calls, notes | always |
| `apimap.md` | route ↔ handler ↔ auth ↔ input schema ↔ output ↔ tables ↔ frontend callers | routes exist |
| `uimap.md` | route → layout → component tree, client/server boundary, data fetching, metadata, last responsive check | UI exists |
| `datamap.md` | tables, columns, relations, reader and writer symbols, single-writer check, config surface (env, client-exposed prefixes, headers, cookies) | DB or env exists |

### Codemap line schema (defined only here)

```
## <path> | <K1|K2|K3> | sys: <feature> | role: <3-8 words>
imports: <paths> | used-by: <paths>
- [MARKER ]<signature> | L<start>-<end> | <note or -> | db: <r|w table, …> | calls: <symbols>
```

- Script-owned: signature, `L` range, imports, used-by, db, calls, and the markers `STALE`, `MISSING`, `ORPHAN`, `MOVED`.
- AI-owned, via notes: `crit` (K1 core — app does not boot or core flow breaks; K2 feature; K3 leaf), `sys` (exactly as in `blueprint.md`), `role`, and each symbol note.
- A note is at most 20 words: what it does, the invariant it keeps, and how it fails. It never repeats the signature.
- A note is required for every exported symbol and for internal functions longer than 5 lines. Trivial internal helpers may carry `-`.
- `STALE` means the symbol's normalized body changed since its note was written. Formatting and comments never cause it.
- `MOVED` means a note followed a renamed or moved symbol by body hash. Confirm it, then `wd note set` clears the marker.

### Notes schema (`.claude/web-dev/notes/<shard>.md`, sorted by key)

```
<path> | role: <...> | sys: <...> | crit: <K1|K2|K3>
<path>#<symbol> | <note> | h:<hash written by wd>
```

Write notes only through `wd note set` (JSON lines on stdin: `{"key":"<path>#<symbol>","note":"..."}` or `{"key":"<path>","role":"...","sys":"...","crit":"K2"}`). It stamps the hash, so the notes file never needs to be read before writing. `wd note missing` lists the keys still owed.

### apimap line

```
<METHOD> <normalized path> | <handler file:symbol> | auth: <marker or NONE> | in: <schema or NONE> | out: <type or -> | db: <r|w table, …> | callers: <file:symbol, …> | note: <- or AI note>
```

Sections `## Unmatched calls` (fully resolved URL, no route: ERROR), `## Unresolved` (visible, never ERROR), `## Dead routes` (INFO), `## Unauthenticated mutations` and `## Unvalidated input` (ERROR unless declared in the brief). Path parameters normalize to `{}`.

Every map starts with `<!-- stamp: <git short hash> <iso time> status: OK | DEGRADED <counts> -->`. `OK` is earned.

## wd — the harness CLI

| Command | Does |
|---|---|
| `wd maps` | Re-render all maps now (hooks also do this) |
| `wd note set` / `wd note missing [--turn]` | Write notes from stdin / list owed notes |
| `wd task hash` / `wd task status` | Short hash of `task.md` for the approval question / current state machine position |
| `wd check [--draft-blueprint]` | Blueprint ↔ disk ↔ maps, and docs ↔ package versions; prints `n error(s), m warning(s)`. `--draft-blueprint` prints route, table and folder inventories for adoption |
| `wd verify` | Runs typecheck, lint, test and build from `config.json` and records the result for the Stop hook |
| `wd responsive [--path /x]` | Playwright check at every configured viewport, with screenshots in `.claude/web-dev/shots/` |
| `wd scan <files>` / `wd scan --all --report` | Security, secret and comment scan of files against HEAD / whole-project baseline report grouped by rule |
| `wd review-prep` | Writes the diff the reviewer subagent reads |
| `wd pr-body` | Prints the PR body built from `task.md`, `postflight.md` and recorded results |
| `wd facts check` | Lists facts whose pinned version no longer matches the lockfile |
| `wd id D` / `wd id R` | Prints the next free decision or requirement id |
| `wd setup` | Installs the pinned parser into the user cache (run once per machine) |

## Router

Step 0 for every task type: `procedures/locate.md` and `procedures/intake.md`.

| Task type | Mandatory | Conditional |
|---|---|---|
| new project | `bootstrap.md`, `tech-choice.md` | — |
| existing project, first use | `adopt.md` | `tech-choice.md` when the stack has gaps |
| feature | `data-source.md`, `api-contract.md` if an endpoint changes, `security.md` | `render-boundary.md` for pages or components; `responsive.md` for UI; `ownership.md` for writes |
| bug fix | root cause after locate | `data-source.md`, `render-boundary.md`, `security.md` when relevant |
| API or data change | `api-contract.md`, `ownership.md`, `security.md` | `data-source.md` |
| UI or styling | `responsive.md`, `render-boundary.md` | `data-source.md` |
| refactor | `abstraction-level.md`, `ownership.md` | — |
| dependency or stack decision | `tech-choice.md` | `security.md` |
| every task end | `git-flow.md` | — |

Path-scoped rules in `.claude/rules/web-dev-*.md` load when a matching file is read. A rule that must bind a decision before the first matching file is opened belongs in the brief as well.

## Cost model

Decisions about performance come from this calculation, not from habit.

`Cost = Frequency × Scale(n) × UnitCost`

| Frequency | Multiplier |
|---|---|
| per animation frame or scroll/pointer event | ×60 |
| per render of a component | ×10 |
| per user interaction | ×1 |
| per request to the server | ×1 × concurrent users from `product.md` |
| per page load | ×0.1 |
| per build | ×0 at runtime |

Unit cost, cheapest to most expensive, each tier about ×10: memory read → computation → DOM read → DOM write or layout → serialization → network round trip → database round trip or cold start.

`n` is read from `product.md` (data sizes, users). If it is not there, it is an OPEN QUESTION. The budget is `product.md`'s performance section (LCP, INP, CLS, API p95).

If two designs differ by less than ×10 and the costlier one stays far inside the budget, choose the more readable one. If they differ by ×10 or more on a per-frame, per-render or per-request path, choose the cheaper one. Between the two, record the reasoning in the brief. An optimization without a number from this model or a measurement is labeled "hypothesis".

## Subagent boundary

Settings hooks fire inside subagents too, so a subagent cannot write outside the manifest. The SubagentStart hook gives every agent, including the built-ins, the map order and the current health. `.claude/agents/Explore.md` overrides the built-in Explore with a map-first locator. `.claude/agents/web-dev-reviewer.md` is the supervisor: it reads the diff prepared by `wd review-prep` and returns `VERDICT: PASS` or `VERDICT: FAIL`. A hook records that verdict, and the Stop hook requires PASS for the current diff before closing. `.claude/agents/web-dev-annotator.md` writes notes for one shard at a time during adoption or a bulk repair, so no single context holds the whole codebase.

Delegated searching counts as searching: the postflight reports the locate step a subagent stopped at.
