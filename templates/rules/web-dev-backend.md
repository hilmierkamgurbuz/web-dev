---
paths:
  - "**/api/**"
  - "**/server/**"
  - "**/*.server.*"
  - "**/+server.*"
  - "**/controllers/**"
  - "**/services/**"
  - "**/middleware/**"
  - "**/actions/**"
  - "**/trpc/**"
  - "**/resolvers/**"
---

# Backend conventions (web-dev)

- Parse every input through a schema before use (`procedures/api-contract.md`).
- Authenticate, then authorize against the specific resource inside the owning module (`procedures/ownership.md`).
- Map domain objects to response types; never return raw rows.
- Use one error shape and correct status codes; no stack traces or internal messages leave the server.
- Multi-step writes run in a transaction. Retried mutations are idempotent.
- Outbound HTTP calls have timeouts and handle failure explicitly.
- Logs carry a request id and the outcome, never tokens, passwords or full personal data.
- Environment access goes through one validated config module, never through scattered `process.env` reads.
- <project-specific backend conventions agreed with the user>
