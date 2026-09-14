---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/__tests__/**"
  - "e2e/**"
  - "tests/**"
  - "test/**"
---

# Test conventions (web-dev)

- Every acceptance criterion in the brief maps to at least one test, or to a named verification step when a test is impossible.
- Test behavior through public interfaces, not implementation details. A test fails for exactly one reason.
- Test names state the behavior: `rejects a shipped order with 409`.
- Deterministic: no real network (mock at the boundary), fake timers for time, seeded data, no dependency on test order.
- Authorization and validation paths are tested, not only the happy path.
- End-to-end tests cover core flows from `product.md`, using role and label selectors, never CSS classes.
- A test that would still pass with the feature removed is not a test; check by reasoning or by temporarily breaking the code.
- <project-specific test conventions agreed with the user>
