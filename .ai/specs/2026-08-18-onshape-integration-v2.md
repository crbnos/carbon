# Onshape Integration v2

> Status: in-progress
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
| `releaseImportV2` | options: `off` \| `changeNotice` \| `revision` | `changeNotice` | v2 webhook-driven revision import AND its mode, in one field. Nested under `next`. |
| `allowUnreleasedSync` | switch | **off** | Whether the version picker offers never-released versions. |

`releaseImportV2` collapses what the draft had as a switch plus a mode. `visibleWhen` resolves
exactly one field with no transitive nesting, so a mode nested under a switch that is itself
nested under `pipeline` would render whenever the switch was on — including on a legacy company.
One enum with an `off` member has no such second level.

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
- **Unreleased version browser** — a second entry point on the import panel, shown only when
  `allowUnreleasedSync` is on, listing the document's versions and marking which carry a release.
  Without it the setting had no path that OFFERED an unreleased version, so its only working
  effect was to weaken a guard — the opposite of its label.
- **Import outcome notification** — one in-app notification to whoever started an import, and
  only when something needs attention. It names the refused parts and why. Nothing else reports
  back: the panel toasts "Import started", so without it a refused row is indistinguishable from
  one that imported cleanly.

## Phases

1. **Done.** Settings — `pipeline` selector, new keys, jsonschema migration, OAuth merge fix.
2. **Done.** Mapping layer — id builders, read/write helpers, unit tests.
3. **Done.** Create-from-Onshape and link-existing.
4. **Done.** BOM import v2 — identity-retaining parser, Inngest writer, reconcile.
5. **Done.** Asset pull for the whole imported tree, in the same job.
6. **Done.** Webhook routing to the v2 pipeline, plus a v2 release job.

Also built, beyond the original list: unreleased-version syncing
(`allowUnreleasedSync` gated everywhere, versions loader, refusals) and the
migration warning on switching a company to v2.

### Verified against the live Onshape instance

- Create, link, and BOM import all round-trip; the full RD-410 tree imports with
  correct revisions, quantities and nesting into two make methods.
- A re-import preserves Carbon-owned data: the same `methodMaterial` row id kept
  `scrapQuantity`, `tags` and `kit` while Onshape's quantity was applied.
- A refused row leaves its material line untouched — demonstrated by unmapping
  `EL-407.A` and re-importing.
- Per-part GLTF export via `partIds` works: seven bodies from ONE Part Studio
  produced seven differently-sized files, an assembly a much larger one. The
  client flags this path as unverified; it is now verified.

## Acceptance Criteria

- [x] A company with no `pipeline` key behaves exactly as today; no legacy code path is modified.
- [x] Creating a part from Onshape produces an item whose `readableId` and `revision` match the
      Onshape selection exactly, including lowercase part numbers, with both mapping rows written.
- [x] A BOM import resolves every row by mapping; no row is matched by part number.
- [x] A BOM import preserves the BOP: `methodOperationId`, `scrapQuantity`, `kit`, `sourcingType`,
      `storageUnitIds`, `tags` and `methodMaterialStep` rows survive a re-import unchanged.
- [x] A BOM import attaches MODELS for the top-level item and every child that resolved.
      The top-level was NOT covered until 2026-08-19: Onshape returns the queried assembly
      separately from its components, so it is not one of `parsed.rows`, and the one item the
      user is looking at was the only one in the tree never given geometry. Verified live —
      `RD-410.A.gltf` at 138667 bytes against the SA-800 subassembly's 78410.
      Drawing PDFs are NOT attached — v1's suffix matching is disproved on real data
      (see the drawing section above) and no replacement mechanism is settled.
- [x] Two Onshape elements claiming one `readableId` are refused with both sources named —
      verified live: `EL-402.A` was refused while `EL-402.C` held the mapping, and the refusal
      names both. (The inverse — two legitimate REVISIONS of one part reading as a collision —
      was the bug that surfaced it.)
- [x] An unreleased sync creates an item at revision `'0'` with `active: true`; nothing invented
      appears in `item.revision`.
- [x] Switching `pipeline` to `next` warns about existing unmapped Onshape-sourced items and links
      to the link flow.
- [x] Reconnecting OAuth preserves settings.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Per-row source addressing in the BOM response is unconfirmed | **High** — gates phase 4 | One live call against RD-410 before starting phase 4. If absent, resolve each row via `getRevisions` instead (one call per distinct part number). |
| Single-part GLTF export via `partIds` is unexercised | Med | Confirm against a live Part Studio in phase 3. Fallback is whole-Part-Studio export with a documented limitation. |
| `partId` stability across rename / feature-tree rebuild unverified | Med | Test before making it part of the permanent key; the element-level row can carry it in metadata rather than the id if it proves unstable. |
| Reconcile natural key | Med | `methodMaterial` has no Onshape back-pointer today; v2 writes one, so reconcile keys on the mapping, not on a heuristic. |
| Legacy BOM import used while on `next` creates unmapped items | Low | Panels are mutually exclusive by construction. |

## Drawing attachment — v1's mechanism does not survive contact with real data

Established 2026-08-18 against the live Carbon Onshape instance.

**The drawing has no part number.** `RD-410 Wandleser RFID Drawing 1`
(element `3043b4598e6e8d07fa7f3e45`) has `Part number = null`. Released as-is it
produces a revision the webhook receiver discards, since `partNumber` is required
to dispatch at all, and the v2 picker filters it out for the same reason.

**Suffix matching is ambiguous for this customer's numbering.** v1 attaches a
released drawing to its model by stripping the leading letter prefix to a shared
suffix and ILIKEing `%<suffix>`, refusing when more than one item matches.
Verified: `RD-410`, `DRW-410` and `PK-410` all reduce to the suffix `-410`, and
`ILIKE '%-410'` matches **five** items across **two different parts** —
`PK-410.A/B` and `RD-410.A/B/C`. Any drawing numbered against `RD-410` is
therefore permanently `ambiguous-item`.

That is not a numbering mistake by the customer; three-digit part numbers
colliding on a suffix is ordinary. It means **v2 must not attach drawings by
suffix**. Candidate mechanisms, to be settled with the asset-pull work:

- exact part-number equality between drawing and model, scoped to the same
  document — unambiguous when a customer numbers a drawing the same as what it
  documents, which is common;
- ask Onshape what the drawing references, if an API exposes a drawing's
  referenced elements, and map through the element id like everything else;
- a mapping row for the drawing element itself, established when a user links or
  imports the model, so the join is an id rather than a string either way.

The third is most consistent with the rest of v2 and needs no naming convention
from the customer.

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

## Known gaps

- **Translations.** 55 new English strings ship with empty `msgstr` in 12 locales. That matches
  upstream practice — `pnpm translate` needs an LLM key and is run as its own pass, not per PR.
- **Drawing attachment.** Still unsolved; see the drawing section. v2 refuses rather than guessing.
- **Configuration is not part of identity.** `buildElementExternalId` ignores the Onshape
  configuration, so two configured instances of one element map to the same Carbon family. The
  ASSET pull now carries the configuration through, so a single-configured-instance BOM exports
  the right shape; the multi-instance case needs the id to change too.
- **Case- and dot-collision part numbers are untested.** `TB-900` vs `tb-900`, and a part number
  that itself contains a dot, both land on `readableIdWithRevision`, whose separator is a dot.
  Non-ASCII and 82-character numbers ARE verified (see below).

## Live verification, 2026-08-19

Both paths the previous revision of this spec listed as unverified are now verified end to end,
against a real Onshape company, using a purpose-built test document (`TB Test Bench`, a copy of
the RD-410 document with every part number rewritten so nothing collided with existing data).

**Unreleased import — mint.** An unreleased version imported into a Carbon part created 7 items
and attached a model to all 8 (the 7 children plus the top-level item), with the tree, the
per-line quantities and the indent nesting all preserved. The row whose Onshape part number was
deliberately blanked was refused, not imported. A non-ASCII part number (`TB-902-Ü-Ä-ß`) and an
82-character one both round-tripped intact through the item, the mapping and the exported
asset filename.

**releaseImportV2 — a real release.** A real Onshape release of that document at revision A,
delivered as eight separate `onshape.revision.created` webhooks (six fired concurrently to
exercise the claim race), produced ONE Draft change notice with EIGHT affected items, and one
release marker listing all eight parts. Confirmed on the way through:

- Each new revision got its OWN exported asset (`TB-901.A.gltf` … `TB-950.A.gltf`, distinct
  upload rows, sizes 17247–138667), not a pointer copied from its source item — the
  `items_createRevision` hazard recorded below is genuinely closed.
- Both mappings were written for the created item: two `onshapeElement` rows sharing one
  externalId (one per Carbon revision — the family), and one `onshapeRevision` row keyed by the
  real Onshape revisionId (the member).
- `TB-905`, a part number Carbon has never held, was skipped rather than minted.

**Idempotency.** Re-importing the same unreleased BOM reported `0 part(s) created,
7 line(s) imported` and left the item count at exactly 16 (8 initial + 8 released) — the id-based
mapping adopts rather than duplicating, which is the whole point of the rebuild.

**Thirteen bugs this pass found and fixed.** None were reachable by reading; all six needed the live
run.

1. **A minted subassembly was `Buy`.** A row WITH CHILDREN was created `Buy` /
   `Pull from Inventory`, the same as a leaf. Because `methodMaterial.methodType` is denormalized
   from the component's `defaultMethodType`, the PARENT's line for that subassembly also read
   `Pull from Inventory` — so the imported multi-level BOM existed but never exploded in
   planning, and MRP would have raised a purchase order for a subassembly Carbon had a method
   for. A row with children is now minted `Make` / `Make to Order`. An EXISTING item that gains
   children but is still `Buy` is reported through a new `warnings` channel rather than
   overwritten: replenishment is a Carbon decision Onshape says nothing about.
2. **BOM-import assets were gated on `attachAssetsOnRelease`.** That setting is about releases
   that happen with nobody in Carbon, and its own in-app description says a BOM import brings its
   assets regardless. The gate contradicted both that description and the design decision that
   assets are not a switch of their own. Verified by setting it false: the import still attaches
   all 8.
3. **The outcome notification miscounted.** Its title counted only `skipped`, while it FIRED on
   four conditions — so a notification raised because a row could not be read announced
   "0 item(s) needing attention". Title and gate now both come from `countNeedingAttention`.
4. **The unreleased picker sent the element NAME as the part number.** An Onshape element's name
   and its part number are different fields that diverge freely; the part number is what becomes
   the Carbon item. A new v2 elements route reads the real part number from element metadata, and
   the picker now shows and sends it.
5. **The unreleased-import button rendered outside its padded column** and was clipped.
6. **A long part number widened the preview list past the modal.** `ModalBody` is a grid item, so
   it defaults to `min-width: auto` and a wide child expands the track.

A third adversarial audit was then run over this session's own diff. It confirmed the tree hoist,
the `rowId` keying, the conflict/adopt paths and the removed `partNumber` gate as safe, and found
seven more, all fixed:

7. **The Make fix broke the method TREE.** `get_method_tree` resolves a line's sub-method as
   `COALESCE(materialMakeMethodId, <fallback>)`, and the fallback fires ONLY for
   `Pull from Inventory`. Minting the subassembly as `Make to Order` while leaving
   `materialMakeMethodId` null therefore terminated the recursion: the sub-BOM was written to the
   database but vanished from the BoM explorer, the BOM API, the CSV export and cost roll-up.
   Confirmed live before fixing — `get_method_tree` returned TB-950 with a null sub-method and
   none of its four children. The import now points the parent's line at the method it actually
   reconciled into, which is more precise than the app's own `activeMakeMethods` lookup for an
   adopted item whose Active method is not the draft being imported to.
8. The Buy warning never checked the item being imported INTO, which is the one item the import
   definitely just gave a bill of materials to.
9. A failed lookup silently dropped every warning, turning "N need attention" into no
   notification at all.
10. 50 concurrent Onshape metadata calls with no rate-limit handling, where a 429 rendered as
    "No part number" — indistinguishable from an assembly that genuinely has none. Now sequential,
    and a failed read is reported.
11. The elements route's 50-assembly cap was silent; `truncated` was returned and never read.
12. An unreleased assembly with no part number rendered the confirm modal's title as one space.
13. A double period in the joined summary sentence.

## Audits

Two adversarial audit passes were run over the v2 code, both as multi-lens workflows with an
independent verifier per finding.

- Round 1: 28 confirmed, 3 refuted. Chief finding: a refused row was DELETED rather than left
  alone, because a refusal is absent from `desired` and reconciliation reads absence as removal.
- Round 2: 39 confirmed, 1 refuted, across six lenses. Chief findings: v2 release import was
  gated on the LEGACY `releaseImportEnabled` key so it never ran; the release job never
  re-resolved its target after the import, so a new revision silently displayed the PREVIOUS
  revision's geometry (`items_createRevision` copies `modelUploadId`); and a 429 during an asset
  export was recorded as a permanent skip, making `withRateLimitRetry` unreachable.

One bug class recurred in both rounds and is worth stating for whoever works here next: **the
element mapping is revision-agnostic.** It narrows to the part FAMILY; the revision picks the
member. Resolving from the mapping alone silently attaches revision A's data to the item at
revision C. Its inverse — treating two legitimate revisions of one part as a collision — bit
twice as well.

## Changelog

- 2026-08-18: Created.
- 2026-08-19: Round-2 audit findings fixed; per-item asset pull job added for the create and
  link flows; legacy backfill refused on a v2 company.
- 2026-08-19: Verified both remaining gaps live against a real Onshape release. Fixed the
  subassembly replenishment bug that pass found, added the outcome `warnings` channel, added the
  v2 elements route so the picker shows and sends the real part number rather than the element
  name, and fixed two modal layout defects.
- 2026-08-19: All six phases done and audited twice. Corrected the settings table to the shipped
  `releaseImportV2` enum. Recorded the unreleased-version browser, the import-outcome
  notification, and the collision criterion as met.
