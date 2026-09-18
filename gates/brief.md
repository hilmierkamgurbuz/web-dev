# brief — the task plan, approved before any source file is written

`.claude/web-dev/work/task.md` is written in this format after locate and intake. It replaces plan mode. The hooks read it.

- The write gate allows a source file only if its path is listed under `## Manifest` and the brief is approved.
- Approval binds to the file's hash. Any edit to the brief voids approval, and the brief must be approved again.
- The hook refuses to record approval while the brief contains `[OPEN]`, lacks a required heading, or has no `Branch:` line.

## Format

```markdown
# Brief: <task name, 3-8 words>

## Request (verbatim)
> <the user's messages that define this task, copied exactly, in the user's language>

## Understanding
- Goal: <one sentence: the outcome the user wants>
- In scope: <bullets>
- Out of scope: <bullets — what will deliberately not change>
- Located: <locate step that answered> · feature: <sys from index/blueprint or NEW>
- Attachment point: <existing file/route/component this hangs off>

## Decisions
- Q: <question> → A: <answer> · by: <user | recorded D-### | recorded R-### | delegated>
  <one line per decision that shapes the code; `[OPEN]` while unanswered>

## Acceptance
- [ ] <observable, testable criterion stated in user terms>

## Design
- Data source: <data-source.md outcome or ->
- Render boundary: <render-boundary.md outcome or ->
- API contract: <METHOD /path · in schema · out type · auth · errors, or ->
- Ownership: <single writer for each written entity, or ->
- Cost: <cost model result for any per-frame/per-render/per-request work, or ->

## Risk
- Security: <threats considered for this change and how each is handled>
- Security exceptions: <rule-id | path | reason> or -
- Migrations: <destructive operations + data preservation plan> or -
- Dependencies: <package@range | purpose | alternatives rejected> or -
- Assumptions: <unverified facts + impact if wrong> or -

## Verification
- Tests: <test files and what each proves> or `none — <reason>` (only when the user approved no tests)
- Responsive: <route paths to check> or -
- Map repairs: <STALE/MISSING/ORPHAN/UNRESOLVED entries on this task's path> or -

## Git
- Branch: <feat|fix|refactor|chore|docs|test|perf>/<kebab-slug>

## Durable
- <D-### or R-### ids this task adds to decisions.md, stack.md or product.md> or -

## Manifest
- <exact project-relative path of a file to create or modify>
- generated: <glob of generator output this task produces>
```

## Rules

- `## Manifest` lists files to be written, with exact paths and no globs. The one exception is `generated:` lines, which cover output produced by a code generator the task runs, such as `prisma generate` or GraphQL codegen. Generated files skip the comment and code-pattern rules but are still secret-scanned.
- Reading is not restricted by the manifest, and harness documents (`CLAUDE.md`, `.claude/web-dev/**`, `.claude/rules/web-dev-*.md`) never need listing. Notes go through `wd note set`.
- Every `[OPEN]` is resolved by the user before approval. A decision the user delegates is written `by: delegated` with the recommended option.
- Security, Assumptions and Manifest are never shortened to fit. A brief that will not fit is two tasks.
- `Tests: none` needs the user's explicit approval, recorded in `## Decisions`.
- `.claude/web-dev/config.json` and `.claude/web-dev/enforce.json` can never be manifest paths: they decide what the gate enforces, so only the user edits them.
- Full example: `examples/01-brief.md`.

## Asking for approval

1. Run `wd task hash`. It prints the 8-character hash of the current brief.
2. Show the user, in their language:
   - the goal and the acceptance criteria, one line each;
   - **the whole `## Decisions` section, verbatim** — every question, its answer, and who
     decided it. Approving a brief means approving those decisions, so they are never
     summarized away or replaced by a count;
   - the manifest **as a list of paths**, marked `new` or `edit`, never as a count;
   - dependencies, security exceptions, migrations, and the branch.
3. Ask one AskUserQuestion:
   - question: `<one summary sentence in the user's language> [web-dev brief <hash8>]`
   - options: `Approve` (`Onayla` in Turkish) and `Revise`.
4. Only the hook records approval. On `Revise`, make the change, then ask again with the
   new hash — the old approval is already void.
5. If AskUserQuestion is unavailable, the user sends `APPROVE <hash8>` or `ONAY <hash8>`
   on a line of its own. A bare `APPROVE` is refused: approval names the exact version it
   approves, or it approves whatever happens to be on disk at that moment.

A `## Decisions` line marked `by: user` must correspond to a question the user actually
answered. The hook keeps a ledger of every AskUserQuestion round and refuses approval for
a brief that claims an answer the ledger does not have. Write `by: delegated` when the
user told you to decide, and `by: D-###` / `by: R-###` when a recorded decision answers it.
