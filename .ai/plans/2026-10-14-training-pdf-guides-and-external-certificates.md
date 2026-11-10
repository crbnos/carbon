# Training PDF Guides and External Certificates — implementation plan

**Spec / source:** `.ai/specs/2026-10-14-training-pdf-guides-and-external-certificates.md`
**Branch:** `feat/external-training-certificates`

## Progress
- [x] Task 1: Install dependencies
- [x] Task 2: Add the migration
- [x] Task 3: Apply the migration and regenerate types
- [x] Task 4: Validators, path check and services
- [x] Task 5: Bulk update route accepts the new fields
- [x] Task 6: Training page — PDF guide and External switch
- [x] Task 7: Employee wizard — guide viewer and certificate step
- [x] Task 8: Assignments page — certificate modal, view link, remove completion
- [x] Task 9: Person trainings card — view link
- [x] Task 10: Lingui, MCP digest, module docs
- [x] Task 11: Lint, typecheck, tests
- [x] Task 12: End-to-end check in the browser

## Execution notes
- Certificates upload through the server (`uploadTrainingCertificate`), not from the browser: `/share` has no browser storage client. Tasks 7 and 8 post the file, not a key.
- Removing a completion needs `delete: resources` (the `trainingCompletion` rule in `authz/manifest.ts`), not `delete: people`.

- After review: one `recordTrainingCompletion` helper replaces the three completion copies; the training page became a card stack with header-only status changes.

## Dependencies
Task 2 needs Task 1. Task 3 needs Task 2. Task 4 needs Task 3. Tasks 5–9 need Task 4 and are independent of each other. Task 10 needs Tasks 5–9. Task 11 needs Task 10. Task 12 needs Task 11.

## Shared facts

- The private file URL for a storage key is `getPrivateUrl(path)` from `@carbon/files/media`. It returns `/file/preview/private/{path}`.
- Uploads use `storage(carbon).company(companyId).upload(key, file)` from `@carbon/files`. Precedent: `apps/erp/app/modules/sales/ui/Customer/CustomerTaxForm.tsx:54-75`.
- `FileDropzone` (`apps/erp/app/components/FileDropzone.tsx`) converts HEIC to JPEG before `onDrop`. Use it for every dropzone.
- `PdfViewer` (`apps/erp/app/modules/documents/ui/Documents/PdfViewer.tsx`) is a default export. Load it with `lazy(() => import(...))` inside `<Suspense>`, as `DocumentView.tsx:21,55` does.
- Every new user-facing string uses `useLingui().t` or `<Trans>`.

---

## Task 1: Install dependencies

**Depends on:** none
**Files:** none

**Steps:**
1. Check free memory with `vm_stat`. Run nothing else heavy at the same time.
2. Run `pnpm install` in the worktree root.

**Verify:**
```bash
ls node_modules/.pnpm | head -1
# Expected: one directory name
```

**Out of scope:** dependency upgrades.

## Task 2: Add the migration

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_training-guides-and-certificates.sql` (made by the command)

**Steps:**
1. Run `pnpm db:migrate:new training-guides-and-certificates`.
2. Write this SQL into the new file:

```sql
ALTER TABLE "training"
  ADD COLUMN "guidePath" TEXT,
  ADD COLUMN "isExternal" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "trainingCompletion"
  ADD COLUMN "certificatePath" TEXT;
```

**Verify:**
```bash
ls packages/database/supabase/migrations | grep training-guides-and-certificates
# Expected: one file name
```

**Out of scope:** RPC functions, RLS policies.

## Task 3: Apply the migration and regenerate types

**Depends on:** 2
**Files:**
- Modify (generated): `packages/database/src/types.ts` and the other files `generate:types` writes

**Steps:**
1. If the local stack for this worktree is not running, STOP and ask the user. Do not rebuild the database.
2. Run `pnpm db:migrate`.
3. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -c "certificatePath\|guidePath\|isExternal" packages/database/src/types.ts
# Expected: a number of 6 or more
```

**Out of scope:** hand edits to generated types.

## Task 4: Validators, path check and services

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/resources/resources.models.ts`
- Modify: `apps/erp/app/modules/resources/resources.service.ts`
- Modify: `apps/erp/app/modules/resources/resources.models.test.ts`

**Steps:**
1. In `resources.models.ts`, add `certificatePath: zfd.text(z.string().optional())` to `trainingCompletionValidator`.
2. Add these helpers next to it:

```ts
export function trainingGuideKeyPrefix(companyId: string, trainingId: string) {
  return `${companyId}/training/${trainingId}/`;
}

export function trainingCertificateKeyPrefix(
  companyId: string,
  trainingAssignmentId: string,
  employeeId: string
) {
  return `${companyId}/training-certificates/${trainingAssignmentId}/${employeeId}/`;
}

export function isValidTrainingFileKey(key: string, prefix: string) {
  return (
    key.startsWith(prefix) &&
    key.length > prefix.length &&
    !key.slice(prefix.length).includes("/") &&
    !isUnsafeStoragePath(key)
  );
}
```

   Import `isUnsafeStoragePath` from `@carbon/files`.
3. In `resources.service.ts`:
   1. Add `certificatePath?: string | null` to the `insertTrainingCompletion` argument type.
   2. Add `guidePath, isExternal` to the `training(...)` select in `getTrainingAssignmentForCompletion`.
   3. Add `deleteTrainingCompletion(client, id: number, companyId)`: delete from `trainingCompletion` where `id` and `companyId` match. Mark it `/** @mcp delete */`.
   4. Add `getTrainingCertificatePaths(client, companyId, completionIds: number[])`. If the list is empty, return `{ data: {}, error: null }`. Else select `id, certificatePath` with `.in("id", completionIds)` and `.eq("companyId", companyId)`. Return `{ data: Record<number, string>, error }` with only the rows that have a path.
4. In `resources.models.test.ts`, add tests for `isValidTrainingFileKey`: accepts `c1/training-certificates/a1/u1/x.pdf`; refuses a different company, a nested folder, `..` segments, and the bare prefix.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/resources/resources.models.test.ts
# Expected: all tests pass
```

**Out of scope:** the RPC functions.

## Task 5: Bulk update route accepts the new fields

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/routes/x+/training+/update.tsx`

**Steps:**
1. Add `case "isExternal"`: write `value === "on"` to `isExternal`.
2. Add `case "guidePath"`:
   1. Read the training rows for `ids` with `status, companyId`.
   2. If any row is not Draft, return `{ error: { message: "The guide can only change on a Draft training" }, data: null }`.
   3. If `value` is not empty and fails `isValidTrainingFileKey(value, trainingGuideKeyPrefix(companyId, id))`, return an error. Only allow one id for this field.
   4. Write `guidePath: value === "" ? null : value`.
3. Use `companyId` from `requirePermissions`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in update.tsx
```

**Out of scope:** the other fields.

## Task 6: Training page — PDF guide and External switch

**Depends on:** 4
**Files:**
- Create: `apps/erp/app/modules/resources/ui/Training/TrainingGuide.tsx`
- Modify: `apps/erp/app/modules/resources/ui/Training/index.ts` — export `TrainingGuide`
- Modify: `apps/erp/app/routes/x+/training+/$id.tsx` — render `TrainingGuide` above `TrainingEditor`; pass `explorer` only when `!training.isExternal`
- Modify: `apps/erp/app/modules/resources/ui/Training/TrainingProperties.tsx` — External switch
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Customer/CustomerTaxForm.tsx` (upload), `apps/erp/app/modules/items/ui/Parts/PartProperties.tsx:780` (`Boolean` property)

**Steps:**
1. `TrainingGuide` props: `trainingId`, `guidePath`, `canEdit`.
   1. If `guidePath` is set, show `PdfViewer` with `getPrivateUrl(guidePath)` in a horizontally scrollable box.
   2. If `canEdit`, show a `FileDropzone` with `accept={{ "application/pdf": [".pdf"] }}` and `multiple={false}`.
   3. On drop, upload to `trainingGuideKeyPrefix(companyId, trainingId) + nanoid() + ".pdf"`. Then post `field=guidePath` to `path.to.bulkUpdateTraining` with `useAction`.
   4. If `canEdit` and a guide exists, show a **Remove PDF** button. It posts `guidePath` with an empty value.
2. `canEdit` = `permissions.can("update", "people") && training.status === "Draft"`. This is the editor's rule (`$id.tsx`).
3. In `TrainingProperties`, add `"isExternal"` to the `onUpdate` field union. Add a `Boolean` named `isExternal`, label `t\`External\``, after Frequency. `onChange` calls `onUpdate("isExternal", value ? "on" : "off")`. Read-only without `update: people`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** multiple PDFs, a PDF block inside the editor.

## Task 7: Employee wizard — guide viewer and certificate step

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/routes/share+/training.$id.tsx`

**Steps:**
1. Loader: return `guidePath`, `isExternal` and `companyId` of the assignment in `training`. If `isExternal`, return `questions: []`.
2. `ContentStep`: if `guidePath` is set, show the lazy `PdfViewer` above the typed content. Change the empty text to show only when there is no guide and no typed content.
3. Wizard: if `training.isExternal`:
   1. Total steps = 2: reading step, then a `CertificateStep`.
   2. `CertificateStep` shows a `FileDropzone` with PDF and image types (copy the `accept` map from `CustomerTaxForm.tsx:153-156`) and `multiple={false}`.
   3. On drop, upload to `trainingCertificateKeyPrefix(companyId, assignmentId, userId) + nanoid() + "." + ext`. Keep the key in state. Show the file name with a **Change file** option before submit.
   4. The last button is **Submit Certificate**, disabled until a key exists and while the submit runs. It posts `intent=certificate` and `certificatePath`.
4. Action: if `intent === "certificate"`:
   1. Load the authorized assignment (`getAuthorizedAssignment`). If the training is not External, return 400.
   2. If `isValidTrainingFileKey(certificatePath, trainingCertificateKeyPrefix(assignment.companyId, id, userId))` is false, log and return 400.
   3. Get the period with `get_current_training_period`. Insert the completion with `certificatePath`. If the insert fails, log and return 500.
   4. Run the same ability restamp as the quiz path.
   5. Return `{ passed: true, score: 1, totalQuestions: 0, userAnswers: {}, correctAnswers: 0 }` so `ResultsView` shows the success state.
5. The quiz action refuses an External training with 400.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** existing untranslated strings in this file.

## Task 8: Assignments page — certificate modal, view link, remove completion

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/routes/x+/resources+/assignments.$trainingId.tsx`
- Modify: `apps/erp/app/routes/x+/resources+/assignments.complete.tsx`
- Create: `apps/erp/app/routes/x+/resources+/assignments.uncomplete.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `markTrainingIncomplete: \`${x}/resources/assignments/uncomplete\``
- Copy from (precedent): `apps/erp/app/routes/x+/resources+/assignments.complete.tsx`

**Steps:**
1. Loader: collect `completionId` values. Call `getTrainingCertificatePaths` once. Return `certificatePaths`.
2. `AssignmentListItem` gets `isExternal`, `certificatePath`, `canRemove` props.
   1. If `isExternal` and the row can be completed, **Mark Complete** opens a `Modal` with a `FileDropzone` (same types as Task 7). On upload it submits the existing form with `certificatePath`. The submit button disables while the fetcher runs.
   2. If `certificatePath` is set, show a **View Certificate** link to `getPrivateUrl(certificatePath)` with `target="_blank"`.
   3. If the row is Completed and `canRemove`, show **Remove Completion**. It opens a `Confirm` that says: "The employee keeps any ability this training granted. Remove it on their Abilities page if needed." On confirm it posts `completionId` to `path.to.markTrainingIncomplete`.
   4. `canRemove` = `permissions.can("delete", "people")`.
3. `assignments.complete.tsx`: read `certificatePath`. Read the training's `isExternal` through the assignment. If External and the key fails `isValidTrainingFileKey(...)`, return 400 with a flash error. Pass `certificatePath` to `insertTrainingCompletion`.
4. `assignments.uncomplete.tsx`: `assertIsPost`. `requirePermissions(request, { delete: "people" })`. Call `deleteTrainingCompletion`. Flash success or error. Log the error first.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** removing the granted ability.

## Task 9: Person trainings card — view link

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/routes/x+/person+/$personId.abilities.tsx`
- Modify: `apps/erp/app/modules/people/ui/Person/PersonTrainings.tsx`

**Steps:**
1. Loader: after the trainings load, call `getTrainingCertificatePaths` with their `completionId` values. Return `certificatePaths`.
2. `PersonTrainings` takes `certificatePaths`. If a row has a path, show a **View Certificate** link next to the date.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** other person tabs.

## Task 10: Lingui, MCP digest, module docs

**Depends on:** 5, 6, 7, 8, 9
**Files:**
- Modify: `packages/locale/locales/*/erp.po` (generated)
- Modify: MCP generated files (generated)
- Modify: `apps/erp/app/modules/resources/AGENTS.md` — Training concept, data model and service list

**Steps:**
1. Run `pnpm lingui:extract`.
2. Run `pnpm lingui:clean`.
3. Run `pnpm run generate:mcp`.
4. Update the Training line in `AGENTS.md`: PDF guide, External trainings, certificate keys, the two new services.

**Verify:**
```bash
grep -c "Submit Certificate" packages/locale/locales/en/erp.po
# Expected: 1
```

**Out of scope:** `pnpm translate`.

## Task 11: Lint, typecheck, tests

**Depends on:** 10
**Steps:**
1. Run `pnpm exec turbo run typecheck --filter=erp`.
2. Run `pnpm exec biome check` on the changed files.
3. Run `cd apps/erp && pnpm exec vitest run app/modules/resources`.
4. Run `pnpm --filter @carbon/checks license-headers` for the new files.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

## Task 12: End-to-end check in the browser

**Depends on:** 11
**Steps:**
1. Ask the user before you drive the browser.
2. Walk the 12 acceptance criteria in the spec. Record each result.

**Verify:** every acceptance criterion passes, or the failure is reported.
