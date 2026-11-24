---
paths: []
triggers: []
promoted: null
---
# A mock of a function in the same file does not intercept

**Context:** The migration moved callers into the same module file as the functions they call (2026-10-16).

**Problem:** `vi.mock` replaces a module's exports for importers in other files. A call from one function to another inside the same file goes to the real function, so tests that mocked the callee started calling the database, or passed while testing nothing.

**Rule:** Stub only a real boundary (the Supabase client, `fetch`, the clock), as `.claude/rules/testing.md` says. A test that only checks which internal functions were called gets deleted, not repointed.

**Applies to:** tests under `apps/erp/test/` and `apps/erp/app/modules/**`.
