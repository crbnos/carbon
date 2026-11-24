---
paths: ["packages/query/src/useLiveList.tsx", "packages/query/src/cache.ts"]
triggers: ["indexedDB", "IndexedDB", "localStorage", "setClientCompanyId"]
promoted: null
---
# A stored copy of server data belongs to a user, not a browser

**Context:** The live lists (items, customers, suppliers, people) were kept in IndexedDB under `<list>:<companyId>` and patched from a change log.

**Problem:** The rows a user holds are their RLS view. The next person to sign in on that browser hydrated the previous user's rows, and patching only the changed ids never removed them. The in-memory query cache had the same hole inside one tab.

**Rule:** Key anything stored on the device by user as well as company, and empty the in-memory cache when the user changes (`setClientCompanyId(companyId, userId)`). A cache that is only ever patched needs a path that replaces it.

**Applies to:** `packages/query/src/useLiveList.tsx`, `packages/query/src/cache.ts`, any new client-side persistence.
