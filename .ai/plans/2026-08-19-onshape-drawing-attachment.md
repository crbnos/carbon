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

- **Does the webhook carry `elementType === 2` for a released drawing?** Largely resolved
  2026-08-19: the company revisions API reports `elementType=1` for every released assembly
  (RD-410, SA-800, TB-900, TB-950) and `elementType=0` for every released part (EL-402, PK-410,
  MC-101 …), which is exactly the numeric scheme `resolve.ts:61` and `onshape-release-v2.ts:105`
  assume. The `APPLICATION` label is the `/elements` listing's *string* encoding — a different
  API, not a contradiction. `2` for a drawing is unproven only because no released drawing
  exists; there is no longer a reason to doubt it.
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

## Live probe, 2026-08-21 — two open questions closed

**Version-level references WORKS.** The plan recorded `/v/{vid}/` as unverified because the
drawing was absent from version `05ba9d4e8ffbcbc9cee29003`. Probed against a version that DOES
contain it:

    GET /api/v10/appelements/d/fd15a005d9711c2535b11835/v/7aee8286bc4bc3c03d764cb4
        /e/3043b4598e6e8d07fa7f3e45/references   -> 200

Nine records, two distinct targets — byte-identical to the workspace-level result:
`71d063cabedf14392964ab6d` (the RD-410 assembly, x5) and `7eaf0733dba8077e29eef6d2` (the
embedded BILLOFMATERIALS element, x4). Reproduced on a second version
(`d2aff3a44349d31791ecd973`, "approver-less-release"). The earlier 404 was element-absence,
not a version-level limitation. Since a release reads at a version, this was the question that
mattered.

**`referenceType` does NOT distinguish targets — the element listing IS required.** The record
carries 27 fields including `referenceType`, which looked like a way to drop the BOM element
without a second call. It is `0` for all nine records, on both targets. Every other
discriminating field (`partNumber`, `revision`, `partIdentity`, `targetVersionId`) is `null`.
So step 2.3 stands as written: resolve element types from the document's element listing.
`GET /documents/d/{did}/v/{vid}/elements` returns `elementType` as a STRING enum —
`PARTSTUDIO`, `ASSEMBLY`, `APPLICATION`, `BILLOFMATERIALS` — which is what separates the
assembly from the BOM element. Do not reach for the numeric scheme here; that is the revisions
API's encoding, a different API.

**Still open:** whether the webhook carries `elementType === 2` for a released drawing. Needs a
real drawing release, which remains blocked on "Drawing has a pending update".

## VERIFIED END-TO-END, 2026-08-21 — the blocker is gone

The "Blocked: the drawing will not release" section above is **stale**. A drawing
has since been released:

    TB-900-DRW  revision A  elementType 2
    document 997fcd04b96765675348a2d8 / version 7f8df6f93a0410cb38b85db5
    element  048841a06015cccd275a71ef
    release  eb2d54b6ecfef166ef54b271 ("test release name")

**The last open question is answered: the revisions API reports `elementType: 2`
for a released drawing**, exactly the numeric scheme `resolve.ts` and
`onshape-release-v2.ts` assume. The `APPLICATION` label is the `/elements`
listing's separate string encoding, as recorded.

Fired that identity at the local receiver as a real `onshape.revision.created`
delivery. Result:

    document row: TB-900-DRW.A-048841a06015cccd275a71ef.pdf
    attached to:  item_HDPsKuNTqZU1uUYTMqJeig  (TB-900, revision A)

That is the MODEL item at the released revision — resolved through
`appelements/.../references` → element listing → element mapping → `resolveBomRow`.
No `TB-900-DRW` item was minted, and no change notice was created for the
drawing. The filename carries the drawing element id, so a second drawing of the
same model cannot overwrite the first.

Also verified in the same pass (15/15 live checks, harness preserved at
`onshape-integration/scripts/onshape-live-verification.test.ts` in the project
directory — it is deliberately NOT in the repo, since it needs live credentials
and would fail in CI):

- version-level references return the same nine records as workspace level;
- the drawing is found by `dataType`, and the BOM element is dropped, leaving
  exactly one model target;
- the prefix mapping reader finds nine PART-LEVEL rows an exact externalId match
  would have missed — the partId blind spot is real and closed;
- a revision Carbon does not hold is REFUSED (`drawing-model-revision-missing`)
  rather than mis-attached to whatever revision happened to be mapped.
