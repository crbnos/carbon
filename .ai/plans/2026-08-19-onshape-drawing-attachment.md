# Onshape v2 — drawing attachment (Phase 7)

> Status: not started
> Author: Raul Soonawala
> Date: 2026-08-19
> Spec: `.ai/specs/2026-08-18-onshape-integration-v2.md` — "Drawing attachment"

## TLDR

Attach a released Onshape drawing's PDF to the Carbon item its model produced, joined by
element id rather than by part number. The join was the blocker and it is now verified live:
`appelements/.../references` names the referenced element outright, and that id is already a
key in `externalIntegrationMapping`. The PDF export and the attach both already exist and are
unused. What is missing is the resolver between them, plus one webhook gate.

## Why this is not "finish the v1 mechanism"

v1 matched a drawing to its model by stripping the part number to a shared suffix and
`ILIKE '%<suffix>'`. Disproved on real data: `RD-410`, `DRW-410` and `PK-410` all reduce to
`-410`, matching five items across two parts. Any drawing numbered against `RD-410` is
permanently `ambiguous-item`. That is ordinary customer numbering, not a mistake, so the
mechanism is unsalvageable rather than buggy.

## What is already verified

Against the connected Onshape account, 2026-08-19:

    GET /api/v10/appelements/d/{did}/{wvm}/{wvmid}/e/{eid}/references

For `3043b4598e6e8d07fa7f3e45` (`RD-410 Wandleser RFID Drawing 1`): 200, an array of 9 reference
records resolving to 2 distinct targets — the RD-410 ASSEMBLY (`71d063cabedf14392964ab6d`) and
the BILLOFMATERIALS element embedded on the sheet (`7eaf0733dba8077e29eef6d2`). Each record
carries `targetDocumentId`, `targetElementId`, `targetConfiguration`.

`fd15a005d9711c2535b11835:71d063cabedf14392964ab6d` is byte-identical to an existing
`onshapeElement` mapping row resolving to `RD-410.A`. Confirmed by direct lookup.

The endpoint rejects every non-application element with `400 "Element must be an application"`.
A drawing's `elementType` in the `/elements` listing is `APPLICATION`.

## What is already built and unused

- `OnshapeClient.createDrawingTranslation` — `client.ts:437`, PDF export.
- `syncOnshapeDrawingAssetsToItem` — `onshape-sync-element.ts:314`, exports one drawing element
  as PDF and attaches it as a document on a given item. Its doc comment still describes the
  caller resolving the item "by shared part number"; that comment is now wrong and should change
  with this work.

## Work

### 1. Wrap the endpoint

`getAppElementReferences(documentId, wvm, wvmId, elementId)` in
`packages/ee/src/onshape/lib/client.ts`, mirroring the existing methods. Returns the raw record
array; the shape above is stable enough to type narrowly on
`targetDocumentId` / `targetElementId` / `targetConfiguration` and ignore the rest.

### 2. Resolver

New function in `packages/ee/src/onshape/lib/resolve.ts` (or a sibling): drawing element →
Carbon item.

1. Call the references endpoint.
2. Dedupe on `{targetDocumentId}:{targetElementId}`.
3. Drop targets whose element type is not Part Studio or Assembly. This removes the BOM element.
   The element type is not on the reference record, so this needs the document's element listing
   (one extra call) or an equivalent check.
4. Exactly one survivor → `getElementMapping` on that externalId → the item. Attach there.
5. Zero survivors → skip, reason `drawing-references-no-model`.
6. Two or more → refuse, reason `drawing-references-many`, naming each. This is a genuine
   ambiguity, not the accidental kind v1 produced.

Refusals go through the existing `warnings` channel so they reach the import-outcome
notification rather than vanishing.

### 3. Relax the webhook part-number gate

`apps/erp/app/routes/api+/webhook.onshape.$companyId.ts:292` refuses to dispatch a
`revision.created` without a `partNumber`. A drawing has none — the RD-410 drawing's
`Part number` is null, re-confirmed 2026-08-19 — so the release path never reaches the resolver
however good the join is.

Needs a drawing-shaped exception that does not weaken the gate for models. Keep the existing
refusal for anything that is neither, and keep it ahead of the v2 branch so legacy dispatch is
unaffected.

### 4. Call it from the three paths

BOM import, create-from-Onshape, and the v2 release job. The first two already pull assets for
the tree; drawings should ride the same run rather than becoming a fourth journey — that was one
of the original complaints about v1.

## Open questions to settle first

- **Does the webhook carry `elementType === 2` for a released drawing?** Both v2 refusal branches
  (`resolve.ts:61`, `onshape-release-v2.ts:105`) assume so, but the REST listing calls a drawing
  `APPLICATION`. If the numeric code differs, those branches are dead and the new code must not
  inherit the same assumption. Untestable without a real drawing release.
- **Version-level behaviour.** The references probe ran at workspace level (`/w/{wid}/`). The
  drawing is not in version `05ba9d4e8ffbcbc9cee29003` at all, so `/v/{vid}/` is unverified —
  and a release reads at a version.
- **Does this customer release drawings?** If the drawing is never part of a released version,
  the release path is moot and only the import/create paths matter.

All three want one real drawing release to settle them. Worth doing before building step 3.

## Out of scope

- Multi-model drawings beyond refusing them. A user-established mapping row for the drawing
  element is the fallback if refusing proves too blunt, but do not build it speculatively.
- Onshape release notes and the 20 unread BOM columns — separate open questions in the spec.
