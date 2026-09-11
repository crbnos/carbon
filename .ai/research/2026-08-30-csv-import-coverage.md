# CSV import coverage — what exists, and what a new import type costs

Research for expanding the CSV import system. Every fact verified against `main` at `7f5f1d214`
on 2026-08-30 by reading the file cited.

## The system as it stands

One import path, one entry point. PapaParse appears in exactly two files, both under
`apps/erp/app/components/ImportCSVModal/` — the wizard is the only CSV-ingest surface in the ERP
app. Nothing else in `apps/` or `packages/` reads an uploaded CSV.

A list page opts in by passing `importCSV={[{ table, label }]}` to `<Table>`, which renders the
Bulk Import dropdown in `components/Table/components/TableHeader.tsx:264`. That prop is the whole
registration mechanism on the UI side.

Adding a new import type therefore costs five edits:

1. `fieldMappings[table]` — labels, types, required flags, enum fetchers.
2. `importSchemas[table]` — the zod object the route validates against.
3. `importPermissions[table]` — the module whose `update` permission gates it.
4. The edge function's `table` enum plus a `case` in the switch.
5. `importCSV={[...]}` on the list page's `<Table>`.

Miss (2) and the field is silently dropped by the route; miss (4) and the whole import 400s; miss
(5) and it is unreachable. All three failure modes exist on `main` today — see Defects.

## Current coverage

22 registered, 21 accepted by the edge function, 20 reachable.

| Registered | Reachable from | Write path |
|---|---|---|
| `customer`, `customerContact` | Customers | main |
| `supplier`, `supplierContact` | Suppliers | main |
| `part`, `bom`, `operations`, `partWithMethod` | Parts, Tools | main |
| `material`, `tool`, `consumable` | own list pages | main |
| `workCenter`, `process` | own list pages | main |
| `storageUnit` | Storage Units | main, two-pass parent linking |
| 6 × material taxonomy | own config pages | `material-property-import.ts`, create-only |
| `fixture` | nowhere | main |
| `fixedAsset` | nowhere | none — rejected by the edge function |

15 of the app's 124 table components carry a Bulk Import button.

Idempotency for the main path is `externalIntegrationMapping` with `integration = "csv"`. The
material-taxonomy path skips it entirely and dedups on the DB's own unique constraints.

## Defects on main

- `revision` is in `fieldMappings` for `part`/`tool`/`fixture`/`consumable`/`material` and marked
  required. It is absent from the matching `importSchemas` entry. The route builds `columnMappings`
  from `validation.data` (`x+/shared+/import.$tableId.tsx:38`) and a zod object strips unknown keys,
  so the mapping never leaves the route. The edge function supports it and falls back to
  `revision: rest.revision ?? "0"` (`import-csv/index.ts:1688,1787`). Every CSV-imported item lands
  at revision `"0"` while the wizard demands the column. `mpn` on `partWithMethod` is identical.
- The LLM mapping fallback fires on nearly every file. `FieldMappings.tsx:133` skips it only when
  *every* field in `fieldMappings[table]` matched a header, not every *required* field. `part` has
  19 fields and 4 required. Mitigated but not fixed by the server doing its own exact-match pass and
  returning `{...matched, ...object}` (`api+/ai+/csv+/$table.columns.tsx`).
- `fixedAsset` is registered in models and permissions but missing from the edge function's `table`
  enum (`import-csv/index.ts:19`), and no page surfaces it.
- `fixture` is registered and implemented, but `Fixture` was dropped from the app's item-type enum
  (`items.models.ts:919`) and no Fixtures page exists. It survives only in the DB `itemType` enum.
- `api+/ai+/csv+/$table.columns.tsx:19` calls `requirePermissions(request, {})` — no module gate on
  an endpoint that makes a `gpt-4o` call. Headers only, so no data exposure; the cost is unmetered.
- Export and import are not round-trippable. `Table/components/Download.tsx` builds headers from the
  grid's column headers. On Parts, 2 of 16 match the import labels, `Part ID` exports
  `readableIdWithRevision` combined where import wants two columns, `Description` means
  `item.description` on export and `item.name` on import, and export emits no `Unique ID` at all.
- `writeSupplierPartLinks` parses minimum order quantity and order multiple with `Number.parseInt`
  (`import-csv/index.ts:748-751`), flooring fractional values silently.

## Candidate new types

Ordered by onboarding need. "Shape" is what makes each one different from a plain table insert.

### Tier 1 — blocks a greenfield go-live

**Opening stock, including serial and batch numbers.** No path exists. The natural vehicle does not
work: `generateInventoryCountLines` (`inventory.service.ts:1841`) snapshots one line per bucket
*that already has `itemLedger` history*, so a new company's count generates zero lines. The working
primitive is `post-inventory-adjustment`, one call per row, validated by
`inventoryAdjustmentValidator` (`inventory.models.ts:154`) with `adjustmentType: "Set Quantity"`.
Shape: not a Kysely transaction over one table but an N-call loop through an edge function that
writes ledger, cost layers and, when accounting is on, a balanced journal. Cost is taken from
`itemCost.unitCost`, not from the row — a per-line cost column is not possible without changing the
adjustment contract.

Serial and batch numbers ride on the same call and need no separate importer. When the caller
supplies a `trackedEntityId` that has no current quantity, the positive branch inserts a
`trackedEntity` outright (`post-inventory-adjustment/index.ts:991-1007`) with
`sourceDocument: "Item"`, `sourceDocumentId: itemId`, and `readableId` taken verbatim from the
request — so the serial or lot number arrives as a plain string and the importer generates the id.
Two consequences for the design:

- A serial-tracked item is capped at quantity 1 per call
  (`inventory.models.ts:187-194`), so N serialized units means N rows and N calls. A batch is one
  call carrying the lot quantity. Expect an import of a few hundred serials to be a few hundred
  round trips — batching or a queued run matters here in a way it does not for any existing import.
- The cap is enforced off `requiresSerialTracking`, a **caller-supplied** flag the forms set. An
  importer must derive it from the item's `itemTrackingType` itself rather than trust a column, or
  the guard is trivially bypassed.

`expirationDate` is accepted on the same call and stamped onto the new entity, so shelf-life data
loads in the same pass.

**Supplier price breaks.** `supplierPartPrice` has existed since
`20260129150000_quantity-price-breaks.sql`. The item import writes one flat `supplierPart.unitPrice`
and never touches the child table. Consumed by quote BOM costing and the PO/invoice forms
(`items.service.ts:5204,5277`), so absent breaks make quoting and purchasing suggestions wrong, not
just incomplete. Shape: child of `supplierPart`, natural key `(supplierPartId, quantity)` from the
table's own PK, so no `externalIntegrationMapping` row is needed. `sourceType` has a `Manual Entry`
value to write. Open: which page mounts it, since there is no price-break list page.

**Locations.** `location` requires `name`, `addressLine1`, `city`, `postalCode` and `timezone`,
with no default for `timezone`. Shape: plain, except that the timezone column needs either a
required field or a company-default fallback.

### Tier 2 — closes an obvious symmetry gap

**Services.** `Service` is a first-class item type with a full UI
(`items/ui/Services/`) and is the only one of the five item types with no import. Shape: reuses the
existing item path almost verbatim.

**Units of measure, item posting groups, storage types, scrap reasons, departments.** Small
company-scoped lookups: name (+ code) + active. Shape: create-only with skip-duplicate, exactly the
`material-property-import.ts` pattern, which is the cheapest template in the codebase.

**Customer part numbers.** `customerPartToItem`, keyed `(customerId, itemId)` with a unique
constraint on the same pair. Needed before a customer portal or an RFQ conversion means anything.

### Tier 3 — a whole module with no coverage

**Quality.** Eleven tables, zero imports. `gauge` (requires `gaugeId`, `gaugeTypeId`),
`gaugeType` (name only), and `gaugeCalibrationRecord` (requires `gaugeId`, `dateCalibrated`,
`inspectionStatus`) are the three that arrive as a spreadsheet from any shop with a calibration
programme. Shape: `gaugeType` is a trivial lookup, `gauge` is a plain insert with lookups,
`gaugeCalibrationRecord` is a child keyed on a gauge that must exist first.

### Deliberately excluded

- **A standalone `trackedEntity` import.** Not excluded as a capability — serial and batch loading
  is required, and is in Tier 1 above. Excluded only as a *separate import type*: the table's
  required `sourceDocument` / `sourceDocumentId` mean a row has to originate from something, and the
  adjustment path already supplies `"Item"` and creates the entity. A direct table import would
  write ledger-less entities that no inventory query would ever see.
- **Chart of accounts.** Rendered as a tree, so there is no `<Table>` to hang a button on, and
  `seed-company` already installs a default chart. This is "replace the seeded one", a different
  and larger problem.
- **Employees.** Creating one provisions an auth user and sends an invite. Bulk-inviting from a CSV
  is a different risk class from bulk-inserting rows and should not ride along with this work.
- **Fixtures.** Dead config: `Fixture` was dropped from the app's item-type enum and there is
  no Fixtures list page. Removing the registration is cleanup, not coverage.
  (`fixedAsset` is NOT in this category — Fixed Assets is a live module with a full UI and six
  routes. Its import is half-wired: models and permissions exist, the edge-function case and the
  Bulk Import button do not. Finishing it is real coverage, sized with the Tier 2 batch.)

## Column mapping quality — its own workstream

Reported from use: the mapping step misses columns it should obviously catch. It does, and the
cause is that there is no matching logic beyond string equality.

- Matching is `toLowerCase().trim()` and nothing else, on both the client
  (`FieldMappings.tsx:114-131`) and the server (`api+/ai+/csv+/$table.columns.tsx:38-66`). A header
  matches only if it equals the field's single `label` or its field name. `Part Number` matches;
  `part_number`, `PartNumber`, `Part No.`, `Part #` and `Part Number (Rev)` all miss and fall to the
  model.
- A field definition carries one `label` and no synonyms. The same folder already has an alias
  mechanism — `enumMatch.ts` lets an *enum option* match by label or any of its `aliases` — and it
  was never applied to column headers. Adding `aliases?: string[]` to the field type and populating
  it for the common industry spellings is the single highest-yield change here.
- The skip-the-model condition requires *every* field in `fieldMappings[table]` to have matched, not
  every required one (`FieldMappings.tsx:133`). `part` has 19 fields and 4 required, so a clean file
  that simply omits optional supplier and cost columns always calls `gpt-4o`. Gating on required
  fields would take most real imports off the model path entirely.
- The client and server run two separate exact-match passes over two different field sources —
  `fieldMappings` on the client, the zod schema on the server — and the client discards its own
  result in favour of the server's. Any field the two disagree on is lost, which is the mechanism
  behind the `revision` defect above. One pass, one source, shared by both.
- The UI shows one sample value from the first row beside each mapped field
  (`FieldMappings.tsx:358`), which is what makes a wrong mapping noticeable at all. It does not
  distinguish a deterministic match from a model guess, so there is no signal about which rows
  deserve the scrutiny.
- `gpt-4o` is hardcoded and the endpoint has no permission gate (see Defects).

## Agreed ordering

Foundation, then mapping, then coverage, with opening stock last. Settled 2026-08-30.

| # | Work | Why here |
|---|---|---|
| 0 | Fix `revision` being stripped by the route | Live data-correctness bug on `main`; one key in a zod object. Ships on its own branch, not behind this work. |
| 1 | Registration consistency check | Would have caught `revision`, `mpn`, `fixedAsset` and `fixture` — four bugs, four halves of the same five-edit pattern. Not worth its own PR: folded into the first coverage batch, where the same maps are already being edited. |
| 2 | Column mapping quality | Adding `aliases` changes the shape of every `fieldMappings` entry. Better to write eight new entries once against the new shape than write and revise them. |
| 3 | Tier 2 coverage, one batch | Services, units of measure, item posting groups, storage types, scrap reasons, departments, customer part numbers. Seven configs sharing the `material-property-import.ts` template — closer to one piece of work than seven. First visibly useful output. |
| 4 | Price breaks and locations | Ordinary writes on the existing path, but each has an unresolved design question: no list page to mount price breaks on, and `location.timezone` has no default. |
| 5 | Opening stock, including serial and batch | Last and separate. The only one that cannot use the existing write path, the only one with a round-trip volume problem, and the only one that posts to the general ledger. |

The live argument is 3 versus 5 — the go-live blocker could reasonably lead. It is held to last
because 1 and 2 are prerequisites for it regardless: opening stock will be the ninth registration
and the one whose column mapping matters most. The choice only decides whether the cheap batch ships
along the way.

## Cross-cutting questions the new types raise

- Every existing import targets one top-level list page. Opening stock and price breaks are
  child-of-parent data with no list page of their own. Either they get a home page, or the wizard
  learns to mount inside a detail view — the first such case.
- The main edge-function path assumes "insert or update one row per CSV row inside one transaction".
  Opening stock breaks that assumption. It either gets its own path, like material properties did,
  or the posting is moved behind a batch endpoint.
- The five-edit registration list above is unenforced, and two of its three failure modes are live
  on `main`. A type-level or test-level check that `fieldMappings`, `importSchemas` and the edge
  function's enum agree would prevent the next `revision` before it ships.
