# web-dev

A Claude Code plugin that turns web development into a harness rather than a conversation.
The model does not change. What changes is what it sees, what it is allowed to write, and what
counts as done.

Install it once and it runs in every directory on the machine — including an empty one you are
about to start a project in.

[Türkçe](README.tr.md)

---

## Contents

- [Why this exists](#why-this-exists)
- [What you get](#what-you-get)
- [Requirements](#requirements)
- [Install](#install)
- [Your first five minutes](#your-first-five-minutes)
- [The task cycle](#the-task-cycle)
- [Task classes](#task-classes)
- [The brief](#the-brief)
- [Enforcement](#enforcement)
- [Security](#security)
- [Maps](#maps)
- [Notes](#notes)
- [`wd` — the harness CLI](#wd--the-harness-cli)
- [Configuration](#configuration)
- [Project files](#project-files)
- [Subagents](#subagents)
- [Context and `/clear`](#context-and-clear)
- [Token cost](#token-cost)
- [Troubleshooting](#troubleshooting)
- [Uninstalling](#uninstalling)
- [Developing the plugin](#developing-the-plugin)
- [Design notes](#design-notes)
- [Known limits](#known-limits)
- [License](#license)

---

## Why this exists

An LLM writing web code fails in a small number of recognisable ways. It guesses at a requirement
instead of asking. It edits a file it was never asked to touch. It writes a function whose
docstring stops being true two commits later. It says "done" without running anything. It burns
half a context window re-reading source it has already read.

None of those are fixed by a better prompt, because a prompt is advice and advice is skippable.
They are fixed by changing the environment the model works in: what is in front of it, what the
tools will actually let it do, and what has to be true on disk before a task can close.

That is what this plugin is. Every rule below is enforced by a hook, not requested in prose — and
where a rule genuinely cannot be enforced, the documentation says so instead of implying otherwise.

---

## What you get

**It engages by itself.** The plugin ships its own hooks, so the harness looks at every directory
you open: an empty folder where you ask for a site, a five-year-old Next.js repo, or a Python
project it should stay out of. No per-project setup step stands between you and the first gate.

**Questions before code.** Anything not in your words or in the project files becomes a question
with options and trade-offs, not a guess. A hook records every question you were actually asked,
and a brief claiming an answer you never gave cannot be approved.

**A brief instead of plan mode.** One approved file describes the task: the goal, the decisions,
the acceptance criteria, the exact files that may be written, and the branch. Approval is bound to
that file's hash — edit it and approval is void.

**Ceremony that scales.** A one-line CSS fix does not pay for a schema migration's process. Three
classes (`touch`, `task`, `arch`) decide how much of the cycle runs.

**Gates that hold.** Manifest, security, comment, default-branch and dependency rules are enforced
at `PreToolUse`, which fires before any permission check in every permission mode — including
`bypassPermissions`. A watcher on the source tree sees writes that never went through a tool at
all: `sed -i`, `>`, `tee`, a generator, or your own editor.

**Maps that do not lie.** Code, API, UI and data maps are rendered from the code and merged with
per-symbol notes. A note whose symbol changed is marked `STALE`, and the marker clears by
repairing it, never by deleting the entry.

**A context that stays small.** Everything lives on disk, so `/clear` between tasks loses nothing.
The next session reads its own state back and, if you queued follow-ups, offers them unasked.

---

## Requirements

| | | |
|---|---|---|
| **Node** | 20 or newer | the hooks and the CLI are ESM, no dependencies |
| **git** | any recent version | the task cycle is branch-based |
| **Claude Code** | 2.1.200 or newer | earlier versions lack `FileChanged` and `PostToolBatch` |
| **OS** | macOS, Linux, Windows | on Windows the gate refuses PowerShell writes; use Edit/Write |

Optional, and silent when absent:

| Tool | Gives you | Install |
|---|---|---|
| `gh` | PR creation and the closing PR check | `brew install gh` |
| `@playwright/test` | `wd responsive` — real viewports, real screenshots | project devDependency + `npx playwright install chromium` |
| `@axe-core/playwright` | accessibility findings inside the responsive run | project devDependency |
| `gitleaks` | a second opinion on secrets, including staged ones | `brew install gitleaks` |
| `opengrep` (or `semgrep`) | nine extra taint rules at task close | [opengrep releases](https://github.com/opengrep/opengrep/releases) |
| `osv-scanner` | known CVEs in the lockfile after a dependency change | `brew install osv-scanner` |

Every optional tool degrades visibly: the health line says it is missing rather than reporting a
clean result it never produced.

---

## Install

```bash
claude plugin marketplace add hilmierkamgurbuz/web-dev
claude plugin install web-dev@web-dev
```

That is the whole installation. The hooks are live in your next session, in every directory.

Then, once per machine, install the pinned TypeScript parser the maps are built with:

```bash
claude            # in any project
> /web-dev:init
```

`/web-dev:init` also writes the project state described under [Project files](#project-files).
`--setup` installs the parser if this machine lacks it.

Running the installer directly, without Claude Code:

```bash
node ~/.claude/plugins/cache/web-dev/web-dev/*/scripts/init_project.mjs . --setup
```

The parser is pinned to `typescript@6.0.3` and cached per machine, because TypeScript 7 removed
the JavaScript compiler API the extractor is built on.

---

## Your first five minutes

### A brand-new project

Open Claude Code in an empty directory and describe the app:

```
bir fırın için tanıtım sayfası yap, iletişim formu olsun
```

What happens, in order:

1. `SessionStart` sees an empty directory and tells the model that this harness owns the task.
2. The model loads the skill and follows `procedures/bootstrap.md`.
3. **Intake** — you are asked about purpose, users, core flows, devices, accessibility target,
   languages, auth, personal data, data sizes, integrations, performance budget and hosting.
   Nothing is scaffolded yet.
4. **`product.md`** is written from your answers, each requirement carrying an `R-###` id.
5. **Stack decisions**, one at a time, each with options and consequences, each recorded as a
   `D-###` in `stack.md`.
6. **`blueprint.md`** — features, their one-directional arrows, the route/page/table inventory
   and the folder layout.
7. `git init`, then the framework's official CLI scaffolds the project. That commit is the
   **baseline**: the comment and pattern rules apply to what comes after it, never to generator
   output.
8. The harness installs its project state and the maps render for the first time.
9. The first feature runs the normal task cycle.

### An existing project

Open Claude Code in the repository and say what you want to change. The harness sees a
JavaScript/TypeScript project without its state and routes you through `procedures/adopt.md`:

1. A branch, `chore/web-dev-adopt` — adoption ships as a PR like any other task.
2. Stack detection: frameworks, package manager, workspaces, the scripts for
   typecheck/lint/test/build/dev, test runner, ORM, auth libraries, Playwright.
3. Anything detection could not find is asked, and recorded with `wd config set`.
4. `wd maps` builds the mechanical maps.
5. You choose the notes scope: every symbol now, or the core and API/data layers first. Symbols
   with no note are marked `MISSING`, which is normal and never blocks.
6. Per-shard `web-dev-annotator` subagents write the notes, one shard at a time, so no single
   context holds the whole codebase.
7. `wd check --draft-blueprint` proposes features from the routes, pages and tables; you confirm
   the boundaries; `blueprint.md` is written.
8. `product.md` and `stack.md` are proposed from the code and confirmed by you.
9. `wd scan --all --report` gives a security baseline. Existing findings do not block — the gate
   applies to code written from now on.
10. Postflight, commit, push, PR.

### Then, every day

Just say what you want. There is no command to remember.

```
add Stripe checkout to the cart
the build broke after the last install
make the pricing table readable on a phone
continue where we left off
```

---

## The task cycle

```
locate → intake → brief → approval → build → verify → close → /clear
```

### 0 · locate

Where the task lives is answered from the maps, in a fixed order, stopping at the first step that
answers:

1. `maps/index.md` — the feature row: shards, entry files, routes, pages, tables, status.
2. `blueprint.md` — the feature, its arrows, the folder layout. This decides where new work hangs.
3. The one layer map involved — `apimap.md`, `uimap.md` or `datamap.md`.
4. `wd map <path>` — one file's entry. A whole shard is opened only when the task spans it.
5. `Read` with `offset`/`limit` from the symbol's `L` range — just the symbols the change needs.
6. Grep/Glob, last resort, inside the directories the steps above narrowed.

The result is written to `work/locate.md` so it survives compaction. A repo-wide search before
step 4 is a procedure violation, and a delegated search is still a search: the postflight reports
which step the subagent stopped at.

### 0 · intake

Your request is kept **verbatim**. The model writes back what it understood — goal, in scope, out
of scope, what visibly changes, what existing behaviour could break — and asks you to confirm it.

Then it lists the ambiguities. Something is an ambiguity only if the answer would change at least
one of: data shape or storage, who can do what, what the user sees or does, the API contract, the
rendering mode, dependencies or cost, or the acceptance criteria. Anything else takes the
conventional option and says so.

Questions come in rounds of at most four, irreversible ones first, each with two to four concrete
options where the recommended one comes first and every option carries `+ benefit · − cost`.

These are never decided silently: data model changes, authentication and authorization, rendering
mode, hosting, payments, personal data, destructive migrations, new dependencies, and anything
irreversible or user-visible at launch.

### 1 · brief

`.claude/web-dev/work/task.md` — see [The brief](#the-brief) for the full format.

### 2 · approval

You are shown the goal, the acceptance criteria, **the whole Decisions section verbatim**, the
manifest as a list of paths marked `new`/`edit`, plus dependencies, security exceptions,
migrations and the branch. Then one question:

```
Sipariş notunu 500 karakterle sınırlayıp kaydediyoruz. [web-dev brief a3f91c02]
  ▸ Onayla        ▸ Revise
```

Only the hook records approval, and it binds to the brief's hash plus a digest of the decisions.
Editing the brief afterwards voids it. If `AskUserQuestion` is unavailable, send
`APPROVE a3f91c02` on a line of its own — a bare `APPROVE` is refused, because approval must name
the version it approves.

### 3 · build

The branch from the brief. Only manifest paths. Only Edit/Write. Notes written in the same turn.
Tests alongside behaviour.

### 4 · verify

`wd verify` runs typecheck, lint, test and build from `config.json` and records the result against
a hash of the tree. `wd responsive` runs every configured viewport when UI changed. `wd check`
reconciles blueprint, disk and maps. `arch` tasks add the reviewer subagent.

### 5 · close

`work/postflight.md`, commit, push, PR via `wd pr-body`. The Stop hook then re-verifies every
machine-checkable item **from its own records, not from your report**, and only then marks the
task closed.

Writing the postflight is not what starts that audit. It also arms when the branch carries commits
and the turn ends claiming the work is done — so "it's finished" runs the same gate.

### 6 · clear

You get the PR link, one line per acceptance criterion, and a `/clear` recommendation. Anything
you queued with `wd defer` is offered at the start of the next session.

---

## Task classes

`wd class` reads the locate result and prints the class. It decides how much of the cycle runs.

| Class | When | Cycle |
|---|---|---|
| `touch` | one file, no exported symbol / route / table / env change, no dependency, and not an auth, payment or migration path | locate → change → notes → `wd verify` → commit |
| `task` | anything else | the full cycle above |
| `arch` | schema or auth change, new dependency, destructive migration, new route contract, a file the whole app renders through, or a change spread across three separate areas | the full cycle **plus** a mandatory question round and the reviewer subagent |

The classifier reads structured fields only — the written paths, `Contracts touched`, the brief's
manifest and migrations — never the free-text parts of the locate block, so the word "checkout" in
a sentence does not escalate a typo fix. A stylesheet under an `auth/` folder stays a `touch`.

You can force the higher class by adding `- Arch signal: <reason>` to the locate block. A `touch`
that grows past its class is re-classified on the spot and picks the fuller cycle up from intake.

---

## The brief

```markdown
# Brief: Add order note

## Request (verbatim)
> siparişe not alanı ekle

## Understanding
- Goal: a buyer can store a short note on an order
- In scope: note service function and its test
- Out of scope: UI
- Located: step 4 · feature: orders
- Attachment point: src/features/orders

## Decisions
- Q: maximum length? → A: 500 characters · by: user
- Q: who may edit it? → A: the buyer, until the order ships · by: user · → durable R-011

## Acceptance
- [ ] a note of up to 500 characters is saved

## Design
- Data source: existing orders table, new column
- Render boundary: -
- API contract: PATCH /api/orders/{} · in: NoteSchema · out: Order · auth: session · 404/422
- Ownership: orders.service is the single writer
- Cost: per request, ×1 — one indexed update

## Risk
- Security: length validated server-side; buyer ownership checked at the service
- Security exceptions: -
- Migrations: add nullable column, no data loss
- Dependencies: -
- Assumptions: -

## Verification
- Tests: src/features/orders/note.test.ts — length cap, ownership
- Responsive: -
- Map repairs: -

## Git
- Branch: feat/order-note

## Durable
- R-011

## Manifest
- src/features/orders/note.ts
- src/features/orders/note.test.ts
```

Rules the hook enforces:

- `## Manifest` holds exact paths, no globs. The one exception is `generated:` lines covering a
  code generator's output.
- A `.claude/` path can never appear in the manifest. The files that decide what is enforced are
  changed by you, or through `wd config set`.
- Every `[OPEN]` is resolved before approval. A decision you delegated is written `by: delegated`.
- A `by: user` decision must match a recorded question **and the option you actually chose**.
- `Tests: none` needs your explicit approval, recorded in `## Decisions`.
- A package not in `Dependencies:` cannot be installed; a destructive migration not in
  `Migrations:` cannot be written.
- A security finding is accepted only through `Security exceptions:`, never a code comment.

---

## Enforcement

Two rings, both shipped inside the plugin. Nothing is registered in your project's settings.

### Ring 0 — runs in every directory

| Hook | What it does |
|---|---|
| `SessionStart` | classifies the directory (armed / web / empty / other), prints the health line, registers the file watch list, refreshes the `wd` shim, and after `/clear` seeds the next task |
| `UserPromptSubmit` | records an approval token, warns about plan mode, and in an unadopted web project states the route — once per session, not on every prompt |
| `CwdChanged` | re-registers the watch list when you `cd` into another project |
| `PreCompact` | pins the brief, branch, manifest and acceptance into the compaction summary |
| `PreToolUse` (writes) | in an unadopted web or empty directory, the first write to web source returns `ask` naming the framework and the procedure |

In a project that is none of the harness's business, Ring 0 costs one short-lived process
(~45 ms) and **zero tokens**.

### Ring 1 — arms when `.claude/web-dev/` exists

| Hook | What it does |
|---|---|
| `PreToolUse` | blocks out-of-manifest writes, taint-confirmed vulnerabilities, added comments, undeclared dependencies, destructive migrations, default-branch commits, interpreters fed a program on stdin, nested shells hiding a payload, `git -C`/`worktree` pointed elsewhere, PowerShell writes, and writes outside the project root |
| `PostToolUse` | records the write, the approval and the question ledger; captures the PR url |
| `PostToolBatch` | one map render per batch, the notes still owed, and the dependency audit after an install |
| `PostToolUseFailure` | turns a common tool error into the one next step that fixes it |
| `FileChanged` | sees every filesystem change, including ones no tool made, and flags a write to harness state as tampering |
| `PermissionRequest` | silently allows the harness's own commands and nothing else |
| `SubagentStart` | hands every subagent the map reading order and the current health |
| `SubagentStop` | records the reviewer's verdict, bound to the diff it reviewed |
| `Stop` | the closing audit |
| `ConfigChange` | refuses a mid-task edit to the files that decide what is enforced |
| `SessionEnd` | saves the task state |

A gate that fails is a gate that blocks: if the hook itself throws, the tool call is denied rather
than let through unchecked.

### What the Stop hook checks

In order, returning the first failure as the reason the turn cannot end:

1. `wd verify` has a recorded pass **for the current tree hash**.
2. If source behaviour changed, a test changed too — unless the brief records approved
   `Tests: none`.
3. If UI changed, `wd responsive` has a recorded pass **for the current UI hash**.
4. `wd note missing` is empty for files this turn touched, and `wd check` reports no new errors.
5. `VERDICT: PASS` from the reviewer **for the current diff hash**.
6. Every id under `## Durable` exists in `product.md`, `stack.md` or `decisions.md`.
7. The tree is clean, the branch is pushed, a PR is open.
8. The deep scan ran and is clean — and a deep scan that could not run is a blocker, not silence.

Infrastructure failures — no network, `gh` unauthenticated, the dev server down — are reported to
you with the manual step, and do not silently pass.

On the third identical blocker the hook stops repeating itself: it keeps blocking but rewrites the
reason into an escalation, records a durable `STUCK` flag that every later session surfaces, and
tells the model to ask you how to proceed.

---

## Security

Two layers, and the split is deliberate.

### Enforced — deterministic, taint-based, blocked at write time

Every sink rule requires **taint**: a value reaching it from a request, parameter, header, cookie
or body. Hardcoded or server-derived values do not trip them, so a finding is always about data a
user controls.

| Group | Rules |
|---|---|
| Injection and execution | `WD-SEC-EVAL`, `WD-SEC-SQL-INTERP`, `WD-SEC-CMD-INTERP`, `WD-SEC-XSS-HTML`, `WD-SEC-PROTO` |
| Request-derived sinks | `WD-SEC-SSRF`, `WD-SEC-PATH`, `WD-SEC-REDIRECT` |
| Transport and identity | `WD-SEC-TLS-OFF`, `WD-SEC-JWT`, `WD-SEC-CORS`, `WD-SEC-COOKIE`, `WD-SEC-POSTMESSAGE` |
| Secrets and crypto | `WD-SEC-SECRET`, `WD-SEC-PUBLIC-ENV`, `WD-SEC-RANDOM`, `WD-SEC-HASH` |
| Supply chain | `WD-SEC-SCRIPT-FETCH` (a script that downloads code and runs it), `WD-SEC-LIFECYCLE` (a new install-time hook), `WD-DEP`, `WD-DEP-VULN` |
| Change control | `WD-SEC-MIGRATION`, `WD-COMMENT` |

From the maps, checked by `wd check` and at close: `WD-API-UNAUTH` (a mutation route with
`auth: NONE`), `WD-API-UNVALIDATED`, `WD-API-UNMATCHED`, `WD-DATA-MULTIWRITER`.

With `opengrep` or `semgrep` installed, nine additional taint rules run over the task's diff at
close as `WD-DEEP:*`.

### Reasoned — stated in the brief, checked by the reviewer

What no pattern can decide: **authorization** (the top-ranked class and the one static analysis
misses most), authentication and session handling, input validation coverage, output encoding and
CSP, CSRF, exceptional-condition handling (no swallowed `catch` or fail-open default on an auth or
payment path), deserialization, ReDoS, uploads, outbound request allowlists, secret hygiene,
payments and webhooks, personal data, security headers, and supply-chain policy.

Static analysis misses roughly half of real vulnerabilities and misses most on exactly the classes
that rank highest. A clean scan is a floor, never a ceiling, and this harness says so rather than
implying otherwise.

### Comments

Comments added to source are blocked; explanations belong in notes. Permitted pragmas live in
`config.json` `comments.allowedPragmas` — type and lint escapes, bundler hints, JSX pragmas,
coverage ignores, `#__PURE__`, and a configured license header. `eslint-disable-next-line` never
covers a security rule. `TODO` and `FIXME` are a warning, not a block: their honest home is a note
or `wd defer`.

---

## Maps

Rendered into `.claude/web-dev/maps/`, gitignored, rebuilt on demand. They merge mechanical facts
extracted from the code with the notes you and the model write, which **are** committed.

| Map | Answers | Exists when |
|---|---|---|
| `index.md` | feature → shards, entry files, routes, pages, tables, status | always |
| `codemap-<shard>.md` | every named symbol: signature, line range, imports, used-by, db access, calls, note | always |
| `apimap.md` | route ↔ handler ↔ auth ↔ input schema ↔ output ↔ tables ↔ frontend callers | routes exist |
| `uimap.md` | route → layout → component tree, client/server boundary, data fetching, metadata | UI exists |
| `datamap.md` | tables, columns, relations, readers and writers, single-writer check, env surface | DB or env exists |

A codemap line:

```
## src/features/orders/note.ts | K2 | sys: orders | role: order note persistence
imports: src/lib/db.ts | used-by: src/app/api/orders/[id]/route.ts
- saveNote(orderId: string, text: string): Promise<Order> | L4-18 | trims and caps at 500 chars; throws on unknown order | db: w orders | calls: db.order.update
```

### Status vocabulary

Two different things, kept apart on purpose:

- **Undescribed** — `MISSING`. A symbol has no note yet. Normal in a repository being adopted. It
  never blocks and never makes a map `DEGRADED`; it is owed only for files the current task writes.
- **Wrong** — `STALE`, `ORPHAN`, `UNRESOLVED`, `MOVED`. The map asserts something the code no
  longer supports. These make the map `DEGRADED` and block when they sit on the task's own paths.

`STALE` means the symbol's normalized body changed after the note was written; formatting and
comments never cause it. `MOVED` means a note followed a rename, confirmed by body hash **and**
a matching name or path — a hash match alone is not enough to move a note onto an unrelated symbol.

### Cost

On real code the maps run about a tenth of the source they describe. Read them with
`wd map <path>` or `wd find <symbol>` rather than opening a shard; a shard costs ten to twenty
times one file's entry. Shards carry a token budget and split deterministically past it.

Maps store what is expensive to rediscover — contracts, invariants, call relationships, the reason
behind a non-obvious choice. They never store a directory tree the model can list in one call.

---

## Notes

Notes are the semantic half of every map, and the only place an explanation of code is allowed to
live. They are committed to `.claude/web-dev/notes/<shard>.md`.

```bash
node .claude/web-dev/wd.mjs note set <<'EOF'
{"key":"src/features/orders/note.ts","role":"order note persistence","sys":"orders","crit":"K2"}
{"key":"src/features/orders/note.ts#saveNote","note":"trims and caps at 500 chars; throws on unknown order"}
EOF
```

- At most 20 words: what it does, the invariant it keeps, how it fails. Never repeats the signature.
- Required for every exported symbol and every internal function longer than five lines.
- `crit`: `K1` the app does not boot or a core flow breaks · `K2` a feature breaks · `K3` a leaf.
- `wd note set` stamps the body hash, so the notes file never has to be read before writing it.
- `wd note missing --turn` lists what the current turn still owes.

---

## `wd` — the harness CLI

Run from the project root as `node .claude/web-dev/wd.mjs <command>`. The file is a shim that
resolves the plugin's real CLI and is refreshed automatically when the plugin updates.

| Command | Does |
|---|---|
| `map <path>` | one file's map entry — the default way to read a map |
| `find <symbol>` | every map line for a symbol name |
| `class` | the task class (`touch` / `task` / `arch`) from the locate result |
| `defer "<item>"` | queue something out of scope; it is offered after `/clear` |
| `config` / `config set <key> <value>` | read `config.json`, or change one key it already defines |
| `maps [--force]` | re-render every map |
| `note set` | write notes from JSON lines on stdin |
| `note missing [--shard s] [--turn]` | list the notes still owed |
| `task hash` | the 8-character hash for the approval question |
| `task status` | where the state machine is |
| `check [--draft-blueprint]` | blueprint ↔ disk ↔ maps, docs ↔ package versions; `--draft-blueprint` prints route/table/folder inventories for adoption |
| `verify` | typecheck, lint, test, build — recorded for the Stop hook |
| `responsive [--path /x] [--url base]` | every configured viewport, with screenshots |
| `scan <files…>` | security, secret and comment scan against HEAD |
| `scan --all --report` | whole-project baseline grouped by rule |
| `review-prep` | write the diff and context the reviewer reads |
| `pr-body` | the PR description built from the brief and the recorded results |
| `facts check` | facts whose pinned version no longer matches the lockfile |
| `id D` / `id R` | the next free decision or requirement id |
| `setup` | install the pinned parser for this machine |

---

## Configuration

`.claude/web-dev/config.json` decides what the gate enforces, so the write gate refuses a direct
edit. Change it with `wd config set <dotted.key> <value>`, or by hand as the user.

| Key | Default | Meaning |
|---|---|---|
| `userLanguage` | `"en"` | the language questions and summaries are written in |
| `defaultBranch` | `"main"` | source is never written on it |
| `git.remote` | `"origin"` | `"none"` turns off the push and PR requirements |
| `git.pullRequest` | `true` | whether closing requires an open PR |
| `packageManager` | `"npm"` | drives the install command the gate recognises |
| `frameworks` | `[]` | overrides detection when it guesses wrong |
| `commands.typecheck/lint/test/build/dev` | detected | what `wd verify` runs |
| `devUrl` | `http://localhost:3000` | where `wd responsive` looks |
| `responsive.viewports` | `[[360,800],[768,1024],[1440,900]]` | phone, tablet, desktop |
| `responsive.paths` | `["/"]` | routes checked when the brief names none |
| `responsive.minTapTargetPx` | `44` | below this a control is reported |
| `responsive.minFontPx` | `12` | below this text is reported |
| `generated` | four globs | paths exempt from the comment and pattern rules, still secret-scanned |
| `authMarkers` | ~30 names | what the apimap counts as an auth check |
| `validationMarkers` | ~15 names | what the apimap counts as input validation |
| `approval.labels` / `approval.tokens` | `Approve`/`Onayla`, `APPROVE`/`ONAY` | how you approve |
| `comments.licenseHeader` | `""` | a header exempt from the comment rule |
| `comments.allowedPragmas` | ~14 pragmas | the only comments that may be added |
| `security.gitleaks` / `opengrep` / `osvScanner` | `"auto"` | `"auto"` uses the tool when installed; `"off"` disables it |
| `baseline` | HEAD at install | the commit before which existing code is not judged |

`.claude/web-dev/shards.json` maps path patterns to codemap shards — first match wins, the last
entry is the catch-all — and caps a shard's token budget.

---

## Project files

| Committed | Generated, gitignored |
|---|---|
| `CLAUDE.md` (imports `.claude/web-dev/CLAUDE.md`) | `.claude/web-dev/maps/` |
| `.claude/settings.json` (plugin offer + denies, no hooks) | `.claude/web-dev/state/` |
| `.claude/agents/{Explore,web-dev-reviewer,web-dev-annotator}.md` | `.claude/web-dev/work/` |
| `.claude/rules/web-dev-*.md` | `.claude/web-dev/shots/` |
| `.claude/web-dev/{product,stack,decisions,blueprint}.md` | `.claude/web-dev/wd.mjs` |
| `.claude/web-dev/notes/`, `facts/` | `.claude/web-dev/statusline.mjs` |
| `.claude/web-dev/{config,shards,enforce}.json` | |

`enforce.json` is what arms the gate in every clone of the repository. The approval record itself
lives **outside** the project, in the plugin's data directory, HMAC-signed against the brief hash —
so a process that can write into the repository still cannot forge an approval.

---

## Subagents

Settings and plugin hooks fire inside subagents too, so a subagent cannot write outside the
manifest. Default to a single agent; a subagent earns its cost only for genuinely parallel work or
work that must run without the implementation session's reasoning in context.

| Agent | Role |
|---|---|
| `Explore` (override) | map-first locator; follows the same order and reports the step it stopped at |
| `web-dev-reviewer` | reads only the prepared diff and the approved brief; returns `VERDICT: PASS` or `VERDICT: FAIL` |
| `web-dev-annotator` | writes notes for one shard at a time during adoption or a bulk repair |

`AskUserQuestion` is stripped from every subagent, so every question to you is asked by the main
agent. The reviewer reports only gaps affecting correctness or a stated requirement — never style —
because a reviewer that cries wolf is the fastest way to get the step skipped.

---

## Context and `/clear`

The harness is built around one task per context. That is not a style preference: long contexts
measurably degrade instruction-following and multi-turn accumulation degrades it further,
independently of any token limit.

So every piece of state lives on disk and `/clear` costs nothing:

- `SessionStart` re-reads the health, the task, the maps and the git position.
- `PreCompact` pins the brief, branch, manifest and acceptance into the compaction summary and
  explicitly tells the model not to re-plan or re-ask approval.
- When a task closes, anything queued with `wd defer` is written to `work/next.md`; after `/clear`
  the next session opens with it automatically.
- If you start writing again in the same session a task just closed in, the first write asks once,
  naming the task and its PR.

**No hook can force `/clear`.** This is a platform limit and the harness states it rather than
pretending. What it does instead is make clearing free, tell you when it is time, and pick the work
up on the other side.

---

## Token cost

Measured on this repository, not estimated:

| | v1 | v2 |
|---|---|---|
| Always-on, every session | ~335 tok | ~456 tok |
| Skill body when it fires | ~5,400 tok | ~2,900 tok |
| Prose before any map or source, `touch` | ~12,200 tok | ~3,600 tok |
| Prose before any map or source, `task` | ~12,200 tok | ~7,700 tok |
| Prose before any map or source, `arch` | ~12,200 tok | ~10,400 tok |
| Maps vs the source they describe | — | 0.11 |
| Hook cost in an unrelated project | — | 45 ms, 0 tokens |

A test enforces a per-file byte budget on every instruction file and a combined ceiling per task
class, so routing prose cannot grow quietly.

---

## Troubleshooting

**The `[web-dev]` line never appears.**
The plugin is disabled or hooks are off. Check `claude plugin list`, then `/hooks`. A
`disableAllHooks: true` in user, project or local settings turns everything off.

**It says `NOT ARMED`.**
`.claude/web-dev/enforce.json` is missing, so the write gate, the security scan and the closing
audit are all off while the rest looks installed. Restore it from git, or re-run `/web-dev:init`.

**It says `TAMPER`.**
Something other than the hooks wrote into `.claude/web-dev/state/`. The approval and turn records
are treated as untrusted until the next turn audit re-derives them. Usually a stray script or a
merge; re-approve the brief.

**It says `STUCK`.**
The same closing check has blocked three or more turns. The reason is in the line. Decide with the
model: fix it differently, record it as an accepted exception in the brief, or split it out.

**A write is denied and you disagree.**
The denial names the rule and the fix. If it is genuinely a false positive, it is accepted only
through `Security exceptions:` in the brief — which changes the hash, so you approve it again and
see exactly what you are accepting.

**`wd responsive` says Playwright is missing.**
`npm i -D @playwright/test @axe-core/playwright && npx playwright install chromium`. Adding the
dependency goes through a brief like any other.

**The deep scan says it could not run.**
That is deliberate — a scan that did not run is not evidence. Fix `opengrep`/`semgrep`, or set
`security.opengrep` to `"off"` with `wd config set`.

**Maps look wrong after a branch switch.**
`wd maps --force`.

**A task is stuck awaiting approval.**
`wd task status` prints where the state machine is and `wd task hash` prints the hash to approve.

---

## Uninstalling

```bash
claude plugin uninstall web-dev@web-dev
claude plugin marketplace remove web-dev
```

To also remove the project state: delete `.claude/web-dev/`, the three `.claude/agents/web-dev-*`
files, `.claude/rules/web-dev-*.md`, the `@.claude/web-dev/CLAUDE.md` import line from `CLAUDE.md`,
and the `web-dev` block from `.claude/settings.json`. Your code is untouched — the harness never
writes application source.

---

## Developing the plugin

```bash
npm run setup                  # install the pinned parser into the user cache
npm test                       # node:test — 237 tests
npx playwright install chromium   # only needed for the responsive tests
claude plugin validate . --strict
```

The suite includes:

- **`wiring`** — every hook path, `${…}` placeholder and routed file resolves on disk; the
  `PreToolUse` matcher actually reaches MCP tools; every instruction file is inside its byte budget.
- **`gate`** — adversarial: heredoc-fed interpreters, nested shells, `git -C`, `git worktree add`,
  PowerShell writes, paths escaping the root, and the enforcement files.
- **`trigger`** — Ring 0 in empty, web, candidate and non-web directories; the watch list; the
  `/clear` loop.
- **`state`** — locking under real concurrency, HMAC approval integrity, the question ledger, the
  task classifier.
- **`security`** — 55 cases, each bug reproduced before it was fixed.
- **`maps`** — the four framework fixtures plus a measured map/source ratio on a realistic corpus.
- **`tools`** — proves the bundled opengrep ruleset loads and that every rule fires; skips cleanly
  where a binary is absent.
- **`responsive`** — a real server, a real browser, a real screenshot.

Releasing: bump `version` in `.claude-plugin/plugin.json`, commit, push, then
`claude plugin tag . --push`.

---

## Design notes

A few decisions that are easy to misread as arbitrary:

**Why no comments in code.** A comment carries no staleness guarantee — nothing checks that it is
still true. A note is hashed against the symbol's body, so when the body changes the note is marked
`STALE` and the task that changed it has to repair it. Moving explanations into notes is what makes
"the documentation is never wrong" enforceable instead of aspirational.

**Why the approval binds to a hash.** Otherwise "the user approved this" drifts: the brief gets
edited, the scope grows, and the approval silently covers work you never saw.

**Why the gate is at `PreToolUse`.** It is the only hook that fires before the permission system,
in every mode including `bypassPermissions`. A rule anywhere else is a rule that can be turned off.

**Why the filesystem is watched.** Gating tools means enumerating every way to write a file, and
that list is never complete. Watching the tree means an unauthorised write is *seen* even when it
was not prevented — and the turn audit can then refuse to close on it.

**Why three task classes.** Phase-gating a one-line CSS fix is the most-cited complaint against
this whole category of tooling, and a gate people route around protects nothing.

---

## Known limits

- **`/clear` cannot be forced.** No hook can clear or compact a conversation. The harness makes
  clearing free and tells you when it is time.
- **Static analysis cannot see authorization or business-logic flaws.** That is what the reasoned
  checklist and the reviewer are for, and why a clean scan is never reported as "secure".
- **PowerShell writes are refused, not parsed.** The command gate speaks POSIX shell; rather than
  guess at a cmdlet it cannot read, it refuses and points at Edit/Write.
- **`wd responsive` needs Playwright in the project** and a dev server it can reach.
- **The deep scan is silent unless `opengrep` or `semgrep` is installed** — and says so.
- **The extractor is pinned to `typescript@6.0.3`**, because TypeScript 7 removed the JavaScript
  compiler API it uses.

---

## License

MIT
