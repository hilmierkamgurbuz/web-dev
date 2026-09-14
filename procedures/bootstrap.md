# bootstrap — a new web project from nothing

Input: the user's description of the app. Output: the artifacts below, each approved by the user. Runs once. There is no reduced mode: an app this skill builds is built to ship.

## Outputs, in order

1. **Product intake** (`intake.md` rules). Ask rounds until these are answered or explicitly marked `[OPEN]`:
   - purpose and the problem it solves; users and roles
   - core flows (3–7, each as a sentence of user actions); launch scope and what is explicitly out of scope
   - target devices, browsers and minimum viewport; accessibility target (recommend WCAG 2.2 AA)
   - languages and locales; SEO need per area (public vs behind login)
   - authentication and roles; personal data handled and the jurisdiction (KVKK, GDPR)
   - data: main entities and expected sizes `n` (users, records per user, requests per minute)
   - integrations: payments, email, storage, third-party APIs
   - performance budget (recommend LCP < 2.5 s, INP < 200 ms, CLS < 0.1, API p95 < 300 ms); hosting constraints; team size and skills
2. **`product.md`** — written from the answers with `R-###` ids. Any `[OPEN]` field is shown to the user and resurfaces in the first brief that touches it.
3. **Stack decisions** (`tech-choice.md`), one decision at a time:
   - framework and rendering mode; styling and component library
   - database and ORM or query layer; authentication solution; validation library
   - unit/integration test runner and end-to-end runner (Playwright is the responsive gate's engine)
   - hosting and deployment target; package manager; monorepo or single package
   - Each decision becomes a `D-###` line in `stack.md`.
4. **`blueprint.md`** — features with one-directional arrows, the route inventory, the page inventory, the table inventory, and the folder layout. A two-way arrow is an ownership defect; resolve it with `ownership.md` before continuing. The folder layout and `.claude/web-dev/shards.json` describe the same tree, so they are decided together.
5. **Tooling offer** — ask whether to install the optional security tools:
   - macOS: `brew install gitleaks opengrep ast-grep osv-scanner`
   - elsewhere: the equivalent per the tool docs
   - Record the answer as a `D-###`. Without these tools the built-in scanner still gates every write, and the postflight shows deep scan as unavailable.
6. **Repository**:
   - `git init -b main`
   - Ask where the remote lives, with options: private GitHub repo via `gh repo create <name> --private --source . --remote origin`, public repo, existing remote URL, or local only.
   - Record the answer in `config.json` `git`.
7. **Scaffold** with the framework's official CLI in non-interactive mode, using the flags that match the decisions (for example `create-next-app`, `npm create vite@latest`, `npx nuxi init`, `npx sv create`, `npx @nestjs/cli new`):
   - Then install `typescript`, the test runner, `@playwright/test` and `@axe-core/playwright` as devDependencies.
   - Commit `chore: scaffold` on the default branch. This commit is the **baseline**: comment and pattern rules apply to changes after it, never to the generator's own output.
8. **Install the harness** with `node <skill dir>/scripts/init_project.mjs <project root>`:
   - It writes `.claude/settings.json`, the hooks, agents, rules, `config.json`, `shards.json`, `enforce.json` and the gitignore lines, and records the baseline.
   - Run `wd setup` once per machine to install the pinned parser.
   - Commit `chore: add web-dev harness`.
9. **Verify enforcement**:
   - The user starts a new Claude Code session in the project, because project hooks load at session start, and accepts the trust dialog.
   - `/hooks` must list SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, SubagentStart, SubagentStop and Stop.
   - The `[web-dev]` report must appear in context.
   - Do not start a feature task before all three hold.
10. **First maps**: run `wd maps` and `wd check`. On a fresh scaffold, the only findings should be INFO lines for blueprint folders not created yet. An ERROR here means the blueprint and the disk already disagree.
11. **First feature** follows the normal task cycle: branch, brief, approval, PR.

## Design contribution

This procedure is not secretarial work. Say so explicitly when:
- the launch scope is too large for the team and timeline
- a core flow has no error or empty state
- a requirement conflicts with the rendering or hosting choice
- personal data is collected without a stated purpose

The product decision belongs to the user. Once made, it is recorded and not re-argued.

## Rules

- Questions follow `intake.md`: nothing that is already answered, nothing that does not change the result, and irreversible choices always asked.
- Versions and CLI flags come from the current official docs or `npm view <pkg> version`, never from memory. Version-sensitive behavior is distilled into `facts/`.
- If the user orders a reduced setup, record the order and its consequence in `decisions.md`: without the harness installed, none of this skill's guarantees apply.
