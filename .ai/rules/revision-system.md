---
paths:
  - "apps/erp/app/modules/items/**"
  - "apps/erp/app/routes/x+/items+/revisions.new.tsx"
  - "packages/database/supabase/migrations/*revisions*.sql"
  - "packages/database/supabase/migrations/*make-method-version*.sql"
---

# Revision System

Carbon lets multiple **revisions** of the same item (Part, Material, Tool,
Consumable, Service) coexist. A revision is just another `item` row sharing the
same `readableId` + `companyId` + `type`, distinguished by its `revision` string.
Introduced in `20250519122022_revisions.sql`; ordering/filtering refined through
`20260515120000_fix-item-details-revisions-filter-by-type.sql` (read the newest).

## Data model (verified)

- A revision **is** a full `item` row. There is no separate revision table. The
  type tables (`part`/`material`/`tool`/`consumable`/`service`) hold properties
  shared across revisions; the `item` row holds per-revision data.
- **Item linkage is positional**, not a FK: `part.id` (and `material.id`,
  `tool.id`, …) equals the item's **`readableId`**. The old `*.itemId` FK columns
  were dropped in `20250519122022`. Join via `item.readableId = <typeTable>.id AND item.companyId = <typeTable>.companyId`. So one type row ↔ many item revisions.
- `item.revision` TEXT DEFAULT `'0'` (the initial/unnamed revision). Named
  revisions are arbitrary strings (`A`, `B`, …).
- `item.readableIdWithRevision` is a **STORED generated column**:
  `readableId` when `revision` is `'0'`/empty, else `readableId || '.' || revision`
  (e.g. `P000123` → `P000123.A`). TS mirror: `getReadableIdWithRevision(readableId, revision?)`
  in `apps/erp/app/utils/string.ts`.
- Uniqueness: `item_unique UNIQUE ("readableId", "revision", "companyId", "type")`.
  The `type` in the key means a Part and a Consumable **can legally share a
  `readableId`** — which is why the detail RPCs must filter revisions by type
  (see Gotchas).

## Which revision is shown

There is **no `activeRevision` flag** on items. The list views (`parts`,
`materials`, `tools`, `consumables`, `services`) collapse to **one row per
`(readableId, companyId)`** via a `latest_items` CTE
(`DISTINCT ON ... ORDER BY`). Current ordering
(`20260325073453_fix-latest-revision-ordering.sql`) **prefers named revisions
over the `'0'`/empty initial revision**, then `createdAt DESC` as tiebreaker — so
the most-recent *named* revision is the default surfaced. Each view row also
carries a `revisions` JSON array (all siblings) for the version switcher.

Detail pages route by the specific item **`id` (UUID)**, so the URL pins the exact
revision. The `get_<type>_details(item_id)` RPCs return that revision's data plus
the type-scoped `revisions` array.

## Creating a revision

- Validator: `revisionValidator` in `apps/erp/app/modules/items/items.models.ts`
  — `{ id?, type, copyFromId?, revision }`; requires `id` **or** `copyFromId`.
- Route: `apps/erp/app/routes/x+/items+/revisions.new.tsx` (action). For a **new**
  revision it requires `copyFromId`, loads that item via `getItem`, then calls
  `createRevision(getCarbonServiceRole(), { item, revision, createdBy })`. Redirects
  to the new revision's detail page by type. URL: `path.to.newRevision`.
- Service: `createRevision` (`items.service.ts`) inserts a new `item` row copying
  the source's core fields (same `readableId`, new `revision`, `active: true`).
  If `replenishmentSystem !== "Buy"`, it invokes the `get-method` edge function
  (`type: "itemToItem"`) to copy the method/BOM from source to the new revision.
- UI form: `RevisionForm.tsx`; version switcher menus ("Versions" submenu) live in
  the type tables (`PartsTable.tsx`, etc.), shown only when `revisions.length > 1`,
  linking each sibling by its item id. Badge component: `ItemWithRevision.tsx`.

## Make methods vs. revisions (distinct concepts)

A **make method** is the manufacturing recipe for a Part/Tool item; a `makeMethod`
row is auto-created per item via the `create_make_method_related_records` AFTER
INSERT trigger (so **each revision gets its own makeMethod**).

Make methods are independently **versioned** (`20250603011801_make-method-version.sql`):
- `makeMethod.version` NUMERIC DEFAULT 1, `makeMethod.status` enum `makeMethodStatus`
  = `Draft | Active | Archived`. Unique `(itemId, version)`.
- View `activeMakeMethods` ranks per `itemId`, preferring `status='Active'` then
  `version DESC` (excludes `Archived`) — picks the one current method per item.
- `activateMethodVersion` (`items.service.ts`) invokes the `convert` edge function
  (`type: "methodVersionToActive"`). Route: `x+/items+/methods+/versions.activate.$id.tsx`.
- `jobMakeMethod.version` / `quoteMakeMethod.version` denormalize the method version
  at job/quote creation. Don't conflate method `version` (per-item recipe) with item
  `revision` (a sibling item row).

## Gotchas

- **Detail-RPC revisions are type-scoped.** `get_part_details` /
  `get_tool_details` / `get_material_details` / `get_consumable_details` filter the
  `item_revisions` CTE by `i."type" = '<Type>'`
  (`20260515120000_fix-item-details-revisions-filter-by-type.sql`). A pre-fix RPC
  leaked a Consumable into a Part's revisions list because they shared a `readableId`.
  Keep the type filter when editing these functions.
- **`'0'`/`''`/NULL are all the initial revision.** The view ordering and the
  generated column all special-case them together — handle all three.
- **No `itemId` FK on type tables**; join on `readableId` + `companyId`. Adding an
  `itemReadableId` column is explicitly disallowed by the DB conventions.
- The detail RPCs select `i."requiresInspection"` (added after the original
  revision migrations) — older RPC bodies in earlier migrations omit it; newest wins.
