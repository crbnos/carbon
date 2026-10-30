# STEP models and drawings on an assembly push — implementation plan

Status 2026-10-30: drafted from main at ff57b9745c. No code written. The decisions below need a yes before Task 1. The branch already carries the Fields column overrides (`feat/onshape-standard-field-mapping`) and the sync change-notice fix (`fix/onshape-sync-change-notice-draft`), so line numbers quoted from main may have moved.

**Branch:** `feat/onshape-v2-improvements`, off main.
**Closest sibling:** the part push (`pushOnshapePart`) for what a part export sends and for per-row selection; the backfill (`onshape-backfill.ts`) for exporting many items from one run; the release push for drawing PDFs on model items.

## Goal

- An assembly push can also bring STEP models and drawing PDFs onto the items in its BOM.
- In the review, the person pushing picks per row which items get a STEP model, drawings, both or neither.
- Today an assembly push exports one STEP, the assembly's own (`pushOnshapeAssembly`, `settings.service.ts` ~6860). Child items get a link only. No push except a release brings drawings.
- Onshape is not the limit for models: each BOM row names the part's document, element, part id and configuration.
- Drawings need one new Onshape read. Outside a release, nothing in Carbon ties a drawing to the part it shows. Releases use the release package (`drawingModels`, `panel/releases.ts`), and the code notes a drawing's part number can differ from its model's.

## Decisions (recommendation first)

- D1 Per-row choice in the review. An eligible row shows a STEP toggle, and a Drawings toggle when it has drawings. Above the list, All and None controls for each kind. Nothing is selected by default, to save quota.
- D2 STEP toggles on part rows and sub-assembly rows. The root assembly's model export stays automatic, as today.
- D3 Drawings toggles on every eligible row: the root, sub-assemblies and parts.
- D4 No toggles on standard-content rows (Onshape's fastener library).
- D5 No toggles on a row whose item is released in Carbon, linked to a different Onshape source, or claimed by two sources. Its files come from its own push.
- D6 A drawing attaches to one row. A reference to an assembly in the push wins. Else the single part it shows. A drawing that shows several parts, or none from the push, is listed as skipped in the review.
- D7 A drawing PDF is named `<partNumber>-<drawingElementId>.pdf`, as the element sync already names drawings. Never `<partNumber>-<revision>.pdf`: the Releases tab reads that name as "released drawing in Carbon".
- D8 Drawings are found only in the documents the pushed items come from. A drawing kept in a separate drawings document is not found.
- D9 Drawings are found at PLAN, so the review can show them. Each drawing's references are cached by its microversion, so a later review reads only new or changed drawings.
- D10 One export run per company at a time, two files at a time. This keeps one large push from taking the five shared assembler slots from other companies.
- D11 One Onshape export per part. Not chosen: split the assembly's STEP into parts inside Carbon. It costs no extra calls, but it needs a mapping from STEP components to items that does not exist.

## Cost

- Every review: one call per source document to list its drawings, plus one per new or changed drawing to resolve its references.
- A selected new or changed STEP model: about 3 to 10 calls (start the translation, polls, maybe a webhook pair, the download).
- A selected new or changed drawing: about 3 to 10 calls for the PDF.
- A selected unchanged model or drawing: no call. Models skip in the export job's `existing` step (`partSourceId`, `onshape-sync-element.ts`); drawings skip by their recorded source key (Task 11).
- Part microversions for the skip: one call per Part Studio and configuration in a workspace. Linked-document parts are pinned to a version and need none.
- Today a drawing translates on every run (`runOnshapeDrawingSync` has no skip). Task 12 adds the skip.
- The v2 app is private, so every call bills the owner's yearly quota (50,000 per the 2026-10-17 notes). A first push with 200 new models and 50 drawings selected spends roughly 800 to 2,600 calls. A public App Store app is exempt.

## Progress

- [ ] Task 1: Confirm the Onshape behaviour the plan needs
- [ ] Task 2: Pure builder for the model exports
- [ ] Task 3: Pure builder for the drawing ties
- [ ] Task 4: Onshape client reads for drawings
- [ ] Task 5: Drawing references cache
- [ ] Task 6: Plan lists each row's model and drawings
- [ ] Task 7: Review toggles and apply body
- [ ] Task 8: Apply input takes the choices
- [ ] Task 9: `linkChildParts` returns the final links
- [ ] Task 10: Event and trigger key
- [ ] Task 11: Drawing source record
- [ ] Task 12: Assets export job
- [ ] Task 13: Apply queues the exports
- [ ] Task 14: Push result text
- [ ] Task 15: Docs, rule and AGENTS.md
- [ ] Task 16: Typecheck, tests, lint
- [ ] Task 17: Live check in the panel

## Dependencies

- Task 1 gates everything.
- Task 6 needs Tasks 2, 3, 4 and 5. Task 7 needs Task 6. Task 12 needs Tasks 4, 10 and 11.
- Task 13 needs Tasks 6, 8, 9 and 12. Task 14 needs Task 13.
- Tasks 2, 3, 4, 5, 8, 9, 10 and 11 are independent of each other.

---

## Task 1: Confirm the Onshape behaviour the plan needs

**Depends on:** none
**Files:**
- Create: `.ai/research/2026-10-30-onshape-assembly-part-models-spike.md` — the results

**Steps:**
1. Use the local stack with the v2 dev app connected. Raul does any OAuth consent.
2. Single-part STEP: push one part of a Part Studio with three or more parts. Count the bodies in its model.
3. Workspace drawing PDF: export one drawing from a workspace with `createDrawingTranslation` and `wvm: "w"`.
4. Drawing list: call `getElementsIn(document, "DRAWING")`. Record whether each row has `microversionId`.
5. Drawing references: call `GET /api/v10/appelements/d/{did}/{wvm}/{wvmid}/e/{eid}/resolvereferences` on three drawings: one of a single part, one of a part in a multi-part Part Studio, one of an assembly.
6. Record the target element, part id and configuration fields of each response.
7. Read `onshape:api-calls:<year>:paths` in Redis before and after each export. Note the calls per export.
8. Optional: record whether the panel's BOM rows carry a per-item microversion (`getBillOfMaterialsIn` asks for `includeItemMicroversions=true`). If they do, Task 12 can skip the parts reads.

**Verify:**
- Step 2 gives one body. Step 3 gives a PDF. Step 5 names the target element for all three drawings.
- If the model holds the whole Part Studio, STOP and report. The `partIds` path is still marked FLAGGED in `packages/ee/src/onshape/lib/client.ts`.
- If step 4 gives no microversion, Task 5 cannot cache. Report it; every review then resolves every drawing.
- If step 5 gives no part id for the multi-part drawing, keep the fallback in Task 3. If it gives no target element at all, STOP and report the drawing half.

**Out of scope:** any code change.

## Task 2: Pure builder for the model exports

**Depends on:** Task 1
**Files:**
- Create: `packages/ee/src/onshape/panel/part-models.ts`
- Create: `packages/ee/src/onshape/panel/part-models.test.ts`
- Modify: `packages/ee/src/index.ts` — export it beside `buildAssemblyPlan`
- Copy from (precedent): `externalIdForBomLine` in `packages/ee/src/onshape/panel/status.ts`; tests in `plan.test.ts`

**Steps:**
1. Add `modelExports(input)`. Input: the BOM nodes the push covers, items by part number (`itemId`, `released`), and the linked source per item id.
2. Return `{ exports: ModelExport[]; skipped }`. `skipped` counts `standardContent`, `notLinked`, `released`, `unsupported`.
3. `ModelExport` is `{ partNumber, itemId, kind: "partstudio" | "assembly", documentId, wvm, wvmId, elementId, partId?, configuration }`.
4. A node with `itemSource.partId` is a `partstudio` export. A node with children and no part id is an `assembly` export.
5. Take a node only when its `itemSource` has `documentId` and `elementId`.
6. Count `unsupported` when `wvmType` is not `w` or `v`.
7. Count `standardContent` for `node.standardContent`, and `released` from the inputs.
8. Count `notLinked` when the item's link is not `externalIdForBomLine(node.itemSource)`.
9. Keep one export per part number. Normalize the configuration with `normalizeConfiguration`.
10. Add one test per rule, plus a part used on three rows.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- part-models
# Expected: all part-models tests pass
```

**Out of scope:** the root assembly. Its export stays where it is (D2).

## Task 3: Pure builder for the drawing ties

**Depends on:** Task 1
**Files:**
- Create: `packages/ee/src/onshape/panel/drawings.ts`
- Create: `packages/ee/src/onshape/panel/drawings.test.ts`
- Modify: `packages/ee/src/index.ts` — export it
- Copy from (precedent): `drawingModels` in `packages/ee/src/onshape/panel/releases.ts`

**Steps:**
1. Add `tieDrawings(drawings, targets)`.
2. A drawing is `{ documentId, wvm, wvmId, elementId, name, microversionId, partNumber?, references: Array<{ elementId, partId?, configuration? }> }`.
3. A target is `{ partNumber, documentId, wvm, wvmId, elementId, partId?, configuration? }`: the root, a sub-assembly or a part.
4. Return `{ ties: Array<{ partNumber, drawing }>; skipped: Array<{ elementId, name, reason }> }`.
5. A reference to an assembly target's element ties the drawing to that target (D6).
6. Else a reference with a part id ties it to that part's target.
7. Else a reference to a Part Studio with one target in the push ties it to that target.
8. Else a drawing part number equal to a target's part number in that Part Studio ties it.
9. Else skip with reason `several-parts` or `not-in-push`.
10. Compare configurations after `normalizeConfiguration`.
11. Add `drawingSourceKey(drawing, partMicroversionOrVersion)`. It hashes the drawing element, its microversion or version, and the part's microversion or version.
12. Add one test per rule.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- drawings
# Expected: all drawings tests pass
```

**Out of scope:** drawings in documents the push's items do not come from (D8).

## Task 4: Onshape client reads for drawings

**Depends on:** Task 1
**Files:**
- Modify: `packages/ee/src/onshape/lib/client.ts`

**Steps:**
1. Add `resolveAppElementReferences(document, elementId)` for the Task 1 endpoint. Type only the fields Task 1 recorded.
2. Add `microversionId?: string` to `OnshapeElementRow` when Task 1 step 4 found it.
3. Do not add either path to `DEV_CACHEABLE_PATHS`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: no errors
```

**Out of scope:** the "where used" endpoints in Onshape's changelog. Use them only if Task 1 shows `resolvereferences` cannot tie a drawing.

## Task 5: Drawing references cache

**Depends on:** Task 1
**Files:**
- Create: `packages/ee/src/onshape/lib/drawing-references-cache.ts`
- Create: `packages/ee/src/onshape/lib/drawing-references-cache.test.ts`
- Copy from (precedent): `packages/ee/src/onshape/lib/panel-plan-store.ts`

**Steps:**
1. Key: `onshape-drawing-refs:<companyId>:<documentId>:<elementId>:<microversionId>`.
2. Value: the parsed references. TTL 30 days.
3. Add `getCachedReferences` and `cacheReferences`. A Redis failure reads as a miss and never fails the plan.
4. Test the key shape and the miss on a Redis error.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- drawing-references-cache
# Expected: tests pass
```

**Out of scope:** caching anything without a microversion.

## Task 6: Plan lists each row's model and drawings

**Depends on:** Tasks 2, 3, 4, 5
**Files:**
- Modify: `apps/erp/app/routes/api+/integrations.onshape.panel.plan-assembly.ts` — read the drawings
- Modify: `packages/ee/src/onshape/panel/plan.ts` — `buildAssemblyPlan` adds `assets` to the root and each item
- Modify: `packages/ee/src/onshape/panel/plan.test.ts`

**Steps:**
1. Predict each item's link after apply, as `linkChildParts` decides it.
2. An item links to a row's source when it is already linked there, or when neither the item nor the source is linked.
3. Call `modelExports` with that prediction.
4. List the drawings of each distinct source document with `getElementsIn(document, "DRAWING")`.
5. Read each drawing's references from the cache, else with `resolveAppElementReferences`, then cache them.
6. Read a drawing's metadata part number only when Task 3 step 8 needs it.
7. Run each Onshape read inside `onshapeFailure` handling, as the route's BOM read.
8. A failed drawing read leaves that document's rows without drawings and adds a warning. It never fails the plan.
9. Call `tieDrawings` with the root, sub-assemblies and parts as targets.
10. Give each row `assets: { model: ModelExport | null; drawings: Array<{ elementId, name }> }`.
11. Keep the full ties in the stored plan. Send only `assets` and the skipped drawings to the panel.
12. Add plan tests: a linked part, an unlinked part, a linked-elsewhere part, and a row with two drawings.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- plan
pnpm exec turbo run typecheck --filter=erp
# Expected: tests pass, no type errors
```

**Out of scope:** APPLY making an Onshape call. It still makes none.

## Task 7: Review toggles and apply body

**Depends on:** Task 6
**Files:**
- Modify: `packages/ee/src/onshape/panel/review.ts` — `AssemblyReview.modelRows` and `drawingRows`, both `Set<string>` of part numbers, empty by default
- Modify: `packages/ee/src/onshape/panel/review.test.ts`
- Modify: `packages/ee/src/onshape/panel/Panel.tsx` — toggles in each row of `AssemblyReviewSection`, All and None above the list
- Copy from (precedent): the part review's `selected` set and `defaultSelectedPartIds` in `review.ts`; the root and item rows in `AssemblyReviewSection`; `Checkbox` from `@carbon/react`, as used in `apps/erp/app/modules/settings/ui/Integrations/PostingSyncSettings.tsx`

**Steps:**
1. In a row with `assets.model`, show a checkbox "STEP model".
2. In a row with drawings, show a checkbox "Drawings (N)". Its tooltip lists the drawing names.
3. Show no checkbox on standard-content, released or linked-elsewhere rows (D4, D5).
4. Above the list, show "STEP models: All · None" and "Drawings: All · None" when any row has that kind.
5. Show the skipped drawings with their reasons as a muted note.
6. Add a summary line: "N STEP models and M drawings will export from Onshape."
7. `applyRequestBody` sends `modelRows` and `drawingRows` as arrays.
8. Disable every toggle while the review is applying.
9. Add `applyRequestBody` tests: none selected, some selected, All then None.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- review
# Expected: all review tests pass
```

**Out of scope:** remembering the choice between reviews; a Fields-page default.

## Task 8: Apply input takes the choices

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — `onshapeAssemblyPushInput`

**Steps:**
1. Add `modelRows: z.array(z.string().min(1)).default([])`.
2. Add `drawingRows: z.array(z.string().min(1)).default([])`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** the part and release push inputs.

## Task 9: `linkChildParts` returns the final links

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — `linkChildParts` and its two call sites in `pushOnshapeAssembly`

**Steps:**
1. Return `{ problems: string[]; linkedSourceByItemId: Map<string, string> }`.
2. Fill the map from links that already pointed at the row's source and from rows this call inserted.
3. Include sub-assembly rows. Leave out rows whose insert failed.
4. Keep the current error text.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** the link metadata. Do not add a microversion to child links: the part push reads it as its "unchanged" signal.

## Task 10: Event and trigger key

**Depends on:** none
**Files:**
- Modify: `packages/lib/src/events.ts` — add `carbon/onshape-panel-assets`
- Modify: `packages/lib/src/trigger.ts` — add key `onshape-panel-assets`
- Copy from (precedent): `carbon/onshape-panel-sync` in both files

**Steps:**
1. Data: `{ companyId, userId, planId, models: ModelExport[], drawings: DrawingExport[] }`.
2. `DrawingExport` is `{ itemId, partNumber, documentId, wvm, wvmId, drawingElementId, drawingMicroversionId, part: { elementId, partId?, configuration? } }`.
3. At most 100 rows per event.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib
# Expected: no errors
```

**Out of scope:** `batchTrigger`. It takes no event id.

## Task 11: Drawing source record

**Depends on:** none
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/onshape-drawing-source.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/onshape-drawing-source.test.ts`
- Copy from (precedent): `currentModelFromSource` and `recordModelSource` in `onshape-sync-element.ts`

**Steps:**
1. Store one `externalIntegrationMapping` row per item: entityType `drawingSource`, integration `onshape-v2`, `externalId` null.
2. Its `metadata.drawings` maps a drawing element id to the `drawingSourceKey` of its last export.
3. One row per item, because the table allows one row per entity type, entity and integration.
4. Add `loadDrawingSources(carbon, companyId, itemIds)` through `selectInBatches`.
5. Add `recordDrawingSource(carbon, input)`. Merge one drawing into the row, never replace the whole metadata.
6. Test the merge: a second drawing keeps the first.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- onshape-drawing-source
# Expected: tests pass
```

**Out of scope:** deleting a PDF whose drawing is gone from Onshape.

## Task 12: Assets export job

**Depends on:** Tasks 4, 10, 11
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/onshape-panel-assets.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/onshape-panel-assets.test.ts`
- Modify: `packages/jobs/src/inngest/functions/integrations/index.ts` — export it
- Modify: `packages/jobs/src/inngest/index.ts` — register it
- Copy from (precedent): `onshapeBackfillFunction` in `onshape-backfill.ts`; the shared key in `company-restore.ts`

**Steps:**
1. Set `concurrency: { scope: "env", key: "'onshape-panel-assets-' + event.data.companyId", limit: 1 }` and `retries: 10`.
2. Step `microversions`: group the `w` part sources of models and drawings by document, workspace, element and configuration.
3. Read each group once with `getPartsInElement` inside `withRateLimitRetry`. Build `partId → microversionId`.
4. On a failed group read, log a warning. Export those parts without a microversion, and export their drawings.
5. For each model, invoke `onshapeElementSyncFunction`, step id `model-<index>`.
6. Pass `integrationId: ONSHAPE_V2_INTEGRATION_ID`, `sourceDocument: "Part"`, `versionId: wvmId`, `sourceWvm: wvm`.
7. Also pass `sourceMicroversionId`, `modelElementId: elementId`, `modelElementKind: kind`, `partId`, `configuration`, `assetBaseName: partNumber`.
8. Load the drawing source rows with `loadDrawingSources`. Skip a drawing whose `drawingSourceKey` matches.
9. For each other drawing, invoke `onshapeDrawingSyncFunction`, step id `drawing-<index>`.
10. Pass `drawingElementId` and `assetBaseName: <partNumber>-<drawingElementId>` (D7), with the same connection fields as step 6.
11. After each drawing sync, call `recordDrawingSource` with the new key.
12. Run two invokes at a time (D10).
13. Stop after 5 failures in a row, as the backfill's `MAX_CONSECUTIVE_FAILURES`.
14. Return `{ models: { exported, tooLarge, failed }, drawings: { exported, unchanged, failed } }`.
15. Test the grouping helper: a model and a drawing of one Part Studio make one read.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- onshape-panel-assets
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: tests pass, no type errors
```

**Out of scope:** `ASSEMBLER_CONCURRENCY`. Only `onshape-fetch` holds it, and the invoked element sync reaches it through that function.

## Task 13: Apply queues the exports

**Depends on:** Tasks 6, 8, 9, 12
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — `pushOnshapeAssembly`, `AssemblyPushSummary`

**Steps:**
1. Add `modelsQueued`, `drawingsQueued` and `assetsSkipped` to the summary.
2. After `linkChildParts`, take the stored plan's models and ties for the rows in `modelRows` and `drawingRows`.
3. Drop a row whose item is not linked to its source after `linkChildParts`. Count it in `assetsSkipped`.
4. Do this on both paths. On the released-root path, drop the root's drawings.
5. Ignore a part number in the input that the plan does not offer.
6. Send one event per 100 rows with `trigger`, id `<planId>:assets:<n>`.
7. On a failed send, add "STEP models or drawings couldn't be queued. Push again to retry." to `summary.errors`.
8. Keep the root assembly model export as it is.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** removing links on a failed send. Child links carry no microversion, so a re-push queues them again.

## Task 14: Push result text

**Depends on:** Task 13
**Files:**
- Modify: `packages/ee/src/onshape/panel/Panel.tsx` — `assemblyOutcomeText` and the `AssemblyPushSummary` type near line 380

**Steps:**
1. Add a note: "N STEP models and M drawings are exporting from Onshape. They appear on the items in a few minutes."
2. Add a note for rows dropped after linking, with the count.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: no errors
```

**Out of scope:** live export progress in the panel.

## Task 15: Docs, rule and AGENTS.md

**Depends on:** Task 13
**Files:**
- Modify: `docs/content/docs/integrations/cad.mdx` — "Push an assembly"
- Modify: `.claude/rules/onshape-panel.md` — "Identity" table (`drawingSource`), "Plan and apply", "Item and BOM writes", "Background job and dev workflow"
- Modify: `packages/jobs/AGENTS.md` — Durable Entry Points row
- Modify: `packages/ee/src/onshape/lib/client.ts` — remove the FLAGGED notes Task 1 cleared

**Steps:**
1. Docs: the per-row toggles, which rows have none, where drawings must live, and that new files use Onshape API calls.
2. Rule: the drawing reads at PLAN, the cache, the tie rule, the PDF name, the shared per-company key.

**Verify:**
```bash
pnpm --filter @carbon/content test
# Expected: links.test.ts passes
```

**Out of scope:** the changelog.

## Task 16: Typecheck, tests, lint

**Depends on:** Tasks 2 to 15

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=@carbon/lib --filter=erp
pnpm --filter @carbon/ee test
pnpm --filter @carbon/jobs test
pnpm run lint
# Expected: no errors, all tests pass
```

## Task 17: Live check in the panel

**Depends on:** Task 16
**Files:** none

**Steps:**
1. Build a test assembly: two Part Studios, a linked-document part, a standard-content fastener and a sub-assembly.
2. Add drawings: one of a single part, one of a part in a multi-part Part Studio, one of the sub-assembly, one of the root.
3. Open the review. Check the toggles: STEP on parts and the sub-assembly, Drawings where a drawing exists, none on the fastener.
4. Select STEP on one part only and Drawings on the root only. Push.
5. Check only that part got a model and only the root got a PDF, named `<partNumber>-<drawingElementId>.pdf`.
6. Push again with All for both kinds. Check every eligible row got its files.
7. Push again with All and nothing changed. The API-call counter grows only by the drawing-list and microversion reads.
8. Edit one part. Push with All. Only that part and its drawing export.
9. Push with None for both kinds. Nothing new arrives on child items.
10. Push a part from its Part Studio. It reuses the model with no translation.

**Verify:**
- All results hold. Record call counts in `.ai/research/2026-10-30-onshape-assembly-part-models-spike.md`.

**Out of scope:** clicking Onshape OAuth consent or releasing anything in Raul's Onshape accounts.

## Risks

- Every review now makes Onshape calls for drawings, even when nothing gets selected. The cache keeps that to the document lists plus new or changed drawings.
- Throughput: 300 selected models at two exports at a time can take hours. Each new model then queues an optimise on the shared assembler.
- A drawing's tie rests on `resolvereferences`. Onshape forum users report a null part id from it, so multi-part Part Studios fall back to the part number (Task 3 step 8).
- A drawing deleted or re-pointed in Onshape leaves its old PDF on the item.
- A part push and an assembly push of the same item at the same moment run in two functions with separate per-item locks. Both may export and spend quota; the attach converges on one model per source id (`onshape-attach.ts`).
- The model's file name must match the part push's. Both use the part number as `assetBaseName`. A different name for the same source id fails the attach with "source model identity mismatch".
- An item with a manual STEP upload gets the Onshape model. The old one is kept as an item document, as with a part push.
