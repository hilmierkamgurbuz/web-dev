---
name: web-dev
description: >-
  Builds and changes web applications in JavaScript or TypeScript, for a brand-new
  project or an existing one. Covers websites, landing pages, dashboards, admin
  panels and stores even when no framework is named, plus features, pages,
  components, API routes, database and schema changes, auth, payments, styling,
  responsive work, bug fixes, refactors, dependency and stack decisions, and
  everyday breakage such as a failed install, a broken build or a 500 in dev.
  React, Next.js, Vue, Nuxt, Svelte, SvelteKit, Angular, Astro, Solid, Remix,
  Node, Express, NestJS, Fastify and Hono all route here. Also handles
  "continue where we left off" after a context reset on a project it manages.
when_to_use: >-
  Use for any request that changes a web project's code, UI, API or data, even
  when the user names no framework and no file. Use before scaffolding anything
  in an empty directory the user wants a site or app in, and before the first
  source edit in a JavaScript/TypeScript repository the harness has not adopted
  yet.
paths:
  - package.json
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.vue"
  - "**/*.svelte"
  - "**/*.astro"
  - "**/next.config.*"
  - "**/nuxt.config.*"
  - "**/vite.config.*"
  - "**/svelte.config.*"
  - "**/astro.config.*"
  - "**/tailwind.config.*"
  - "**/prisma/schema.prisma"
  - "**/drizzle.config.*"
---

# web-dev

A harness for building web applications at release quality. The model does not
change; the harness decides what it sees, what it may write, and what counts as
done. This file is the router: open nothing else until a step below points at it.

`wd` means `node .claude/web-dev/wd.mjs`, run from the project root. The plugin's
own directory is `${CLAUDE_PLUGIN_ROOT}`.

## Principles

1. **Ask, never assume.** What is not in the user's words or the project files is
   unknown, and unknown becomes a question with options — never a guess.
2. **The brief is the plan.** Plan mode is not used. The approved
   `.claude/web-dev/work/task.md` is the plan, and the hooks enforce it.
3. **Distill once.** An expensive source — docs, a scan, a long discussion — is
   read once into maps, notes or facts. Afterwards the files are read, not the source.
4. **Hooks are the guarantee.** This file explains the rules; the hooks make them
   true, in every permission mode and inside every subagent.
5. **A map that lies is worse than no map.** A `STALE`, `ORPHAN` or `UNRESOLVED`
   marker on the task's path is repaired inside that task.
6. **Ceremony follows blast radius.** A one-line fix does not pay for a schema change.
7. **Done is evidence, not a claim.** Verification, review and responsive results
   count only while their recorded hash still matches the code.
8. **One task, one branch, one PR, then `/clear`.** Every piece of state is on disk,
   so clearing loses nothing and keeps the next task's context clean.

## Task classes

`wd class` prints the class from the locate result. It decides the cycle.

| Class | When | Cycle |
|---|---|---|
| `touch` | one file, no exported symbol / route / table / env change, no dependency, no auth, payment or migration path | locate → change → notes → `wd verify` → commit |
| `task` | anything else | locate → intake → brief → approval → build → verify → close |
| `arch` | schema or auth change, new dependency, destructive migration, new route contract, cross-cutting refactor | the `task` cycle, plus a mandatory question round and the reviewer subagent |

A `touch` that grows past its class is re-classified on the spot and picks up the
`task` cycle from the intake step. Guessing low to skip the brief is the one
shortcut this harness has no tolerance for.

## The cycle

| Step | What happens | Open |
|---|---|---|
| 0 locate | Find where the task lives through the maps, never by scanning | `procedures/locate.md` |
| 0 intake | Verbatim request, restatement, ambiguity list, question rounds until nothing is `[OPEN]` | `procedures/intake.md` |
| 1 brief | Write `.claude/web-dev/work/task.md` | `gates/brief.md` |
| 2 approval | `wd task hash`, then one AskUserQuestion containing `[web-dev brief <hash8>]` | `gates/brief.md` |
| 3 build | Branch, write only manifest paths, notes in the same turn, tests | router below |
| 4 verify | `wd verify`; `wd responsive` when UI changed; `wd check`; the reviewer for `arch` | `procedures/responsive.md` |
| 5 close | `.claude/web-dev/work/postflight.md`, commit, push, PR via `wd pr-body` | `gates/postflight.md`, `procedures/git-flow.md` |
| 6 clear | Report the PR, then recommend `/clear` | — |

If the brief's premise turns out wrong mid-build, stop, raise an OPEN QUESTION,
update `task.md` and ask for approval again. Editing the brief voids approval by design.

## Hard rules

The hooks enforce these and their denial messages carry the detail, so they are
listed once here and never restated in a procedure.

- Write only paths in the approved brief's `## Manifest`. Reading is free but routed through locate.
- Write source only with Edit or Write. Shell redirection, `sed -i`, `tee`, `cp`, `mv`
  and interpreters fed a program on stdin are blocked; every filesystem change is
  watched, so an unauthorised write is seen even when it is not prevented.
- Never write under `.claude/web-dev/state/`, and never write an approval record. The hooks own them.
- No comments in code. Explanations live in notes and are rendered into the maps. The only exceptions are the pragmas listed in `config.json` `comments.allowedPragmas`; `TODO` and `FIXME` are a warning, and belong in a note or `wd defer`.
- No dependency, destructive migration, unknown `npx` package or security exception
  unless the approved brief lists it.
- Never write code on the default branch.
- Notes for a written file are written in the same turn (`wd note set`).
- A marker is cleared by repairing the note or the code, never by deleting the entry.
- When a procedure cannot answer from recorded facts, the output is an OPEN QUESTION
  (`examples/04-open-question.md`), never a guess.
- The task is closed by the Stop hook, not by saying so.

## Router

Step 0 of every class is `procedures/locate.md`, then `procedures/intake.md` for
`task` and `arch`.

| Task type | Mandatory | Conditional |
|---|---|---|
| new project | `bootstrap.md`, `tech-choice.md` | — |
| existing project, first use | `adopt.md` | `tech-choice.md` when the stack has gaps |
| feature | `data-source.md`, `security.md`, `api-contract.md` if an endpoint changes | `render-boundary.md`, `responsive.md`, `ownership.md` |
| bug fix | root cause after locate | `data-source.md`, `render-boundary.md`, `security.md` |
| API or data change | `api-contract.md`, `ownership.md`, `security.md` | `data-source.md` |
| UI or styling | `responsive.md`, `render-boundary.md` | `data-source.md`, `security.md` when the change renders user content |
| refactor | `abstraction-level.md`, `ownership.md` | `security.md` when the move crosses a trust boundary |
| dependency or stack | `tech-choice.md` | `security.md` |
| every `task`/`arch` end | `git-flow.md` | — |

Open at most three procedures for one task. Path-scoped rules in
`.claude/rules/web-dev-*.md` load themselves when a matching file is read.

## Reference

Opened only when the step says so, never preloaded.

| File | Answers |
|---|---|
| `reference/maps.md` | what each map contains, the codemap and apimap line schemas, the notes format |
| `reference/cost-model.md` | the performance calculation used for any per-frame, per-render or per-request decision |
| `reference/subagents.md` | the reviewer, the annotator and the map-first Explore override |
| `examples/*.md` | the format of a brief, a postflight, a codemap line, an open question, an apimap line, a fact |

## wd

| Command | Does |
|---|---|
| `wd map <path>` / `wd find <symbol>` | one file's or one symbol's map lines — the default way to read a map |
| `wd maps` | re-render every map now |
| `wd note set` / `wd note missing [--turn]` | write notes from stdin JSON / list the ones still owed |
| `wd class` | the task class from the current locate result |
| `wd task hash` / `wd task status` | the brief hash for the approval question / the state machine position |
| `wd defer "<item>"` | queue something out of scope; it is offered after `/clear` |
| `wd config set <key> <value>` | change one key `config.json` already defines — the gate reads that file, so it is never hand-edited |
| `wd check` | blueprint ↔ disk ↔ maps, and docs ↔ package versions |
| `wd verify` | typecheck, lint, test, build from `config.json`, recorded for the Stop hook |
| `wd responsive [--path /x]` | every configured viewport, screenshots in `.claude/web-dev/shots/` |
| `wd scan <files>` | security, secret and comment scan against HEAD |
| `wd review-prep` / `wd pr-body` | the diff the reviewer reads / the PR body |
| `wd id D` / `wd id R` | the next free decision or requirement id |
| `wd facts check` | facts whose pinned version no longer matches the lockfile |
| `wd setup` | install the pinned parser into the user cache, once per machine |

## Health

The `[web-dev]` line in context reports whether the harness is armed, whether the
parser is present, the git position, the map status and the open task. If it says
`STUCK`, resolve that with the user before anything else. If it is absent in a
project that has `.claude/web-dev/`, hooks are not running — say so and write no
code until it is back.
