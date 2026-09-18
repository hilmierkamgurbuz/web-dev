# adopt — bringing an existing web project under the harness

Input: a repository with code. Output: the harness installed, maps with notes, a reverse-engineered blueprint, `product.md` and `stack.md` confirmed by the user, and a security baseline report. Runs once per project.

## Steps

1. **Preconditions**:
   - Node ≥ 20 and a git repository.
   - If the working tree is dirty, ask whether to commit, stash, or stop. Never adopt on top of unknown uncommitted work.
2. **Branch**: `git switch -c chore/web-dev-adopt`. Adoption is delivered as a PR like any other task.
3. **Install**: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/init_project.mjs <project root> --setup`. This is the same installer as `/web-dev:init`; `--setup` installs the parser if this machine lacks it. It:
   - prints a detection report: frameworks, package manager, workspaces, the scripts found for typecheck/lint/test/build/dev, test runners, ORM, auth libraries and Playwright
   - records the current HEAD as the baseline
   - writes the `wd` shim, the project state and the gitignore lines. It installs no hooks: the gates ship with the plugin and have been running since this session started. What `.claude/web-dev/` adds is the project state they enforce against — which takes effect immediately, with no session restart.
4. **Confirm detection** with questions:
   - Commands the report could not find are asked, with options derived from `package.json` scripts.
   - The user's language is asked if unclear.
   - Record each answer with `wd config set <key> <value>` (for example `wd config set commands.test "npm test"`). `config.json` decides what the gate enforces, so the write gate refuses a direct edit: the command is the supported way, and it refuses a key the file does not already define.
5. **Enforcement check**: the very next tool call is already gated. Confirm it by running `wd task status`: if it answers, the CLI and the state are wired. The full `[web-dev]` line appears from the next session on. If `/hooks` shows nothing from web-dev, the plugin is disabled — stop and say so.
6. **Mechanical maps**: `wd maps`. Report the counts it prints: files, symbols, routes, tables, unresolved calls.
7. **Notes scope** — ask with options. Symbols with no note yet are reported as `MISSING`, which is a normal state for an adopted repository: it never blocks and never marks a map `DEGRADED`. Notes are owed only for files a later task writes.
   - `All symbols now (Recommended)` — `+` every map is complete immediately · `−` token cost of roughly (symbols × 30) output tokens across subagents
   - `K1 files and the API/data layer first, the rest when a task touches them` — `+` cheaper start · `−` UI and leaf files show `MISSING` until touched; `wd note missing` stays non-empty, which is expected and declared
8. **Write the notes**. For each shard, dispatch one `web-dev-annotator` subagent in parallel with the shard name:
   - It reads that shard's codemap and the needed source ranges.
   - It writes notes through `wd note set`.
   - It returns only counts and any symbols it could not describe confidently.
   - Keep each annotator to a single shard, so no context holds the whole codebase.
9. **Blueprint draft**: `wd check --draft-blueprint` prints inventories of routes, pages, tables and top-level folders.
   - Propose features, their arrows and `sys` names from the maps.
   - Ask the user to confirm or correct the feature boundaries.
   - Write `blueprint.md`, then update the notes' `sys` fields to match with `wd note set`.
10. **Product intake**:
    - Propose the product purpose, roles and core flows as read from the routes and pages, and ask the user to confirm.
    - Ask the remaining `bootstrap.md` step 1 topics that the code cannot answer (devices, accessibility target, performance budget, personal data, SEO).
    - Write `product.md`.
11. **Stack record**:
    - Write the detected stack into `stack.md` as `D-###` lines marked `pre-existing`.
    - Gaps become questions through `tech-choice.md`: no test runner, no validation library, no e2e runner, no lint.
    - Offer the optional security tools as in `bootstrap.md` step 5.
12. **Security baseline**: `wd scan --all --report` summarizes findings in existing code by rule and file.
    - Existing findings are not blocked; the gate applies to code written from now on.
    - Ask whether to turn the findings into follow-up tasks, and list them in the postflight's Follow-ups.
13. **Close as a task**: postflight, commit, push, and PR. Then recommend `/clear`.

## Rules

- Adoption never rewrites application code. Fixes found during adoption become separate tasks with their own briefs.
- Notes describe what the code does today, not what it should do. A suspected bug goes into Follow-ups, not into a note.
- Unresolved API calls stay visible in `apimap.md`. Do not hide them by guessing a route.
