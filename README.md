# web-dev

A Claude Code plugin that turns web development into a harness rather than a conversation.
The model does not change. What changes is what it sees, what it is allowed to write, and
what counts as done.

Install it once, and it is running in every directory on the machine — including an empty one
you are about to start a project in.

[Türkçe](README.tr.md)

## What you get

- **It engages by itself.** The plugin ships its own hooks, so the harness looks at every
  directory you open: an empty folder where you ask for a site, a five-year-old Next.js repo,
  or a Python project it should stay out of. No per-project setup step stands between you and
  the first gate.
- **Questions before code.** Anything that is not in your words or in the project files becomes
  a question with options and trade-offs, not a guess. A hook records every question you were
  asked, and a brief that claims an answer you never gave cannot be approved.
- **A brief instead of plan mode.** One approved file describes the task: the goal, the
  decisions, the acceptance criteria, the exact files that may be written, and the branch.
  Approval is bound to that file's hash — edit it and approval is void.
- **Ceremony that scales.** A one-line CSS fix does not pay for a schema migration's process.
  Three classes (`touch`, `task`, `arch`) decide how much of the cycle runs.
- **Gates that hold.** Manifest, security, comment, default-branch and dependency rules are
  enforced at `PreToolUse`, which fires before any permission check in every permission mode —
  including `bypassPermissions`. A watcher on the source tree sees writes that never went
  through a tool at all: `sed -i`, `>`, `tee`, a generator, or your own editor.
- **Maps that do not lie.** Code, API, UI and data maps are rendered from the code and merged
  with per-symbol notes. A note whose symbol changed is marked `STALE`, and the marker is
  cleared by repairing it, never by deleting the entry.
- **A context that stays small.** Everything lives on disk, so `/clear` between tasks loses
  nothing. The next session reads its own state back and, if you queued follow-ups, offers
  them without being asked.

## Requirements

| | |
|---|---|
| Node | 20 or newer |
| git | any recent version |
| Claude Code | 2.1.200 or newer |
| OS | macOS, Linux, Windows |
| Optional | `gh` for PRs · `@playwright/test` for responsive checks · `gitleaks`, `opengrep`, `osv-scanner` for deeper scanning |

## Install

```bash
claude plugin marketplace add hilmierkamgurbuz/web-dev
claude plugin install web-dev@web-dev
```

That is the whole installation. The hooks are live in the next session, everywhere.

Then, once per machine, install the pinned TypeScript parser the maps are built with:

```bash
claude   # in any project
> /web-dev:init
```

or directly:

```bash
node ~/.claude/plugins/cache/web-dev/web-dev/*/scripts/init_project.mjs . --setup
```

### Adopting a project

Open Claude Code in the repository and say what you want to build or change. The harness sees
a JavaScript/TypeScript project without its state and routes you through adoption: it detects
the stack, builds the maps, reverse-engineers a blueprint, asks you to confirm the product and
stack records, and delivers the whole thing as a pull request.

For a new project, open Claude Code in an empty directory and describe the app. Intake comes
first, then the stack decisions, then the scaffold.

## Use

Say what you want. There is no command to remember.

```
build me a landing page for a bakery, with a contact form
add Stripe checkout to the cart
the build is broken after the last install
continue where we left off
```

Slash commands exist for the two things worth being explicit about:

| Command | Does |
|---|---|
| `/web-dev:init` | install or refresh the project state in the current repository |

## The task cycle

```
locate → intake → brief → approval → build → verify → close → /clear
```

| Step | What happens |
|---|---|
| locate | The maps say where the task lives. `wd map <path>` returns one file's entry, not a whole shard. |
| intake | Your request is kept verbatim, restated back to you, and every ambiguity that would change the result becomes a question with options. |
| brief | `.claude/web-dev/work/task.md`: goal, decisions, acceptance criteria, design, risk, verification, branch, manifest. |
| approval | You see the decisions and the file list, then approve one question carrying the brief's hash. |
| build | Only manifest paths, only with Edit/Write, on the task branch, notes written in the same turn. |
| verify | `wd verify` runs typecheck, lint, tests and build. UI changes run `wd responsive` at every viewport. |
| close | Postflight, commit, push, PR. The Stop hook re-checks everything and only then reports the task closed. |
| /clear | State is on disk. Clear, and the next session picks up where this one stopped. |

`touch` tasks skip intake, the brief and the PR ceremony. `arch` tasks add a mandatory question
round and a clean-context review.

## Enforcement

Two rings, both shipped with the plugin.

**Ring 0** runs in every directory: `SessionStart`, `UserPromptSubmit`, `CwdChanged`, `PreCompact`
and the write half of `PreToolUse` decide whether this is web-dev territory at all. In an
unadopted directory they only look and route — the one thing they can do is *ask* before the first
write to web source. In a Python repo they say nothing and cost nothing (45 ms of process, no
tokens). In an adopted project the same `SessionStart` also refreshes the maps and the `wd` shim.

**Ring 1** arms when `.claude/web-dev/` exists and returns in milliseconds when it does not:

| Hook | Does |
|---|---|
| `PreToolUse` | blocks out-of-manifest writes, vulnerable patterns, added comments, undeclared dependencies, destructive migrations, default-branch commits, interpreters fed a program on stdin, and writes outside the project root |
| `PostToolUse` | records writes, approvals and the question ledger |
| `PostToolBatch` | one map render per batch, and the notes still owed |
| `FileChanged` | sees every filesystem change, including those no tool made |
| `PermissionRequest` | silently allows the harness's own commands and nothing else |
| `PostToolUseFailure` | turns a common tool error into the one next step that fixes it |
| `SubagentStart` | hands every subagent the map order and the current health |
| `SubagentStop` | records the reviewer's verdict, bound to the diff it reviewed |
| `Stop` | the closing audit: verification, tests, responsive, review, records, PR — each bound to a hash that expires when the code changes |
| `PreCompact` | pins the brief, manifest and locate result into the compaction summary |
| `ConfigChange` | refuses a mid-task edit to the files that decide what is enforced |
| `SessionEnd` | saves the task state |

A gate that fails is a gate that blocks: if the hook itself errors, the tool call is denied
rather than let through unchecked.

### Security

Enforced rules are taint-based — they fire on data a user controls reaching a dangerous sink,
not on shape. Injection, XSS sinks, path traversal, SSRF, prototype pollution, open redirect,
weak crypto, JWT `none`, TLS off, CORS with credentials, insecure cookies, client-exposed
secrets and hardcoded credentials all block at write time.

What no pattern can decide — authorization, business logic, CSRF, rate limiting, CSP, fail-open
error handling — lives in the brief's reasoned checklist and the reviewer's pass. A clean scan
is a floor, never a ceiling, and the harness says so rather than implying otherwise.

## Maps

Rendered into `.claude/web-dev/maps/`, gitignored, rebuilt on demand. They merge mechanical
facts from the code with the notes you and the model write, which are committed.

| Map | Answers |
|---|---|
| `index.md` | feature → shards, entry files, routes, pages, tables, status |
| `codemap-<shard>.md` | every named symbol, its signature, line range, imports, used-by, db access, calls and note |
| `apimap.md` | route ↔ handler ↔ auth ↔ input schema ↔ output ↔ tables ↔ frontend callers |
| `uimap.md` | route → layout → component tree, client/server boundary, data fetching |
| `datamap.md` | tables, relations, readers and writers, single-writer check, env surface |

On a real codebase the maps cost about a tenth of the source they describe. Read them with
`wd map <path>` or `wd find <symbol>` rather than opening a shard.

## `wd` — the harness CLI

Run from the project root as `node .claude/web-dev/wd.mjs <command>`.

| Command | Does |
|---|---|
| `map <path>` / `find <symbol>` | one file's or one symbol's map lines |
| `class` | the task class from the locate result |
| `defer "<item>"` | queue something out of scope for after `/clear` |
| `maps` | re-render every map |
| `note set` / `note missing` | write notes from stdin JSON / list the ones still owed |
| `task hash` / `task status` | the brief hash / the state machine position |
| `check` | blueprint ↔ disk ↔ maps, docs ↔ package versions |
| `verify` | typecheck, lint, test, build |
| `responsive` | every configured viewport, with screenshots |
| `scan` | security, secret and comment scan |
| `review-prep` / `pr-body` | the reviewer's diff / the PR body |
| `config set <key> <value>` | change one key `config.json` already defines; the gate reads that file, so it is never hand-edited |
| `id D` / `id R` | the next free decision or requirement id |
| `facts check` | facts whose pinned version no longer matches the lockfile |
| `setup` | install the pinned parser for this machine |

## Project files

| Committed | Generated |
|---|---|
| `CLAUDE.md`, `.claude/settings.json`, `.claude/agents/`, `.claude/rules/web-dev-*.md`, `.claude/web-dev/{product,stack,decisions,blueprint}.md`, `notes/`, `facts/`, `config.json`, `enforce.json`, `shards.json` | `.claude/web-dev/{maps,state,work,shots}/`, `wd.mjs`, `statusline.mjs` |

`enforce.json` is what arms the gate in every clone. `config.json` decides what the gate
enforces, so neither can be changed through a brief — only by you.

## Configuration

`.claude/web-dev/config.json` holds the default branch, the package manager, the verification
commands, the responsive viewports, the auth and validation markers the map recognises, the
approval labels and tokens, the allowed comment pragmas, and which optional security tools to
use. `.claude/web-dev/shards.json` maps path patterns to codemap shards and caps a shard's
size.

## Developing the plugin

```bash
npm run setup   # install the pinned parser into the user cache
npm test        # node:test — gate, security, maps, notes, state, wiring
```

`npm test` includes an adversarial suite: every bypass the audit found has a test that tries
it, and a wiring test asserts that every hook path, placeholder and routed file actually
resolves on disk.

## Known limits

- The harness cannot run `/clear` for you — no hook can. It makes clearing free, tells you when
  it is time, and picks the next task up on the other side.
- `wd responsive` needs `@playwright/test` in the project.
- The deep scan is silent unless `gitleaks`, `opengrep` or `osv-scanner` are installed.
- Static analysis cannot see authorization or business-logic flaws. That is what the reasoned
  checklist and the reviewer are for.

## License

MIT
