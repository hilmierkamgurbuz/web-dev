# web-dev

A Claude Code plugin that turns web development into a disciplined, verifiable loop. It covers new and existing projects in JavaScript/TypeScript: React, Next.js, Vue, Nuxt, Svelte/SvelteKit, Node, Express, NestJS, Fastify and Hono.

[Türkçe README](README.tr.md)

The model stays the same. What changes is the **harness** around it: what the model sees, what it may write, and what counts as done. Agent research in 2026 (NVIDIA's harness work among it) keeps showing that deterministic guardrails, explicit state on disk, a supervisor and distilled context matter more than prompt wording. web-dev packages those ideas for web work.

## What you get

- **Question-first intake.** The user's words are kept verbatim, and the AI's reading of them is confirmed. Every open point that changes the result is asked with 2–4 options, a recommendation and a one-line pro/con. Nothing is guessed.
- **An approved brief instead of plan mode.** One file holds the plan: goal, decisions, acceptance criteria, risks, tests and the exact manifest of files to write. The user approves it with a click. Editing it voids the approval.
- **Hook-enforced gates.** Writes outside the manifest, writes on the default branch, known vulnerability classes, added code comments, undeclared dependencies and destructive migrations are all blocked at write time. Everything changed during a turn is re-checked when the turn ends.
- **Maps that do not go stale.** Code, API, UI and data maps are rendered from the code plus short AI-written notes per function. Hashes on normalized function bodies mark exactly which notes need a refresh, and the Stop hook will not end a turn while notes are owed.
- **Frontend ↔ backend connection map.** Every route has its handler, auth, input schema, tables and frontend callers. Unmatched calls, unauthenticated mutations and unvalidated input surface as errors.
- **Responsive and accessibility checks.** Playwright visits each route at 360, 768 and 1440 px, reports overflow, small tap targets, small text, console errors and axe violations, and saves screenshots for review.
- **Supervisor review.** An independent read-only reviewer subagent checks the diff against the brief before the task can close.
- **Branch → PR → /clear.** Each task gets its own branch, descriptive commits, a push and a PR. When the Stop hook has verified everything, it closes the task and tells the user to `/clear`. All state lives on disk, so clearing loses nothing.

## Requirements

- Claude Code 2.1.200 or newer
- Node.js 20 or newer, and git
- Optional:
  - `gh` for PR checks
  - `gitleaks`, `opengrep` (or `semgrep`) and `osv-scanner` for deeper security scans
  - `@playwright/test` and `@axe-core/playwright` in the project for `wd responsive`

It runs on macOS, Linux and Windows. The hooks are Node scripts started in exec form, so no shell is involved.

## Install

This GitHub repository is both a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`) and the plugin itself (`.claude-plugin/plugin.json`, `SKILL.md`, `skills/`).

**Inside Claude Code**

```text
/plugin marketplace add hilmierkamgurbuz/web-dev
/plugin install web-dev@web-dev
```

If the install summary asks for it, run `/reload-plugins`.

**From a terminal**

```bash
claude plugin marketplace add hilmierkamgurbuz/web-dev
claude plugin install web-dev@web-dev
claude plugin list
```

**Pin a release** — add the marketplace from a release tag instead of `main`:

```bash
claude plugin marketplace add https://github.com/hilmierkamgurbuz/web-dev.git#web-dev--v1.1.0
```

**Update**

```bash
claude plugin marketplace update web-dev
claude plugin update web-dev@web-dev
```

After updating, run `/web-dev:init` again in each project so its hooks match the new version.

**Remove**

```bash
claude plugin uninstall web-dev@web-dev
claude plugin marketplace remove web-dev
```

**For a team** — `/web-dev:init` writes the following into the project's `.claude/settings.json`. Everyone who clones the repository and trusts the folder is then offered the marketplace and the plugin, so the hooks never run without the skill that explains them:

```json
{
  "extraKnownMarketplaces": {
    "web-dev": { "source": { "source": "github", "repo": "hilmierkamgurbuz/web-dev" } }
  },
  "enabledPlugins": { "web-dev@web-dev": true }
}
```

**From a local checkout**: `claude plugin marketplace add /path/to/web-dev`, then `claude plugin install web-dev@web-dev`.

## Use

- **New project:** describe the app. The skill runs `procedures/bootstrap.md`: product questions, stack choices with options, blueprint, scaffold, harness install, then the first feature.
- **Existing project:** ask to adopt it. `procedures/adopt.md` installs the harness, builds the maps, writes the notes with parallel subagents, drafts the blueprint for your confirmation, and reports a security baseline.

To activate web-dev in a project, open Claude Code in it and run:

```text
/web-dev:init
```

This checks Node and git, and installs the harness: hooks, agents, rules, config, maps and the pinned parser. It then tells you what to commit. Bootstrap and adoption use the same installer: `node ${CLAUDE_PLUGIN_ROOT}/scripts/init_project.mjs <project-root> --setup`.

After installing, start a new Claude Code session in the project and accept the trust dialog. Then check two things:
- `/hooks` lists SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, SubagentStart, SubagentStop and Stop.
- The `[web-dev]` report appears at session start.

## The task cycle

```
locate + intake → brief → approval → build → verify → close → /clear
```

1. **Locate** — the maps answer where the task lives, in a fixed order: index, blueprint, the layer map, the codemap shard, then line-range reads. A repo scan is never the first step.
2. **Intake** — the verbatim request, a restatement the user confirms, and question rounds until nothing is `[OPEN]`.
3. **Brief** — `.claude/web-dev/work/task.md` in the format from `gates/brief.md`.
4. **Approval** — one AskUserQuestion carrying the brief hash, or `APPROVE`/`ONAY` typed on its own line. Only the hook records it.
5. **Build** — on the brief's branch, only manifest paths, with notes written in the same turn and tests alongside the code.
6. **Verify** — `wd verify` (typecheck, lint, test, build), `wd responsive` for UI changes, `wd check`, and the reviewer subagent.
7. **Close** — postflight, commit, push, PR. The Stop hook re-checks everything from its own records, closes the task, and recommends `/clear`.

## Enforcement

| Hook | Does |
|---|---|
| SessionStart | Renders maps incrementally and injects a ≤2000-character report: enforcement, parser, git, task, map health, tools. Runs again after `/clear` and compaction. |
| UserPromptSubmit | Starts the turn record. Handles the typed approval token and detects plan mode. Recommends `/clear` when a task already closed in this session. |
| PreToolUse | **Edit/Write:** enforcement files, default branch, approved brief, manifest, then a security, secret, comment, migration and dependency scan of the resulting content. **Bash:** shell writes to source files, git safety (no commits on the default branch, no `--no-verify`, no force-pushing the default branch, destructive commands need the user), secret scan of staged changes, dependency gate, `curl \| sh`. **AskUserQuestion:** refuses pre-filled answers. |
| PostToolUse | Reports notes owed for the written file and records the approval answer. Re-renders maps after git operations, re-checks docs and dependency advisories after package changes, and records the PR URL. |
| SubagentStart | Gives every agent, the built-ins included, the map contract and the current map health. |
| SubagentStop | Records the reviewer's `VERDICT` bound to the current diff. |
| Stop | Re-scans every file changed during the turn, including shell writes, and blocks while notes are owed or a file changed outside the manifest. At `closing`, it verifies verification results, tests, responsive checks, `wd check`, the review, durable records, a clean pushed tree and an open PR. Repeated identical blocks become a message to the user after three attempts. |

Plan mode is denied as a tool, and worktree-isolated agents are refused. `.claude/agents/Explore.md` makes delegated searches map-first.

### Security rules

`WD-SEC-EVAL` · `WD-SEC-XSS-HTML` · `WD-SEC-SQL-INTERP` · `WD-SEC-CMD-INTERP` · `WD-SEC-TLS-OFF` · `WD-SEC-JWT` · `WD-SEC-CORS` · `WD-SEC-REDIRECT` · `WD-SEC-SSRF` · `WD-SEC-PATH` · `WD-SEC-PROTO` · `WD-SEC-RANDOM` · `WD-SEC-COOKIE` · `WD-SEC-PUBLIC-ENV` · `WD-SEC-SECRET` · `WD-SEC-HASH` · `WD-SEC-POSTMESSAGE` · `WD-SEC-MIGRATION` · `WD-DEP` · `WD-COMMENT`, plus map-level `WD-API-UNAUTH`, `WD-API-UNVALIDATED`, `WD-API-UNMATCHED` and `WD-DATA-MULTIWRITER`. Details are in `procedures/security.md`.

A finding can be accepted only through a `Security exceptions:` line in a brief the user approves. There are no inline suppressions.

## Maps

Rendered into `.claude/web-dev/maps/`, which is gitignored:

| Map | Answers |
|---|---|
| `index.md` | feature → shards, entry files, routes, pages, tables, status |
| `codemap-<shard>.md` | every file and named function/component/hook: signature, line range, imports, used-by, db access, calls, note |
| `apimap.md` | route ↔ handler ↔ auth ↔ input ↔ tables ↔ callers; unmatched, unresolved, dead, unauthenticated, unvalidated |
| `uimap.md` | page → layouts → component tree, client boundary, data, metadata, last responsive check |
| `datamap.md` | tables and in-memory stores with writers and readers; env surface and findings |

Notes are the only AI-written part. They live in `.claude/web-dev/notes/<shard>.md`, are committed, are written with `wd note set`, and are sorted by key so parallel branches rarely conflict.

## `wd` — the harness CLI

Run `node .claude/hooks/web-dev/wd.mjs <command>` from the project root.

| Command | Purpose |
|---|---|
| `maps [--force]` | render maps |
| `note set` / `note missing` | write notes from JSON lines / list owed notes |
| `task hash` / `task status` | brief hash for approval / state |
| `check [--draft-blueprint]` | blueprint, maps and docs consistency |
| `verify` | typecheck, lint, test, build; recorded for the Stop hook |
| `responsive [--path /x]` | Playwright viewport and accessibility check with screenshots |
| `scan <files>` / `scan --all --report` | security scan |
| `review-prep` | diff and context for the reviewer |
| `pr-body` | PR description from the brief and results |
| `facts check` / `id D\|R` / `setup` | stale facts, next id, parser install |

## Project files

| Committed | Gitignored |
|---|---|
| `CLAUDE.md` (imports `.claude/web-dev/CLAUDE.md`), `.claude/settings.json`, `.claude/hooks/web-dev/`, `.claude/agents/`, `.claude/rules/web-dev-*.md`, `.claude/web-dev/{product,stack,decisions,blueprint}.md`, `notes/`, `facts/`, `config.json`, `shards.json`, `enforce.json` | `.claude/web-dev/{maps,state,work,shots}/` |

`product.md` holds the lasting requirements (`R-###`). `stack.md` and `decisions.md` hold decisions (`D-###`), and `wd check` compares them with `package.json` and the lockfile. `facts/<pkg>@<version>.md` holds distilled, version-pinned framework facts that go stale when the lockfile moves. The task brief and postflight are deleted when the task closes, and their content lives on in the PR.

## Configuration

`.claude/web-dev/config.json` holds:
- `defaultBranch`, `git.remote` (`none` for local-only), `git.pullRequest`
- `commands.{typecheck,lint,test,build,dev}`, `devUrl`
- `responsive.{viewports,paths,minTapTargetPx,minFontPx}`
- `generated` globs, `authMarkers`, `validationMarkers`
- `approval.{labels,tokens}`, `comments.allowedPragmas`
- `security.{gitleaks,opengrep,osvScanner}` (`auto`/`off`)

Change it through a brief: the gate reads it.

## Developing the plugin

```bash
WEB_DEV_CACHE=/tmp/wd-cache node -e "import('./scripts/lib/ts.mjs').then(m => m.installParser())"
WEB_DEV_CACHE=/tmp/wd-cache node --test tests/
```

The parser is pinned (`typescript@6.0.3`, the last release with the JavaScript compiler API) and lives in a per-user cache. Map hashes therefore do not change when a project upgrades TypeScript. The fixtures in `tests/fixtures/` cover Next.js with Prisma, a Vite React + Express + Drizzle monorepo, Nuxt, and SvelteKit with tRPC.

## Known limits

- The shell-write check is a heuristic, not a full shell parser. Anything it misses is caught by the Stop hook's end-of-turn re-scan, but within a single turn there is a window.
- Logic-level vulnerabilities, such as a wrong authorization rule or a business-invariant bug, cannot be detected by patterns. The brief's risk section, the security checklist and the reviewer reduce them; they do not prove their absence.
- Unrecognized routing or client patterns land in `## Unresolved`. They are visible but not linked.
- If hooks are disabled (`disableAllHooks`) or the workspace is untrusted, no gate runs. The missing `[web-dev]` report is the signal, and the skill writes no code without it.

## License

MIT
