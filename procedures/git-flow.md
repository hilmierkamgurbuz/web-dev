# git-flow — branch, commits, push and PR for every task

The Stop hook will not close a `task` or `arch` until the branch is pushed and its PR is open, unless `config.json` `git.remote` is `none` (a local-only decision recorded by the user).

A `touch` still gets its own branch and its own commit — a one-line fix on the default branch is still a change nobody reviewed — but it does not open a PR unless the user asks. Everything below applies to it except the PR section.

## Start

1. Begin from an up-to-date default branch: `git switch <default>` then `git pull --ff-only`.
   - If local changes block the switch, ask whether to commit them to their own branch, stash them, or stop.
2. After approval, create the brief's branch: `git switch -c <type>/<slug>`.
   - `type`: `feat`, `fix`, `refactor`, `perf`, `test`, `docs` or `chore`.
   - `slug`: kebab-case, 2–5 words.
3. The gate refuses source writes on the default branch. Creating a branch is always allowed.

## Commits

- Commit at each coherent step that leaves the project building: a schema and its migration, an endpoint and its tests, a component and its styles.
- Format — Conventional Commits:

```
<type>(<scope>): <imperative summary, ≤ 72 chars>

<why this change, what it enables, in 1–4 lines>

Refs: <R-### / D-### ids, if any>
```

- `scope` is the feature `sys` from `blueprint.md`.
- Stage explicit paths. Never stage `.env*`, `.claude/web-dev/state/`, `.claude/web-dev/work/`, screenshots or build output.
- Never use `--no-verify`, never amend a pushed commit, and never commit secrets. The commit gate scans the staged diff.
- Harness files changed by the task (notes, `blueprint.md`, `product.md`, `stack.md`, `decisions.md`, `facts/`) are committed with the code they describe.

## Before the PR

- `wd verify`, `wd responsive` (for UI changes), `wd check`, and the reviewer have passed for the current tree.
- If the default branch moved, `git fetch` then `git rebase origin/<default>`, re-run `wd verify`, and resolve conflicts:
  - Map conflicts in notes files are resolved by keeping both keys and re-running `wd note missing`.
  - Push the rebased branch with `git push --force-with-lease` only; never force-push the default branch.

## Push and PR

1. Push: `git push -u origin <branch>`.
2. Build the PR description with `wd pr-body`. It prints the body and also writes it to `.claude/web-dev/work/pr-body.md`.
3. Create the PR: `gh pr create --base <default> --head <branch> --title "<type>(<scope>): <summary>" --body-file .claude/web-dev/work/pr-body.md`.
4. If a PR already exists, update it: `gh pr edit <number> --body-file .claude/web-dev/work/pr-body.md`.
4. Do not merge unless the user asks. Merging and deploying are the user's decisions.

## Close

- The Stop hook confirms the tree is clean, the branch is pushed, and the PR is open, then closes the task.
- Your final message gives the PR URL, one line per acceptance criterion, and the recommendation to run `/clear` before the next task.

## No remote

If the user chose local-only, `git.remote` is `none`: commits still happen on the task branch, the push and PR steps are skipped, and the final message says the branch is ready to merge locally.
