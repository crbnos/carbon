---
paths: ["packages/query/src/cache.ts", "apps/*/app/routes/x+/_layout.tsx"]
triggers: ["document.cookie", "getCompanyId", "setClientCompanyId"]
promoted: null
---
# `getCompanyId()` read an httpOnly cookie in the browser and always returned null

**Context:** The client cache scoped its keys with `getCompanyId()`, which parsed `document.cookie` for `companyId`.

**Problem:** That cookie is httpOnly, so JavaScript never sees it. Every key was scoped to the string `"null"`, and an invalidation that matched on the real company id matched nothing. It went unnoticed because a company switch reloads the page and empties the in-memory cache.

**Rule:** Never read a session cookie from `document.cookie`. A value the browser needs comes from loader data: the shell layout calls `setClientCompanyId(company.id)` during render (`@carbon/query/cache`).

**Applies to:** `packages/query/src/cache.ts`, both `apps/*/app/routes/x+/_layout.tsx`, any new client-side tenant scoping.
