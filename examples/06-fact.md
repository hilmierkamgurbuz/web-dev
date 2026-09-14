# Example: a facts file

Facts are the cache-miss ratchet. Version-specific framework behavior the code relies on is fetched once from the official source, distilled here, and read from here afterwards. Each block is about 60–100 tokens.

File: `.claude/web-dev/facts/react@19.1.0.md`. The version is the exact lockfile version when the fact was distilled.

```markdown
# react@19.1.0

## ref-as-prop
- FACT: Function components receive `ref` as a regular prop; wrapping new components in `forwardRef` is unnecessary.
- APPLIES: function components that expose a DOM node or imperative handle to a parent.
- INVERSE: a package that must still support React 18 keeps `forwardRef`; check the package's peerDependencies before removing it.
- SOURCE: https://react.dev/blog/2024/12/05/react-19 — "ref as a prop", read 2026-09-14
```

Rules:
- One `##` block per fact. FACT is a single verifiable statement. APPLIES says when it matters. INVERSE names the context where it does not hold, so the fact is not over-applied. SOURCE is a URL plus the section and the date it was read.
- `wd facts check` compares every facts file's version with the lockfile. A major or minor change marks the file `STALE`: re-verify each block against the source before relying on it, then rename the file to the new version. A patch change is reported as INFO.
- Never write a fact from memory. If the source cannot be fetched, the question goes to the user instead.
