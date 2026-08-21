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

`releaseImportV2` collapses what the draft had as a switch plus a mode, so v2 needs no second
level of nesting at all.

### The form shows ONE pipeline's settings (revised 2026-08-19)

The selector is the only ungrouped field. Each pipeline's settings sit in a group gated on it —
Legacy pipeline (`assetSyncEnabled`, `releaseImportEnabled`, `releaseImportMode`, and the Backfill
action) or Onshape v2 (the three above). Only `webhookSigningSecret` is ungated: the receiver
verifies the signature before it branches on pipeline, so it applies to both.

This reverses the original decision to leave the legacy keys top-level and unconditional. That
decision was correct about the hazard and wrong about the remedy: a `visibleWhen`-hidden field
unmounts and posts nothing, and the save merges the parsed result over the stored metadata
(`{ ...existingMetadata, ...d }`), so a `.default(false)` on a hidden key WOULD silently disable a
customer's asset sync the first time they saved on v2 — and re-enable it, unasked, on switching
back. The fix is to drop the defaults, not to show both pipelines' settings at once: **every gated
key is `.optional()`**, so an absent key means "leave the stored value alone" and every reader
already treats it as its own default. `pipeline` keeps its default because it is never hidden.
Pinned by `lib/settings.test.ts`.

Two mechanism changes made this possible, both in `IntegrationForm`:

- `visibleWhen` now takes one condition OR an array of them, all of which must hold. `WhenVisible`
  evaluates one condition per component instance and recurses for the rest — `useControlField` is a
  hook, so one instance must read a fixed number of fields. `releaseImportMode` is the only field
  using it (pipeline, then its own switch).
- Every gated field must LEAD its `visibleWhen` with `pipeline`: a group is hidden wholesale on the
  first condition its settings share, so a different lead leaves a group header with nothing under
  it.
- Actions take `visibleWhen` too, replacing the single-boolean `enabledWhenSetting` (Onshape's
  Backfill was its only consumer). Gating on the setting alone left the button visible on a v2
  company still carrying `assetSyncEnabled: true` from before the switch, which the backfill route
  refuses outright.

The zod schema moved out of `config.tsx` to `onshapeSettingsSchema` in `lib/settings.ts`, so it can
be unit-tested without the auth env `ONSHAPE_CLIENT_ID` pulls in.

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
7. **Done** (2026-08-21). Drawing attachment — resolved by element id through
   `appelements/.../references`, never by part number. Plan:
   `.ai/plans/2026-08-19-onshape-drawing-attachment.md`.
8. **Done** (2026-08-21). Release provenance — release name and notes into both
   the change notice and a delimited block in `item.notes`.
9. **Done** (2026-08-21). Auto-create on release, as a per-company v2 toggle.
10. **Next.** Create a part from Onshape inside the New Part form. Spec:
   `.ai/specs/2026-08-20-onshape-create-part-from-new-part-form.md`.

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
      Drawing PDFs ARE attached as of Phase 7 (2026-08-21), joined by element id
      through `appelements/.../references` — never by v1's suffix matching, which is
      disproved on real data (see the drawing section above).
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
suffix**.

### Resolved 2026-08-19: Onshape names the referenced element outright

Verified live against the connected Onshape account. The join is an id lookup,
not a string match, and needs no naming convention from the customer.

    GET /api/v10/appelements/d/{did}/{wvm}/{wvmid}/e/{eid}/references

Against `3043b4598e6e8d07fa7f3e45` (`RD-410 Wandleser RFID Drawing 1`) it returns
200 with **9 reference records resolving to 2 distinct targets**:

| `targetElementId` | What it is |
|---|---|
| `71d063cabedf14392964ab6d` | `RD-410 Wandleser RFID` — the ASSEMBLY the drawing documents |
| `7eaf0733dba8077e29eef6d2` | the BILLOFMATERIALS element embedded on the sheet |

Each record carries `targetDocumentId`, `targetElementId` and
`targetConfiguration`. `{targetDocumentId}:{targetElementId}` is exactly what
`buildElementExternalId` produces:
`fd15a005d9711c2535b11835:71d063cabedf14392964ab6d` is byte-identical to a row
already in `externalIntegrationMapping`, resolving to `RD-410.A`. Confirmed by
direct lookup against the local database.

**Resolution rule.** Dedupe the targets, drop element types that are not a Part
Studio or Assembly (which removes the BOM element), and exactly one survives →
its mapping row is the item to attach the PDF to. Two or more surviving model
targets is a drawing that genuinely documents more than one thing; refuse. That
is a real ambiguity criterion, unlike the accidental collision suffix matching
produced.

**A drawing's `elementType` is `APPLICATION`, not `DRAWING`.** The `/elements`
listing returns `APPLICATION` for this drawing, and the references endpoint
rejects every other element type with `400 "Element must be an application"` —
it is purpose-built for this one. Both v2 refusal branches
(`resolve.ts:61`, `onshape-release-v2.ts:105`) test numeric `elementType === 2`
(DRAWING). Whether a released drawing's webhook carries `2` is **untested**;
confirm before relying on either branch. Currently masked because the part-number
gate below fires first.

**The webhook gate blocks the release path regardless.**
`webhook.onshape.$companyId.ts:292` refuses to dispatch without a `partNumber`,
and a drawing has none. It needs a drawing-shaped exception or the resolver is
never reached on release, however good the join is.

**Untested:** probed at workspace level (`/w/{wid}/`). The drawing is not present
in version `05ba9d4e8ffbcbc9cee29003` (rev A), which holds only the part studio,
two assemblies and two BOM elements — so version-level behaviour is unverified,
and whether this customer releases drawings at all is unknown.

**Already built, currently unused:** `createDrawingTranslation` (PDF export,
`client.ts:437`) and `syncOnshapeDrawingAssetsToItem`
(`onshape-sync-element.ts:314`). Only the join was missing.

Superseded candidates, kept for the record: exact part-number equality scoped to
the document (fails — the drawing has no part number), and a user-established
mapping row for the drawing element (still the right fallback for a drawing whose
references resolve to more than one model).

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
- **Drawing attachment.** Not built. The join is no longer the unknown — it is solved and verified
  (see the drawing section): `appelements/.../references` names the referenced element id directly.
  What remains is wrapping the endpoint, a resolver, and relaxing the webhook's part-number gate.
  Until then v2 refuses rather than guessing.
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
- 2026-08-19: Drawing attachment unblocked. Verified live that
  `appelements/d/{did}/{wvm}/{wvmid}/e/{eid}/references` returns the referenced element id, so the
  drawing → model join is an id lookup into the existing mapping. Recorded the resolution rule, the
  `APPLICATION` vs `DRAWING` elementType discrepancy, and the webhook part-number gate that still
  blocks the release path. Scoped as Phase 7 —
  `.ai/plans/2026-08-19-onshape-drawing-attachment.md`.
- 2026-08-19: Settings form split by pipeline — each pipeline's group is hidden by the other's
  selection, every gated key became `.optional()` so a hidden field stops rewriting the other
  pipeline's stored settings, `visibleWhen` gained multi-condition support, actions gained
  `visibleWhen` in place of `enabledWhenSetting`, and the schema moved to `lib/settings.ts`.
  Verified in the browser on the local stack. **Uncommitted on `feat/onshape-import-revisions`.**
- 2026-08-21: Scope decisions taken with Raul, ahead of the Phase 7/8 build.
  - **Part number and revision are Onshape's, and are not editable in Carbon.** `v2.create`'s
    current behaviour is confirmed as intended, not provisional. A user who needs a different
    number duplicates the item via Get Method into a part with no Onshape mapping, rather than
    editing an Onshape-owned identity in place. The `readableId`-keyed family probe in release
    import and BOM import therefore stays as-is.
  - **Auto-create on release becomes a setting**, not a permanent refusal. A new v2 toggle
    governs whether a released element with no linked Carbon item is created rather than skipped
    with "Link it, or import its assembly, first." Off preserves today's behaviour. Still needs a
    rule for the replenishment/tracking defaults that motivated the original refusal (a Buy leaf
    part minted as Inventory/Make poisons MRP).
  - **Translations: out of scope.** The 55 empty `msgstr` entries stay for upstream's own
    `pnpm translate` pass.
  - **Onshape configurations: out of scope.** The `buildElementExternalId` configuration gap is
    not being closed in this cycle.
  - **Release name and release notes: still open**, to be mapped per integration path in a
    dedicated pass. Blocking fact found while scoping it: `OnshapeRevision` carries `releaseId`
    and `releaseName` only — release NOTES appear in no payload the client reads, and
    `OnshapeClient` has no release-package method. Capturing notes needs a new endpoint wrapper,
    not just a destination decision.
  - No PR until development and substantial testing are done.
- 2026-08-21: Release name and notes — decided, and the release package probed live.
  `GET /api/v10/releasepackages/{rpid}` returns 200; the webhook's `releaseId` IS the `rpid`.
  Confirmed against `eff3a8e5ba701fc7bffb3191` ("TB-REL-001 Test Bench Erstfreigabe"):
  - Release name — top-level `name`, property id `594964b7040fc85d2b418138`, plain string, 2–128 chars.
  - Release notes — top-level `description`, property id `594964df040fc85d2b418144`, plain string,
    max 10000 chars.
  - A third field nobody had accounted for: `Comment`, property id `594964df040fc85d2b418145`,
    max 8192 chars, plus `comments`/`parentComments` discussion arrays. Ignored by decision —
    a discussion artifact, not engineering intent.
  - `Approvers` (`59403fa4040fc83120937a90`, `isApproverProperty: true`) and `Observers`
    (`59496726040fc85d2b4181bd`). **Empty on the test package** — the workflow had none
    configured. Any approver-bearing output is only as good as the customer's release workflow.
  - State lives at `workflow.state.name` / `metadataState` / `workflow.currentStateDisplayName`.
  - Read both by `propertyId`, never by display name — display names are localizable, which is
    the exact fragility already called out for BOM columns.
  - `items[]` returns the release's FULL membership on the first call. The "no release-level
    event" premise remains true of events, but membership no longer requires waiting for N
    deliveries. Not acted on; recorded because it makes release-complete output feasible.
  **Destinations (both, not either):**
  - Change notice (per release): notes → `reasonForChange`, provenance moves to
    `sourceType: "onshape"` + `sourceId: releaseId`. Verify `items_insertChangeNotice` accepts
    those two params; if not, provenance goes to `description` and the rest is unchanged.
  - Item (per item, every item the integration touches): a formatted block in `item.notes`.
    `createRevision` does NOT copy `notes` — verified in `items.service.ts:197` — so a new
    revision starts empty and release details never accumulate across revisions.
    **Written as a DELIMITED block, replaced in place on every touch**, so anything a human
    wrote above or below survives. Blind overwrite is not acceptable: `item.notes` is
    user-editable. Formatting is available — the editor registers StarterKit plus Table,
    TableRow, TableCell, TableHeader and TaskList.
  Both are plain strings from Onshape and both destinations are tiptap JSON, so a shared
  plain-text → doc-node helper is needed.
  **Release-package PDF: evaluated and deliberately deferred.** Feasible and cheap — the
  `@react-pdf/renderer` pipeline, job-side rendering, and `attachOnshapeAssetsToItem`
  (arbitrary `{fileName, bytes}`, replace-not-append) all already exist. Not built because
  item notes capture most of the value at a fraction of the cost, and the same data feeds a
  PDF later. Note `documentSourceType` has no change-order member, so a PDF could only attach
  to items, never to the notice.
- 2026-08-21: **Phase 7 done.** Drawing attachment ships, resolved by element id.
  `getAppElementReferences` on the client; `lib/drawing.ts` holds a pure
  `chooseDrawingModelTarget` plus the async `resolveDrawingModelItem`;
  `readItemsForElementIncludingParts` in `mapping.ts` fixes the partId blind spot
  (a reference record carries no partId, so an exact externalId match finds
  nothing for a drawing of a Part Studio body). The released revision then
  narrows the family through `resolveBomRow`.
  Verified live that version-level references work (the plan recorded this as
  unverified) and that `referenceType` is useless as a discriminator — it is `0`
  for the assembly and the BOM element alike, so the element listing is required.
  Four call sites: the release job's drawing-first branch, its model-first pass,
  `onshape-v2-item-assets` (create + link, which also gained the notification it
  never had), and the BOM import once per document-version.
  The webhook needed NO change, now pinned by two tests. Still unproven: that a
  released drawing's webhook carries `elementType === 2` — no released drawing
  exists, and the release is blocked on "Drawing has a pending update".
- 2026-08-21: **Phase 9 done.** `createItemsOnRelease`, a v2 switch, default OFF and
  read strictly `=== true`. The three gates that would have made it a silent no-op are
  closed and pinned by tests: the receiver's early bail, its v2 dispatch condition,
  and `webhookWanted` on save (which would otherwise DELETE the subscription of a
  company that enabled auto-create and nothing else).
  **The replenishment rule** — the only contestable part — is
  `mintDefaultsForRelease` in `packages/jobs/.../onshape-mint.ts`: assembly →
  Make / Make to Order, part studio body → Buy / Pull from Inventory, plus Inventory
  tracking and EA. Chosen because it is the SAME answer the BOM import already
  derives from having children, reached from `elementType`, so one part cannot
  classify two ways depending on which door it came through. Its known cost is
  stated rather than hidden: an assembly minted Make has an empty Draft make method,
  so planning briefly sees something buildable out of nothing. There is no option
  that avoids both that and the purchased-leaf failure without also importing the
  BOM, so the mitigation is REPORTING — every creation is named in the notification
  with what Carbon assumed. **Raul has not signed off on this rule; it is the
  default I took to keep moving.**
  The mint probes the readableId family first and refuses a number already taken by
  an unmapped item, since `item_unique` cannot catch a same-family duplicate.
  Migration `20260821120000_onshape-auto-create-jsonschema.sql` declares the key.
- 2026-08-21: **Live verification of Phases 7, 9 and 10 on the local stack against the
  real Onshape account.** 15/15 library checks plus real webhook deliveries through the
  receiver and the job.
  - **Phase 7 is proven with a REAL released drawing.** The plan's "the drawing will not
    release" blocker is stale: `TB-900-DRW` revision A exists, and the revisions API
    reports `elementType: 2` for it — the last open question. A real delivery attached
    `TB-900-DRW.A-048841a06015cccd275a71ef.pdf` to `item_HDPsKuNTqZU1uUYTMqJeig`
    (TB-900 revision A), the MODEL item. No DRW item was minted; no change notice was
    created for the drawing.
  - **Phase 9 works, and live testing found a defect the unit tests could not.** The
    block rendered an `Imported:` timestamp, so every webhook redelivery rewrote the
    item — an audit-log row and a customer webhook delivery for a note whose content had
    not changed. A unit test passes the same clock value twice and cannot see it. The
    field is removed; the block is now a pure function of the release, the sync time
    already lives in the mapping's `lastSyncedAt` and in `item.updatedAt`, and a
    redelivery is now byte-identical and writes nothing. Confirmed by two deliveries of
    the same release.
    The real German release notes came through intact end to end.
  - **Phase 10 verified on all three paths.** Auto-create ON minted the part with the
    assembly defaults (Make / Make to Order / Inventory / EA), its mandatory `part` row,
    both mappings and its provenance block. The family probe REFUSED a number already
    held by an unmapped item rather than minting a second family member with no lineage.
    Auto-create OFF preserved today's refusal message verbatim.
  - Not exercisable on this install: the refusal NOTIFICATION, because the integration's
    `updatedBy` is literally `"system"` and the notify path skips that by design.
- 2026-08-21: **Change-notice half of Phase 9 verified live.** A release naming a revision
  Carbon does not hold (MC-101 rev B, release `next-release-v1`) produced `CN-000010`:
  `name` = "Onshape release next-release-v1", `sourceType` = `onshape`, `sourceId` =
  `83334b23e3a44dadd8f0625f`, and `reasonForChange` carrying Onshape's own words —
  "These are release notes for v1 next release" — as tiptap rich text. The two
  previously-unused `changeOrder` columns are now written, and by nothing else.
  Re-firing a release whose revision Carbon already holds returns
  `revision-already-imported` and creates no second notice.
  **Legacy is provably untouched:** `writeProvenance` is passed by the v2 job alone, the
  legacy release-import job passes neither it nor a release package, and
  `onshape-backfill`, `onshape-revision-sync` and `onshape-attach` contain zero
  provenance writes.
  **Drawing document naming was corrected during verification.** Drawing-first named the
  PDF after the DRAWING's part number and model-first after the MODEL's, so one drawing
  became two document rows on one item depending on which event arrived. Both now name it
  after the item's `readableIdWithRevision`; verified live that the two paths converge on
  a single row.
- 2026-08-21: **Replenishment unified with the legacy integration's mapping, at Raul's
  prompt.** The legacy BOM route reads an Onshape column, "Purchasing Level"
  (`Purchased` → Buy, else Make), and the Field-ownership section above already named it
  the right seed. Phase 10's first cut ignored it and inferred from `elementType`, and
  the v2 BOM import inferred from having children — three rules for one decision.
  Now one: `resolveOnshapeReplenishment` (`packages/jobs/.../onshape-replenishment.ts`),
  used by BOTH the BOM import and the release mint.
  - Purchasing Level wins when present, in both directions — a declared-Purchased
    assembly is Buy, a declared-Manufactured leaf is Make.
  - Absent falls to STRUCTURE (children / element type), NOT to legacy's blanket
    "Make", which is the recorded MRP defect in the 2026-08-13 plan.
  - Verified live that the column is **company-defined, not stock**: absent from the 26
    stock BOM columns AND the 19 stock element metadata properties, and this company
    defines no custom properties at all. So the legacy rule is INERT here and calls
    everything Make — which is exactly the defect.
  - The release path reads it from `getElementMetadata` (no BOM to read), one extra call
    on the auto-create branch only, non-fatal.
  - Matched on DISPLAY NAME, case- and whitespace-insensitively. A company-defined column
    has no stable propertyId; this is the fragility the deferred "extensible custom-field
    mapping" question would close.
  **Not proven:** that a real custom "Purchasing Level" property comes back in
  `getElementMetadata`'s `properties` array under its display name. No account available
  that defines one. The BOM half is as proven as legacy's, since it reads the same
  headers by the same name. Verified live instead: both structural fallbacks (assembly →
  Make / Make to Order, part studio body → Buy / Pull from Inventory) and that a failed
  metadata read does not stop the part being created.
- 2026-08-21: **"Purchasing Level" created in Onshape and the whole path proven end to end.**
  The caveat from the previous entry is closed — a custom property DOES come back from
  `getElementMetadata` under its display name.
  Created in Carbon company settings → Properties (`6a7b5c57fbca14e231f62cca`):
  - name / display name **Purchasing Level**, id `6a882bf6d9b435cf25eebd37`
  - type **Text**, publish state **Active**, editable in workspace AND version
  - categories **Assembly** and **Part**
  **Text, not List, deliberately.** A List property returns its DISPLAY LABEL in the BOM
  but a numeric id in element metadata — `State` comes back `"Released"` in the BOM and
  `2` in `getElementMetadata` on the same element. A List "Purchasing Level" would
  therefore read as an id on the release path and never match `"Purchased"`. Text returns
  the literal string on both. **If a customer defines theirs as a List, the release path
  will not match it** — that is a real limitation to check on any account before relying
  on it, and the reason it is called out here.
  Verified live, with values set through `POST /api/v10/metadata/d/{did}/{wvm}/{wvmid}/e/{eid}`:
  - **The release path**: SA-800 (an ASSEMBLY, which structure calls Make) declared
    `Purchasing Level = "Purchased"` was auto-created as **Buy / Pull from Inventory**.
    Onshape overrode the structural guess, which is the whole point of the precedence.
  - **The BOM path**: the column now appears in the BOM response as header
    `6a882bf6d9b435cf25eebd37`, and SA-800's row carries `"Purchased"` while unset rows
    carry `null` — so `row.columns["Purchasing Level"]` resolves exactly as legacy reads it.
  The test VALUES were cleared afterwards (SA-800 and RD-410 are genuinely assemblies with
  children; leaving them declared Purchased would be wrong data). The PROPERTY remains in
  place and ready to use.
