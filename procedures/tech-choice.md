# tech-choice — choosing a framework, library, service or tool

**Decision type:** which technology fills a need.

## What must be known

- The requirement it serves (`R-###` in `product.md`). A tool without a requirement is not chosen.
- The existing stack (`stack.md`). A second tool for a job the stack already covers needs a reason.
- Constraints: hosting and runtime (edge, serverless, node server, static), license, data residency, budget.
- Team familiarity. Ask if it is not recorded.
- Current facts: latest stable version, release activity, breaking changes. Get them from `npm view <pkg> version time --json` and the official docs, never from memory. Distill what matters into `facts/<pkg>@<version>.md`.

If a requirement or constraint is missing, it is asked first.

## Criteria, in priority order

1. **Requirement fit** — SSR/SEO, realtime, offline, file handling, i18n, accessibility support.
2. **Constraint fit** — runs on the chosen hosting, license compatible, data stays where it must.
3. **Security record** — maintained, patched quickly, no open critical advisories (`osv-scanner` or `npm audit` when available).
4. **Maintenance** — a release within the last 12 months, active issue triage, not deprecated in favor of a successor.
5. **Team familiarity** — lower risk and faster delivery.
6. **Cost at `n`** — pricing tiers or runtime cost at the scale in `product.md`.
7. **Exit cost** — how hard it is to replace later, and how much of the codebase it touches.

## Presenting the choice

- 2–4 realistic options, the recommended one first with `(Recommended)` in the user's language.
- Each option: `+ <decisive benefit> · − <decisive cost>`, grounded in the criteria above.
- If one option clearly dominates, still show the runner-up. The user must see what is being given up.
- Ask with AskUserQuestion. Never pick silently.

## Recording

`stack.md` line:

```
D-### | <area> | chosen: <pkg or service>@<version range> | rejected: <alt> (<reason>), <alt> (<reason>) | why: <one line> | date: <YYYY-MM-DD>
```

- If the choice adds a package, it goes into the current brief's `Dependencies:` line. The gate refuses installs that are not declared there.
- Version-sensitive behavior the code will rely on — caching defaults, routing conventions, auth callbacks — becomes a facts file before code is written against it.

## Forbidden outcomes

- A dependency for something the platform or the existing stack does in under ~30 readable lines.
- Two libraries for the same job, such as two date libraries, two HTTP clients or two form libraries.
- A package with no release in 12+ months, or an open critical advisory, without the user explicitly accepting the risk as a recorded decision.
- A choice based on a version or an API recalled from memory without checking.

## Boundary case (not an exit)

If the user insists on an option the criteria rank low, record their decision together with the concern:

```
D-### | … | why: user preference; concern: <risk> accepted
```

It is not re-argued later.
