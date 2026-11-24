---
paths: ["apps/mes/app/services/erp.ts", "packages/api/src/postings.ts"]
triggers: ["MES_POSTINGS", "ErpPostingInput"]
promoted: null
---
# Type a cross-app call by what the receiver accepts

**Context:** MES calls ERP postings over HTTP, and the ERP refuses any posting or `type` value that is not in `MES_POSTINGS`.

**Problem:** The first allowlist came from a hand inventory of the MES call sites and missed `issue`/`trackedEntitiesToOperation`. Every check passed. The miss would have shown only in production, as a 404 when a user issued tracked entities to an operation.

**Rule:** Derive the caller's input type from the receiver's allowlist (`ErpPostingInput`, `apps/mes/app/services/erp.ts`). Then a value that the receiver refuses fails the caller's typecheck. Keep casts out of those call sites, or check the values behind each cast by hand.

**Applies to:** `apps/mes/app/services/erp.ts`, `packages/api/src/postings.ts`, any other server-to-server contract.
