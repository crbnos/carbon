---
paths: ["apps/erp/app/modules/items/items.service.ts"]
triggers: [".update(", "resolveTypedItem", "updateTypedItem"]
promoted: null
---
# A PostgREST update that matches no row reports success

**Context:** Typed item updates (`upsertPart`, `upsertTool`, `upsertConsumable`,
`upsertService`, `upsertMaterial`) filtered the typed table by the item's uuid,
but those tables are keyed by the item's readable id plus `companyId`.

**Problem:** `client.from(t).update(...).eq(...)` with no `.select()` returns
`{ error: null }` when it matches zero rows. Half of every typed update wrote
nothing, and the API and MCP reported success.

**Rule:** An update whose miss is a bug ends with `.select("id").single()`, so
a miss comes back as an error. Key each table by its own primary key: `item`
by uuid, the typed tables by `readableId` + `companyId`
(`resolveTypedItem` / `updateTypedItem` in `items.service.ts`).

**Applies to:** any supabase-js update in a service, above all one that writes
a pair of tables keyed differently.
