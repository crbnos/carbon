# Onshape Integration v2

> Status: draft
> Author: Raul Soonawala
> Date: 2026-08-18

## TLDR

Rebuild the Onshape integration around a **hidden, id-based mapping** between Carbon items and
Onshape parts/subassemblies, replacing the current part-number string matching. Adds two things
the current integration cannot do: create a Carbon item *from* an Onshape selection (so the part
number and revision match by construction, never by typing), and pull CAD assets as part of a BOM
import rather than as a separate journey. The BOM writer moves from a synchronous Deno edge
function to an Inngest job, which is what makes reconcile, retries, progress and the asset pull
possible. Ships **alongside** the existing integration behind a pipeline selector on the same
OAuth connection; the current integration is untouched and remains the default.

## Problem Statement

Three problems, all downstream of one root cause.

**Root cause: the join between Carbon and Onshape is a hand-typed string.** Every consumer matches
on `item.readableIdWithRevision` equalling `partNumber[.revision]`. Nothing records *which* CAD
element an item came from.

1. **The user has to make the two systems agree by hand.** To pull a BOM into an item, the item
   must already exist in Carbon with a `readableId` and `revision` matching Onshape exactly. The
   new-part form prefills a Carbon sequence (`useNextItemId("Part")`, `PartForm.tsx:178`) and
   defaults revision to `"0"` (`part+/new.tsx:74`), so both fields are overwritten manually. The
   Part ID field additionally *transforms* what is typed to uppercase (`isUppercase`,
   `PartForm.tsx:281` → `InputControlled.tsx:83,95`), so a lowercase Onshape part number cannot be
   entered at all — and every asset attach and release import for that part then fails silently as
   `no-matching-item`.

2. **BOM import and asset backfill are separate journeys.** A BOM import creates or updates the
   item tree and stops. Models and drawing PDFs arrive only via the release webhook or a
   company-wide backfill. There is no path that says "import this assembly and bring its
   geometry". The BOM loader makes this impossible even in principle: it rebuilds each row from
   `headerIdToValue` only (`bom.ts:67-83`), discarding Onshape's per-row source addressing, so by
   the time the writer runs there is no element identity to export from.

3. **A string match is unsafe as well as inconvenient.** Two different Onshape elements sharing a
   part number silently merge into one Carbon item. A renamed BOM column reads as `""` with no
   error. An unchecked item-lookup failure (`bom.ts:106`, `:159` never read `.error`) makes every
   row look new and builds a parallel item tree.

## Proposed Solution

A second pipeline inside the same integration record, selected per company, built on identity
rather than strings.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Join key | Hidden `externalIntegrationMapping` rows, id-based | Part number becomes a label Onshape supplies, not a key. Retires the uppercase class of bug entirely. |
| String matching | **None** in v2, except the explicit user-driven link flow | An unmapped item is not an Onshape item. No silent fallback that can mismatch. |
| BOM writer runtime | Inngest job, not the `sync` edge function | Enables reconcile, retries, per-row isolation, progress, and asset pull in the same run. The Deno runtime cannot import `~/modules`, which is why revision-preference sorting is hand-copied in three places today. |
| BOM write strategy | **Reconcile**, never delete-and-rebuild | The only way to retain the BOP. `methodMaterial.methodOperationId` ties a BOM line to its routing step; wiping the material set severs every one and drops `scrapQuantity`, `kit`, `sourcingType`, `storageUnitIds`, `tags`, and cascades `methodMaterialStep` away. |
| Unreleased parts | Supported; always target Carbon's initial revision `'0'` | No invented revision string, so nothing leaks into documents, POs, accounting sync, MCP or CSV. `item_unique` satisfied, `getNextRevision` never sees an unparseable label. |
| Unreleased item `active` | `true` | `active: false` already means "draft revision owned by an open change notice" and is filtered out of pickers. Overloading it would confuse `resolveReleaseTarget` and hide an item the user explicitly synced to work on. The unreleased fact lives in mapping metadata and drives a badge. |
| Field ownership on sync | Onshape overwrites what Onshape has; Carbon keeps the rest | See the ownership table below. |
| Coexistence | Ships alongside; one OAuth connection, one webhook, a pipeline selector | Two connections would mean installing the Onshape app twice and receiving every release event twice at two callback URLs. |
| Pipeline control | Single-select (`legacy` \| `next`), not two booleans | Removes the invalid both-on state rather than policing it with a warning. Migration is a flip; the customer can move back and forth freely. |
| Version scope for create | Released revisions only | The revisions API returns a flat, searchable, paginated list already carrying document/version/element identity. |

## Identity model

Onshape's identifiers, and what each one identifies:

| Id | Identifies | Source |
|---|---|---|
| `documentId` | the document | webhook, revisions API |
| `elementId` | one tab — a Part Studio, Assembly, or Drawing | webhook, revisions API |
| `partId` | one solid body **within** a Part Studio; scoped to the element, not globally unique | `getParts()` (`OnshapePart.id`), optionally on `OnshapeRevision` |
| `revisionId` | one specific released revision of one element; immutable | webhook |
| `releaseId` | the release package | webhook |

A **BOM row is a position, not a thing** — the "Item" column is a path relative to the assembly
queried, and a part used in two subassemblies gets a row under each. Row identity is never a join
key. The durable identity is what the row points at.

A Part Studio with five parts is **one element but five Carbon items**, so an element-level link
is insufficient for parts, and an element-level export returns all five bodies in one GLTF.

### Mapping rows

`externalIntegrationMapping` already supports this; **no schema change**. Two constraints do the
work: `UNIQUE (entityType, entityId, integration, companyId)` is always enforced (hence two
`integration` values rather than one row), and the partial
`UNIQUE (integration, externalId, entityType, companyId) WHERE allowDuplicateExternalId = false`
is the enforcement mechanism.

| `integration` | `entityType` | `externalId` | `allowDuplicateExternalId` | Asserts |
|---|---|---|---|---|
| `onshapeElement` *(new)* | `item` | `{documentId}:{elementId}` (subassembly) or `{documentId}:{elementId}:{partId}` (part) | **true** | This Carbon item is that CAD thing. Repeats across revisions of one part, hence duplicates allowed. |
| `onshapeRevision` *(new)* | `item` | `revisionId` | **false** | This Carbon item revision came from that Onshape release. Enforced 1:1 both ways. |

`metadata` on the `onshapeElement` row carries the volatile state: `versionId`, version name,
`configuration`, `elementType`, `lastSyncedAt`, and whether the last sync was from an unreleased
version. Keeping it here is what lets `item.revision` stay clean.

The existing `onshape` (picker state) and `onshapeData` (BOM explorer state badge) rows are
untouched and remain legacy-only.

### Collisions

| Case | Behaviour |
|---|---|
| Two Onshape elements claim one Carbon `readableId` | Refuse the row, name both sources. Today this silently merges two CAD things into one item. |
| A part with released revisions, someone syncs its working version | Refuse in v1. Once under release control, in-progress state should not quietly become an item that sorts below the released ones. |
| Sync unreleased, then it is released as `A` | The release path creates revision `A`. Revision `0` remains as history — ordinary Carbon revision behaviour, no special casing. |

## Field ownership

Applies on create-from-Onshape, on link-existing, and on every subsequent sync.

**Onshape-owned — overwritten every time:** `name`, `description`, material, the BOM structure and
quantities, the 3D model, the drawing PDF, released revision, Onshape state.

**Carbon-owned — never touched:** the entire BOP (`methodOperation` + steps, parameters, tools),
costing, planning, `itemTrackingType`, unit of measure, supplier parts and pricing, posting groups,
shelf life, pick methods, storage, tags, custom fields, inspection assignments, customer parts and
prices.

**Seeded once on create, Carbon's thereafter:** `replenishmentSystem`, `defaultMethodType`.
Onshape's Purchasing Level is a reasonable first guess and a poor permanent authority — it is a
business decision, not a CAD fact.

Linking an existing item is **destructive by consent** on the Onshape-owned set. The confirm step
must state exactly what will be overwritten before the user proceeds.

## Settings model

Added to the existing `onshape` integration. All keys optional; every read site tests strict
equality against the new value so an absent key means legacy **by construction**, not by default.

| Setting | Type | Default | Gates |
|---|---|---|---|
| `pipeline` | options: `legacy` \| `next` | `legacy` | Which implementation handles this company. The migration lever. |
| `attachAssetsOnRelease` | switch | on | v2 webhook-driven asset attach. Nested under `next`. |
| `importRevisionsOnRelease` | switch | on | v2 webhook-driven revision import. Nested under `next`. |
| `releaseImportModeV2` | options | `changeNotice` | Same meaning as today. Nested under `importRevisionsOnRelease`. |
| `allowUnreleasedSync` | switch | **off** | Whether the version picker offers never-released versions. |

**The existing `assetSyncEnabled` / `releaseImportEnabled` / `releaseImportMode` /
`webhookSigningSecret` settings stay top-level and unconditional.** They must not be nested under
the selector: a `visibleWhen`-hidden field unmounts and posts nothing, and zod's `.default(false)`
would then write `false` — silently disabling asset sync for a customer who had it on, the moment
they save anything.

## Data Model Changes

**No new tables. No column changes.**

One data-only migration declaring the new keys in the `onshape` row of `integration.jsonschema`,
following `20260817155435_onshape-release-import-jsonschema.sql`. Safe by inspection: that schema's
`required` is only `["baseUrl", "credentials"]` and `additionalProperties` defaults to true, so
adding optional properties cannot fail `verify_integration()` for any existing row, and no row is
touched.

## API / Service Changes

New, all additive:

- `packages/ee/src/onshape/lib/mapping.ts` — build and parse the two external ids; read/write
  helpers. Mapping writes run on the service role (`externalIntegrationMapping` has SELECT and
  INSERT policies only, no UPDATE or DELETE — a user-client update matches zero rows and returns
  no error).
- `getBillOfMaterials` gains an options bag and **retains per-row source addressing** instead of
  flattening to header-named columns only.
- New Inngest job `onshape-import` — resolve → reconcile BOM → pull assets, per-item steps,
  `RetryAfterError` on 429, `OnshapeAssetTooLargeError` skips permanently.
- New routes under `api+/integrations.onshape.v2.*` for the released-revisions picker, the
  create-from-Onshape action, the link-existing action, and the import trigger.
- Webhook receiver gains a `pipeline === "next"` branch **after** the existing either-flag gate,
  which stays first and unchanged so a legacy company takes a byte-identical path.

**Fix shipped alongside:** the OAuth callback replaces the whole `metadata` column on reconnect
(`oauth.ts:140-155`), which today loses a customer's settings and with a selector would silently
revert a migrated customer to legacy. Change it to merge into existing metadata.

## UI Changes

- **Create from Onshape** — released-revisions picker; creates the item with `readableId`,
  `revision` and `name` verbatim (bypassing the uppercase transform), writes both mapping rows, and
  pulls that item's assets immediately.
- **Link existing item to Onshape** — same picker from an existing item, with an explicit
  overwrite confirmation listing the Onshape-owned fields. This is also the migration path off the
  legacy integration.
- **BOM import v2 panel** — replaces the legacy panel when `pipeline === "next"`; the legacy
  panel's render condition gains `pipeline !== "next"` so both can never show. Preview shows a
  diff (create / update / unchanged per row), not just a row list.
- **Per-item Onshape state** in the BoM explorer, sourced from the mapping rather than
  `onshapeData`.

## Phases

1. Settings — `pipeline` selector, new keys, jsonschema migration, OAuth merge fix.
2. Mapping layer — id builders, read/write helpers, unit tests.
3. Create-from-Onshape and link-existing, with immediate asset pull.
4. BOM import v2 — identity-retaining loader, Inngest writer, reconcile.
5. Asset pull for the whole imported tree, in the same job.
6. Webhook routing to the v2 pipeline.

## Acceptance Criteria

- [ ] A company with no `pipeline` key behaves exactly as today; no legacy code path is modified.
- [ ] Creating a part from Onshape produces an item whose `readableId` and `revision` match the
      Onshape selection exactly, including lowercase part numbers, with both mapping rows written.
- [ ] A BOM import resolves every row by mapping; no row is matched by part number.
- [ ] A BOM import preserves the BOP: `methodOperationId`, `scrapQuantity`, `kit`, `sourcingType`,
      `storageUnitIds`, `tags` and `methodMaterialStep` rows survive a re-import unchanged.
- [ ] A BOM import attaches models and drawing PDFs for the top-level item and every child that
      has a released revision.
- [ ] Two Onshape elements claiming one `readableId` are refused with both sources named.
- [ ] An unreleased sync creates an item at revision `'0'` with `active: true`; nothing invented
      appears in `item.revision`.
- [ ] Switching `pipeline` to `next` warns about existing unmapped Onshape-sourced items and links
      to the link flow.
- [ ] Reconnecting OAuth preserves settings.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Per-row source addressing in the BOM response is unconfirmed | **High** — gates phase 4 | One live call against RD-410 before starting phase 4. If absent, resolve each row via `getRevisions` instead (one call per distinct part number). |
| Single-part GLTF export via `partIds` is unexercised | Med | Confirm against a live Part Studio in phase 3. Fallback is whole-Part-Studio export with a documented limitation. |
| `partId` stability across rename / feature-tree rebuild unverified | Med | Test before making it part of the permanent key; the element-level row can carry it in metadata rather than the id if it proves unstable. |
| Reconcile natural key | Med | `methodMaterial` has no Onshape back-pointer today; v2 writes one, so reconcile keys on the mapping, not on a heuristic. |
| Legacy BOM import used while on `next` creates unmapped items | Low | Panels are mutually exclusive by construction. |

## Open Questions

**Onshape release name and release notes — where do they land in Carbon?**
(Raised 2026-08-18, deferred.) Onshape's release package carries a name and
free-text release notes, and both are engineering-meaningful. Today `releaseName`
is only stashed in the revision mapping's metadata, and the release NOTES are not
captured anywhere at all — the legacy release import writes its own provenance
sentence into `reasonForChange` rather than Onshape's text. Candidates: the
change notice's `reasonForChange` / `description` (both tiptap rich text, so a
plain string will not render), an item-level note, or a document attached to the
item. Needs deciding before release import is wired into v2, since that is the
path that would carry them.

**Extensible custom-field mapping.** (Raised 2026-08-18, deferred — low
priority.) Onshape carries far more per-part metadata than v1 reads. The live
BOM response for the RD-410 assembly returns **26 columns**, of which Carbon
consumes six (`Item`, `Quantity`, `Part number`, `Description`, `Name`,
`Revision`). The rest are available and currently discarded:

    State, Appearance, Vendor, Project, Product line, Material, Title 1/2/3,
    Not revision managed, Exclude from all BOMs, Unit of measure, Category,
    Mass, Center of mass, Inertia, Subassembly BOM behavior, Tessellation
    quality, + two customer-specific columns

Some map to real Carbon columns (`Unit of measure` → `unitOfMeasureCode`, which
`TreeData.unitOfMeasure` declares and never populates today; `Material`;
`Vendor` → supplier). Others are company-specific and belong in `item.customFields`.
Needs a per-company mapping surface — Onshape column → Carbon field — rather
than the hardcoded six. Headers carry stable ids alongside display names, so a
mapping should key on the ID, not the name, which is exactly the fragility v1
has today.

Resolved during design:

- Unreleased revision representation → initial revision `'0'`, state in mapping metadata.
- Unreleased item `active` → `true`.
- Coexistence → one connection, one webhook, pipeline selector.
- Switch set → five, listed above.

## Changelog

- 2026-08-18: Created.
