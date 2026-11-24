---
paths: ["apps/erp/app/routes/x+/items+/$itemId.properties.tsx"]
triggers: ["INSERT INTO \"item\"", "get_material_details", "get_part_details", "get_tool_details"]
promoted: null
---
# Raw-SQL item fixtures break type-specific UI — Material items need a companion `material` row keyed by readableId

**Context:** Posting-flow verification created a type-`Material` item (RM-STEEL) with a raw `INSERT INTO "item"`. Interceptors auto-created `itemCost`/`itemReplenishment`/etc., so purchasing and posting worked. Later, selecting that material on a part's BOM (`/x/part/{id}/details?materialId=…`) crashed the whole page with "Not Found".

**Problem:** Type-specific detail RPCs join companion tables the interceptors do NOT create: `get_material_details` requires a `material` row joined via `material."id" = item."readableId"` (readableId, not item id — all revisions share one taxonomy row). The properties route throws `404` when the RPC returns nothing, and a fetcher 404 bubbles to the route error boundary, taking down the entire details page.

**Rule:** When creating item fixtures via SQL, create the type's companion row too (`material` keyed by `readableId` for Materials; check the `get_{type}_details` RPC joins for the type). Prefer creating fixtures through the UI or service functions when the item will be used in UI flows, not just ledger posting.

**Applies to:** any psql/SQL test-fixture item creation; `get_material_details` / `get_part_details` / `get_tool_details` consumers; `apps/erp/app/routes/x+/items+/$itemId.properties.tsx`.
