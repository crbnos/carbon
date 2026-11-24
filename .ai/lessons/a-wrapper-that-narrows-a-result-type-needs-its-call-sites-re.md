---
paths: []
triggers: []
promoted: null
---
# A wrapper that narrows a result type needs its call sites re-read, not re-cast

**Context:** Replacing the free-function storage helpers
(`listCompanyPrivateObjects` and friends) with a fluent
`storage(client).company(id)` client in `@carbon/files`. The old helpers
returned `{ data: StorageFileLike[]; errors: [] }` — `data` never null, entries
structurally typed — so ~10 call sites carried `as FileObject[]` /
`as unknown as StorageItem[]` casts to recover the real supabase fields. The
new client returns supabase's own `{ data: FileObject[] | null; error }`.

**Problem:** Every one of those casts still compiled, and now silently asserted
away a `null` the wrapper had just introduced. `(result.data as FileObject[]).map(...)`
typechecks and throws at runtime the first time a company bucket errors —
exactly the case the legacy-fallback window makes likely. A cast written to
paper over a WIDER type keeps compiling when the type gets NARROWER, and TS
reports nothing.

**Rule:** When a refactor changes a shared helper's return type, grep its call
sites for casts on the changed field BEFORE trusting a green typecheck — a cast
is a silenced diagnostic, so the compiler cannot tell you it is now wrong.
Delete the cast and let the type flow; if the new type is right, the cast was
load-bearing only for the old one.

**Applies to:** `packages/files/src/storage.ts` (`CompanyBucket`), its ~60 call
sites across `apps/erp`, `apps/mes`, `packages/{jobs,ee,lib}`, and any future
change to a helper whose result is destructured widely.
