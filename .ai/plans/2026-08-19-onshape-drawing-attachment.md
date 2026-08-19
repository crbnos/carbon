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

### 3. Webhook part-number gate — probably NOT needed

Superseded 2026-08-19 by an attempted release in the Onshape UI. **Onshape will not release a
drawing without a part number.** The Create Release candidate dialog renders the drawing's Part
number field empty, red and required, and blocks the release until it is filled.

So the premise recorded earlier — a drawing has no part number, therefore
`webhook.onshape.$companyId.ts:292` discards its revision — describes an *unreleased* drawing.
A drawing that has actually been released necessarily carries a number, and the gate never fires
for it. `TB-900-DRW` was assigned to the TB Test Bench drawing this way and persisted.

Do not relax that gate on the strength of the old reasoning. Confirm against a real released
drawing first; the gate may need no change at all.

Two related observations from the same attempt:

- **Releasing a drawing pulls its whole model tree into the candidate.** The TB Test Bench
  drawing produced a 10-item candidate: the drawing at revision A plus the assembly, the
  subassembly and seven parts, all bumping A → B and all marked "Item has not changed since its
  last revision." A released drawing therefore arrives in the same release package as its
  models, which makes `releaseId` grouping a viable fallback join if the references call ever
  fails.
- **Category is `Drawing`.** The item's properties panel shows Category = Drawing, distinct from
  the `/elements` listing's `elementType` of `APPLICATION`.

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

All of these want one real drawing release to settle them.

### Blocked: the drawing will not release

Attempted 2026-08-19 in the Onshape UI on TB Test Bench. Every action button — Apply, Submit,
Release — stays disabled while the drawing row shows a red **"Drawing has a pending update"**.
Filling the part number, the release name and notes, and adding an approver each cleared their
own validation without enabling the release. No update control for the drawing is exposed in the
document UI or the accessibility tree.

The drawing's views are stale against the model and Onshape wants them regenerated first. That
has to be resolved — in the drawing editor, or by whoever knows where that control lives — before
any of the three questions above can be answered.

Nothing was released: TB Test Bench's newest version is still `TB-REL-001` and no revision
exists for `TB-900-DRW`.

## Out of scope

- Multi-model drawings beyond refusing them. A user-established mapping row for the drawing
  element is the fallback if refusing proves too blunt, but do not build it speculatively.
- Onshape release notes and the 20 unread BOM columns — separate open questions in the spec.
