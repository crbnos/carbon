---
paths: []
triggers: []
promoted: null
---
# A client swap can change runtime value types (Kysely once returned NUMERIC as a string)

**Context:** `upsertQuoteLinePrices` was converted from supabase-js to a Kysely transaction so its delete + reinsert would roll back as a unit. The conversion typechecked, and the shipped result silently stopped preserving `shippingCost`, `discountPercent` and `leadTime` on every markup change.

**Problem:** The function keys the snapshot of existing rows by quantity and looks each one up while building the reinsert. Through PostgREST a `NUMERIC` column arrives as a JS `number`, so `pricesByQuantity[10]` matched. Through node-postgres — which Kysely uses — the same column arrives as the string `"10.00000"`, because pg does not parse `NUMERIC` (oid 1700) to float and this repo sets no `setTypeParser` anywhere. Every `Map.get(10)` therefore missed, `existing` was always `undefined`, and each preserved field fell back to the caller's value: shipping to the column default `0`, discount and lead time to the zeros the recalculate route passes. The generated types say `number` on both paths, so `tsc` cannot see it — the mismatch exists only at runtime.

**Rule:** NUMERIC (oid 1700) decodes to a JS number: `packages/database/src/client.ts` registers the `setTypeParser` override once, so runtime matches the generated types. Do not wrap a NUMERIC read in `Number(...)`; the wrappers still at Kysely call sites are from before the parser and do nothing. `BIGINT` and float8 still arrive as strings, as does a NUMERIC from a pool that is not built through the shared factory. Do not convert those for tidiness: `Number()` on a `BIGINT` loses precision past `Number.MAX_SAFE_INTEGER`. More generally: a client swap can change runtime value types without changing a single TypeScript type, so a typecheck is not evidence that a port behaves identically. Exercise it against a real database.

**Applies to:** `apps/erp/app/modules/sales/sales.service.ts` (`upsertQuoteLinePrices`), any `Kysely<KyselyDatabase>` service in `apps/erp/app/modules/**`, and the `getPostgresClient` pool in `packages/database/src/client.ts`.
