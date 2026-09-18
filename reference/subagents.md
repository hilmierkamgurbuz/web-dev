# subagents — what they are for and what they are not

Settings and plugin hooks fire inside subagents too, so a subagent cannot write outside the
manifest. The `SubagentStart` hook gives every agent, including the built-ins, the map order
and the current health.

Default to a single agent. A subagent is worth its cost only for work that is genuinely
parallel, or that must run without the implementation session's reasoning in context.

| Agent | Role | Model |
|---|---|---|
| `Explore` (override) | map-first locator; follows `procedures/locate.md` and reports the step it stopped at | sonnet |
| `web-dev-reviewer` | reads only the diff from `wd review-prep` and the approved brief; returns `VERDICT: PASS` or `VERDICT: FAIL` | sonnet |
| `web-dev-annotator` | writes notes for one shard at a time during adoption or a bulk repair, so no single context holds the whole codebase | sonnet |

Rules that make them useful rather than expensive:

- Each one gets an explicit objective, the output format, which sources to use, and where
  its task stops.
- It writes its findings to disk itself and returns a short status line. The parent never
  sees more than the final text, so routing large content through the parent wastes tokens.
- `AskUserQuestion` is stripped from every subagent. Every question to the user is asked by
  the main agent.
- The reviewer reports only gaps that affect correctness or a stated requirement, never
  style. Its verdict is bound to the diff hash: change the diff and the verdict expires.
- A reviewer told to find problems will find some even when the work is sound, so its
  findings inform the closing suite and are not automatically blocking.
- Delegated searching is still searching: the postflight reports the locate step the
  subagent stopped at.
