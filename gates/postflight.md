# postflight — end-of-task audit

Write `.claude/web-dev/work/postflight.md` when the build is complete. It moves the task to `closing`; the Stop hook then re-verifies every machine-checkable item from its own records and closes the task only when all of them hold. The Y/N marks are your report — the hook trusts its records, not your marks.

Writing it is not what starts the audit. The same checks arm when the task branch carries commits and the turn ends claiming the work is done, so skipping postflight does not skip the audit: it only means the audit tells you what is missing instead of you listing it. A `touch` writes none; its close is `wd verify` plus the notes it owes.

Each item is Y or N. There is no "partially": partially is N, and every N needs a reason.

## Format

```markdown
# Postflight: <task name>

- [Y/N] Brief honored — only manifest paths were written; every acceptance criterion is met (evidence below)
- [Y/N] Located, not scanned — locate stopped at step <n>; delegated searches stopped at step <n or ->
- [Y/N] Questions closed — no [OPEN] remains; durable answers promoted: <ids or ->
- [Y/N] Security — touched files scan clean; exceptions used: <ids or ->; logic risks from the brief handled: <how>
- [Y/N] Tests — `wd verify` → `<quoted summary line>`
- [Y/N] Responsive — `wd responsive` → `<quoted summary line>` or `no UI change`
- [Y/N] Maps — `wd note missing` → `<quoted line>`; `wd check` → `<quoted "n error(s), m warning(s)" line>`
- [Y/N] Review — web-dev-reviewer → `<quoted VERDICT line>`
- [Y/N] Git — branch `<name>`, pushed, PR `<url>`
- [Y/N] Clean code — no comments added, no dead code, no debug output, no TODO left

## Acceptance evidence
- <criterion> — <test name, screenshot path, or verified behavior>

## Follow-ups
- <anything discovered but out of scope, proposed as a future task> or -

For every N: <one-line reason + what happens next>
```

## What the Stop hook checks at `closing`

Each item is checked in order, and the first failure is returned as the reason the turn cannot end.

1. `wd verify` has a recorded result for the current tree, and it passed.
2. If source behavior changed, a test file changed too, unless the brief records user-approved `Tests: none`.
3. If UI files changed, `wd responsive` has a recorded passing result for the current UI hash.
4. `wd note missing` is empty, and `wd check` reports 0 errors.
5. A `VERDICT: PASS` from web-dev-reviewer is recorded for the current diff.
6. Every id under `## Durable` exists in `product.md`, `stack.md` or `decisions.md`.
7. The tree is clean, the branch is pushed, and a PR is open for it.

Failures caused by infrastructure — no network, `gh` not authenticated, the dev server not starting — do not block. They are reported to the user with the manual step to take.

When every check passes the hook clears the task files, marks it closed, and shows the PR link with a `/clear` recommendation — anything queued with `wd defer` is offered in the next session. Repeat that recommendation in your final message.

## Rules

- Quoted lines are copied from command output, never paraphrased.
- An N does not close the task. Fix it, or escalate it to the user with the reason.
- Full example: `examples/02-postflight.md`.
