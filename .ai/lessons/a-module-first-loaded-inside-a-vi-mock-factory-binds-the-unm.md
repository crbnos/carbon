---
paths: []
triggers: []
promoted: null
---
# A module first loaded inside a `vi.mock` factory binds the unmocked module

**Context:** ERP unit tests mock `shared.service` with `importOriginal` and override `invokePosting`. `shared.service.ts` imports other module services (`resources`, `sales`, `production`), and they import it back.

**Problem:** `importOriginal` evaluates the real `shared.service`, and that evaluates its imports. A module whose first evaluation happens there binds the real `shared.service`, because the mock is not built yet. Its calls then skip the mock. A new import edge elsewhere (`inventory.service` → `production.service`) changed the load order and broke tests that had passed for weeks.

**Rule:** Before the module under test, load the service that makes the mocked call: `await import("../app/modules/<module>/<module>.service")`, with a comment that says why. If a mock does not intercept, check the import order first.

**Applies to:** `apps/erp/test/*.test.ts`, `apps/erp/app/modules/**/*.test.ts` that mock `shared.service`.
