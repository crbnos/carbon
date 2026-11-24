---
paths: []
triggers: []
promoted: null
---
# In a bulk API sweep, a 4xx carrying a service's generic fallback string is a finding, not a pass

**Context:** The 1,495-operation API sweep triaged all 274 WRITE-op 400s as "reached the DB, expected FK rejections" and flagged only 500s. `inventory_insertManualInventoryAdjustment` came back 400 with `"Failed to create manual inventory adjustment"` and was waved through — but that string is the service's FALLBACK for an edge-function error whose real message was suppressed. A customer later hit exactly this: the published schema advertised 12 `adjustmentType` values (the validator spread `itemLedgerTypes` into its enum) while the `post-inventory-adjustment` edge function accepts 5, so every LLM-guided "add stock" call failed undiagnosably.

**Problem:** Bucketing sweep results by status code alone treats "the request was validly rejected" and "the error was swallowed somewhere in the chain" as the same outcome. The ops most likely to be broken-by-contract-drift are precisely the ones that fail with a generic message, because the generic message IS the symptom of a suppressed real error.

**Rule:** When triaging sweep failures, grep the response bodies for known fallback strings (`"Failed to *"` service fallbacks, `getErrorMessage` fallback arguments) and treat each match as a defect to root-cause: either the advertised schema disagrees with the actual acceptor (enum/shape drift between a `.models.ts` validator and a server function's `input` schema), or an error-sanitization layer is eating a legible message. Published-schema enums must be exactly what the write path accepts — never a wider "domain" enum reused for convenience.

**Applies to:** API/MCP sweep scripts, `apps/erp/app/modules/*/[a-z]*.models.ts` validators that feed posting wrappers, `packages/api/src/errors.ts`, `packages/utils/src/errors.ts`.
