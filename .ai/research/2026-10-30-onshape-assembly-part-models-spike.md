# STEP models and drawings on an assembly push — spike results

Live checks for Task 1 of `.ai/plans/2026-10-30-onshape-assembly-part-models.md`, run on 2026-10-30 against a local stack with the `onshape-v2` dev app. The checks used two test documents: a two-part Part Studio with one assembly, and a five-module assembly with one drawing.

## Results

| Check | Result |
|---|---|
| Single-part STEP (`partIds`) | Pass. One part of a two-part Part Studio, and one part of a three-part Part Studio, each export as one solid (`MANIFOLD_SOLID_BREP` ×1, `PRODUCT` ×1). |
| Element list for drawings | `getElementsIn(…, "DRAWING")` returns `[]`. Onshape lists a drawing as `elementType: "APPLICATION"`, `dataType: "onshape-app/drawing"`. The filter `elementType=APPLICATION` returns it, with its `microversionId`. |
| Drawing microversion | Each element row carries `microversionId`, drawings included. The references cache can key on it. |
| `resolvereferences` shape | `{ resolvedReferences: [ … ] }`, one entry per view reference. Each entry has `targetDocumentId`, `targetElementId`, `targetConfiguration` (`"default"`), `idTag`, `partIdentity`, `referenceType` (3 for a part), `targetElementMicroversionId`, `partNumber` (null). It has no `partId` field. |
| Part of a reference | `idTag` equals the BOM row's `itemSource.partId` (`JFL` = `JFL`), and `partIdentity` equals the row's `itemSource.partIdentity`. |
| Per-item microversion in the BOM | Each `itemSource` has `sourceElementMicroversionId`: the Part Studio's element microversion, not the part's. The part push keys a model on the part's microversion, so the job still reads part microversions. |
| Parts of a whole document | `GET /api/v10/parts/d/{did}/w/{wid}` returns every default-configuration part of the document (372 in the five-module document), each with `elementId`, `partId` and `microversionId`. Each microversion equals the value `getPartsInElement` returns. One call replaces one call per Part Studio. |
| Model identity with the part push | Pass. A part push of a part the assembly push exported reused the same `modelUpload` row and made no translation. |
| Workspace drawing PDF | Pass. `runOnshapeDrawingSync` with `sourceWvm: "w"` exported the drawing and attached `<partNumber>-<drawingElementId>.pdf` (97 KB) to the item: 1 translation, polls, 1 download. |

## Onshape calls measured

| Action | Calls |
|---|---|
| Review of an assembly with one source document | 3: BOM, element metadata, drawing list |
| First STEP export of one part | 6: parts read, translation, 3 polls, download |
| Re-push with All: one unchanged part, one new part, the root | 12, and 0 for the unchanged part |
| Part push of a part the assembly push exported | 1: the review's parts read; no export |

## Second live check, after the fixes

| Check | Result |
|---|---|
| Review of the cover module | The review offers "Drawings (1)" on the bay cover part. The drawing ties through `idTag` `JFL`. The part's model, exported earlier, shows as current. |
| Push of the drawing | The job exports the PDF, records its source key, and counts the current model as unchanged without an export. |
| Re-review | The model and the drawing both show as current. |
| PDF deleted from the item | The next review offers the drawing again; the next push exports it again. |
| New model through the new export function | One part's model exports; the next review marks it current, so the review and the job compute one model id. |
| Review of the full aircraft | The aircraft uses a copy of the cover Part Studio. The review lists the cover drawing as "shows nothing in this push" and ties it to no row. |

| Action | Calls |
|---|---|
| Review of the cover module, drawing references not cached | 5: BOM, element metadata, drawing list, references, document parts |
| Review of the cover module, drawing references cached | 4 |
| Review of the full aircraft, no row holds files | 3: BOM, element metadata, drawing list |

## Local stack notes

- With `crbn up --no-portless` on Linux, the Inngest container cannot reach the ERP: the ERP listens on `127.0.0.1:3000` and the container's `localhost` resolves to the Docker host gateway. Every run fails with "Unable to reach SDK URL". A forward from `172.17.0.1:3000` to `127.0.0.1:3000` (`socat`) made the runs succeed.
- Onshape cannot call a `localhost` webhook. An export that is not done after the six quick polls waits about 5 minutes for each later poll.
