# Demo Templates, Anytime — implementation plan

**Spec:** `.ai/specs/2026-08-18-demo-templates-anytime-revert.md`
**Branch:** `feat/onboarding-templates`

## Progress

- [x] Task 1: Replace `applyDataset`'s `beforeTiers` hook with a `wipeFirst` option
- [x] Task 2: Add the snapshot flag and the two new events to `@carbon/lib`
- [x] Task 3: Export `wipeAndLoad`, `getCompanyGroupId` and a scope helper from `company-restore.ts`
- [x] Task 4: Rework `company-template.ts` — snapshot, phases, `ready` marker
- [x] Task 5: Add the template finalize and revert Inngest functions
- [x] Task 6: Pass `snapshot: true` from onboarding
- [x] Task 7: ERP service + server trigger wrappers for demo data
- [x] Task 8: The `Settings → Demo Data` route, path helper and nav entry
- [x] Task 9: The status poll API route
- [~] Task 10: Demo Data UI components — components done; **`JobProgressModal` reuse NOT done** (see Blocker below)
- [x] Task 11: Update the rules and AGENTS.md that this work makes stale
- [ ] Task 12: End-to-end verification — **blocked on user** (needs permission to reseed + browser run)

## Blocker: Task 10 step 3 (`JobProgressModal`)

The plan said "add the three new phase keys to `PHASE_ORDER`/`PHASE_LABELS`". That badly
understated the work. `JobProgressModal` is not a generic component:

- its mode union is literally `"export" | "restore" | "revert"`;
- it **hardcodes** its poll URL as `/api/settings/backup-restore-status/${runId}`;
- its status fetcher is typed to the restore endpoint's `{ status, rows, error, progress,
  startedAt }` shape, not this feature's `{ run }`.

Reusing it means widening the mode union, parameterising the status URL, and adapting the
response shape — surgery on a shipped component the Backups page depends on, which Task 8
lists as out of scope.

Shipped instead: the review row renders "applying…" / "reverting…" with a spinner, and the
loader/endpoint already carry full `{ phase, done, total }` progress. So the DATA is there;
only the phased progress bar is missing.

Two ways forward, for the user to choose:
1. Leave as-is. Complete and safe; a phased bar becomes a follow-up.
2. Parameterise `JobProgressModal` (status URL + mode + response adapter) and reuse it,
   re-verifying the Backups page.

## Dependencies

- Task 4 needs Tasks 1, 2, 3.
- Task 5 needs Tasks 2, 3, 4.
- Task 6 needs Task 2.
- Task 7 needs Task 4 (marker shape).
- Tasks 8, 9 need Task 7.
- Task 10 needs Task 8.
- Tasks 1, 2, 3 are independent of each other and may run in parallel.
- Tasks 6 and 7 are independent of each other.
- Task 11 is independent of everything but should land in the same change.
- Task 12 is last.

---

## Task 1: Replace `applyDataset`'s `beforeTiers` hook with a `wipeFirst` option

**Depends on:** none

**Files:**
- Modify: `packages/database/src/datasets/index.ts` — swap the option
- Modify: `packages/database/src/seed-dev.ts` — migrate the one call site
- Modify: `packages/database/AGENTS.md` — correct the "dev-only" claim about `wipe.ts`

**Steps:**

1. In `packages/database/src/datasets/index.ts`, add this import next to the existing
   `./sql.ts` import:

   ```typescript
   import { wipeCompanyBusinessData } from "./wipe.ts";
   ```

2. In the `applyDataset` options type (currently lines 56-65), delete the
   `beforeTiers` property and its comment, and add in its place:

   ```typescript
       /**
        * Clear the company's existing business data before the tiers run, inside
        * the same transaction. Preserves everything bootstrap created (chart of
        * accounts, unitOfMeasure, sequences, locations, paymentTerm) because the
        * tiers require that config to exist — this is NOT the restore engine's
        * tabula-rasa wipe.
        */
       wipeFirst?: boolean;
   ```

3. In the destructure (currently lines 67-75), replace `beforeTiers` with
   `wipeFirst = false`.

4. Replace the line `if (beforeTiers) await beforeTiers(ctx);` (currently line 92) with:

   ```typescript
       if (wipeFirst) {
         log("Wiping existing business data...");
         await wipeCompanyBusinessData(ctx);
       }
   ```

5. In `packages/database/src/seed-dev.ts`, replace the whole `beforeTiers: async (ctx) => {...}`
   property in the `applyDataset` call (currently lines 64-72, including the
   `// Dev-only, and must share the tiers' transaction.` comment) with:

   ```typescript
         wipeFirst: !skipWipe
   ```

   Then delete the now-unused `wipeCompanyBusinessData` import from that file, and add a
   `console.log("Skipping wipe (--skip-wipe).")` immediately before the `applyDataset`
   call, guarded by `if (skipWipe)`, so the CLI keeps printing that line.

6. In `packages/database/AGENTS.md`, find the sentence under **Dev Seed** reading
   "`pnpm db:seed:dev` runs `src/seed-dev.ts` (the dev CLI); `cli.ts` parses its args,
   `bootstrap.ts` sets up the company and `wipe.ts` clears prior data. All three are
   dev-only and are never reachable from the shared engine or from onboarding."
   Replace the second sentence with: "`cli.ts` and `bootstrap.ts` are dev-only. `wipe.ts`
   is reached from the shared engine via `applyDataset`'s `wipeFirst` option, which both
   the dev CLI and the `company-template` job use; it is not exported on its own."

   Also update the `./datasets` row of the **Key Exports** table so the `applyDataset`
   signature shown there includes `wipeFirst`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exits 0, no TS errors. `beforeTiers` must appear nowhere:
grep -rn "beforeTiers" packages/ apps/ --include=*.ts --include=*.tsx
# Expected: no output.
```

**Out of scope:** Do not change anything inside `packages/database/src/datasets/wipe.ts`
itself, and do not add a `./datasets/wipe` subpath to `package.json`. The wipe stays
un-exported; `wipeFirst` is the only way to reach it.

---

## Task 2: Add the snapshot flag and the two new events to `@carbon/lib`

**Depends on:** none

**Files:**
- Modify: `packages/lib/src/events.ts` — extend `carbon/company-template`, add two events
- Modify: `packages/lib/src/trigger.ts` — add two entries to `taskToEvent`
- Copy from (precedent): the `carbon/company-restore-finalize` and
  `carbon/company-restore-revert` entries in the same two files

**Steps:**

1. In `packages/lib/src/events.ts`, add a field to the existing `"carbon/company-template"`
   data block (it currently holds `companyId`, `userId`, `datasetKey`, `templateRunId`):

   ```typescript
       /**
        * Snapshot the company before wiping, and leave the run parked on a
        * keep/revert decision instead of clearing the marker. Onboarding and the
        * Settings page both set this; absent means the legacy fire-and-forget
        * behaviour.
        */
       snapshot?: boolean;
   ```

2. Directly below that block, add:

   ```typescript
     // Keep an applied demo template — drop the pre-apply snapshot and the marker.
     "carbon/company-template-finalize": {
       data: {
         companyId: string;
         templateRunId: string;
       };
     };

     // Undo an applied demo template — wipe and reload the pre-apply snapshot.
     "carbon/company-template-revert": {
       data: {
         companyId: string;
         userId: string;
         templateRunId: string;
       };
     };
   ```

3. In `packages/lib/src/trigger.ts`, add two entries to `taskToEvent`, keeping the
   alphabetical order of the existing keys (immediately after `"company-template"`):

   ```typescript
     "company-template-finalize": "carbon/company-template-finalize",
     "company-template-revert": "carbon/company-template-revert",
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib
# Expected: exits 0, no TS errors.
```

**Out of scope:** Do not touch the `carbon/company-import` block above it, including its
`templateIndustryId` comment about `_templates/` — that is the dormant archive design and
is unrelated to this work.

---

## Task 3: Export `wipeAndLoad`, `getCompanyGroupId` and a scope helper from `company-restore.ts`

**Depends on:** none

**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-restore.ts`

**Steps:**

1. Add the `export` keyword to `async function wipeAndLoad(` (currently line 47) and to
   `async function getCompanyGroupId(` (currently line 238). Change nothing about their
   bodies or signatures.

2. Read the block that currently computes the restore scope (around lines 415-426 —
   `targetGroupId`, `groupCompanyCount`, `includeGroup`). Extract it verbatim into a new
   exported module-level function placed immediately after `getCompanyGroupId`:

   ```typescript
   /**
    * Which scope a wipe-and-load should cover for this company. Group-scoped tables
    * (the shared chart of accounts) are only in scope when this company is the sole
    * member of its group — otherwise the wipe would reach another tenant's data.
    * Shared by the restore path and the demo-template path so the two can never
    * disagree about what a revert is allowed to touch.
    */
   export async function resolveRestoreScope(
     client: ServiceRole,
     companyId: string
   ): Promise<{ targetGroupId: string | null; includeGroup: boolean }> {
     // ...moved body: compute targetGroupId via getCompanyGroupId, then the
     // company count for that group, then includeGroup = groupCompanyCount === 1
   }
   ```

   Use the exact same queries the inline block uses — do not re-derive them. Then replace
   the inline block in `companyRestoreFunction` with a call to the new function, so there
   is one implementation, not two.

   If the inline block turns out to depend on local variables that are not available at
   module scope (anything beyond `client` and `companyId`), **STOP and report** — do not
   improvise a different scope rule.

3. Add a one-line comment above each newly-exported symbol noting that
   `company-template.ts` is now a second caller, so a future reader does not assume the
   restore path is the only consumer.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exits 0, no TS errors.
```

**Out of scope:** Do not change `wipeAndLoad`'s behaviour, its progress reporting, or the
`session_replication_role` handling. This task is exports and one extraction only.

---

## Task 4: Rework `company-template.ts` — snapshot, phases, `ready` marker

**Depends on:** Tasks 1, 2, 3

**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-template.ts`
- Copy from (precedent): `packages/jobs/src/inngest/functions/tasks/company-restore.ts`
  lines 440-566 (the snapshot-then-wipe-then-ready sequence and its idempotent snapshot
  reuse)

**Steps:**

1. Widen the marker types (currently lines 13-21):

   ```typescript
   type TemplateStatus = "running" | "ready" | "failed" | "reverting";

   type TemplateMeta = {
     templateRunId: string;
     status: TemplateStatus;
     datasetKey?: string;
     startedAt?: string;
     error?: string | null;
     /** Folder name of the pre-apply snapshot in this company's bucket. */
     snapshotPath?: string;
     /** Scope the forward apply covered, so a revert undoes exactly that. */
     includeGroup?: boolean;
     progress?: { phase: string; done: number; total: number };
   };
   ```

2. Add these imports (all relative, all from sibling files in the same directory):

   ```typescript
   import { getJobDatabaseClient } from "../../../db";
   import {
     backupAssetsDir,
     backupDir,
     getCompanyTableCatalog,
     readBackup,
     removeStoragePrefix,
     restoreAssetsFromBackup,
     writeBackupManifest
   } from "./company-backup";
   import { buildCompanyBackup } from "./company-export";
   import { resolveRestoreScope, wipeAndLoad } from "./company-restore";
   ```

   Confirm each of these is actually exported before relying on it. `getJobDatabaseClient`
   lives in `packages/jobs/src/db.ts`; check the correct relative depth from
   `functions/tasks/` and fix the path if it differs. If any symbol is not exported,
   **STOP and report** — do not add exports beyond the three named in Task 3.

3. Add a progress reporter alongside the existing marker helpers, modelled on
   `makeProgressReporter` in `company-restore.ts`:

   ```typescript
   function makeTemplateProgress(
     client: ServiceRole,
     args: { companyId: string; userId: string; templateRunId: string }
   ) {
     return async (progress: { phase: string; done: number; total: number }) => {
       await writeTemplateMarker(client, { ...args, patch: { progress } });
     };
   }
   ```

4. Destructure `snapshot` from `event.data` in `companyTemplateFunction`:

   ```typescript
   const { companyId, userId, datasetKey, templateRunId, snapshot: takeSnapshot = false } = event.data;
   ```

5. **Delete the entire `item`-count guard block** (currently lines 142-169, from the
   `// A template is a one-shot on a fresh company.` comment through the closing brace of
   the `if ((existingItems.count ?? 0) > 0) {` block). Its idempotency job is now done by
   `wipeFirst` plus snapshot reuse.

   Replace it with a refusal that protects an unresolved review row:

   ```typescript
         // A pending keep/revert owns the only snapshot of the user's real data.
         // Applying again would overwrite it, so refuse until it is resolved.
         const existing = await readTemplateMarker(client, companyId);
         if (
           existing &&
           existing.metadata.templateRunId !== templateRunId &&
           existing.metadata.status !== "failed"
         ) {
           throw new NonRetriableError(
             "A demo data change is already pending — keep or revert it first."
           );
         }
   ```

6. After the existing `running` marker write, and only `if (takeSnapshot)`, add the
   snapshot step. Mirror `company-restore.ts:469-500` exactly, including its idempotent
   reuse comment:

   ```typescript
         const db = getJobDatabaseClient(1);
         const report = makeTemplateProgress(client, { companyId, userId, templateRunId });
         const { includeGroup } = await resolveRestoreScope(client, companyId);

         let snapshotPath = existing?.metadata.snapshotPath ?? undefined;
         if (takeSnapshot && !snapshotPath) {
           await report({ phase: "snapshot", done: 0, total: 1 });
           snapshotPath = `_pre-template-${templateRunId}`;
           const snap = await buildCompanyBackup(client, db, {
             companyId,
             userId,
             label: `Pre-template ${templateRunId}`,
             includeStorage: "all",
             name: snapshotPath
           });
           await writeBackupManifest(client, companyId, snapshotPath, snap.manifest);
           await writeTemplateMarker(client, {
             companyId,
             userId,
             templateRunId,
             patch: { snapshotPath, includeGroup }
           });
           await report({ phase: "snapshot", done: 1, total: 1 });
         }
   ```

   The snapshot must be taken **inside** the existing `try` that writes the `failed`
   marker, so a snapshot failure is visible rather than leaving the marker on `running`.

7. Pass `wipeFirst: takeSnapshot` to the `applyDataset` call, and bracket it with phase
   reports:

   ```typescript
           await report({ phase: "wipe", done: 0, total: 1 });
           await applyDataset(pgClient, {
             companyId,
             userId,
             dataset,
             timeZone,
             wipeFirst: takeSnapshot,
             log: (message) => logger.info(message, { companyId, templateRunId })
           });
           await report({ phase: "apply", done: 1, total: 1 });
   ```

   Note `wipeFirst` is tied to `takeSnapshot` deliberately: wiping without a snapshot
   would be unrecoverable, so the two are never allowed to diverge.

8. Replace the terminal `clearTemplateMarker` (currently line 220) with a branch:

   ```typescript
         if (takeSnapshot) {
           // Parked on keep/revert — the marker holds the snapshot until the user
           // decides. Clearing here would strand the snapshot with nothing pointing
           // at it.
           await writeTemplateMarker(client, {
             companyId,
             userId,
             templateRunId,
             patch: { status: "ready", progress: undefined }
           });
         } else {
           await clearTemplateMarker(client, companyId);
         }
   ```

9. Update the doc comment on `writeTemplateMarker` (currently lines 49-55) — it says
   "Cleared on success", which stops being true for the snapshot path.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exits 0, no TS errors.
grep -n "existingItems" packages/jobs/src/inngest/functions/tasks/company-template.ts
# Expected: no output (the item-count guard is gone).
```

**Out of scope:** Do not change the function's `concurrency` config, the
`NonRetriableError` on an unknown dataset key, or the dedicated
`getPostgresConnectionPool(2)` and its `finally { pgClient?.release() }`.

---

## Task 5: Add the template finalize and revert Inngest functions

**Depends on:** Tasks 2, 3, 4

**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-template.ts` — two new exports
- Modify: `packages/jobs/src/inngest/functions/tasks/index.ts` — re-export them
- Modify: `packages/jobs/src/inngest/index.ts` — register them
- Copy from (precedent): `packages/jobs/src/inngest/functions/tasks/company-restore.ts`
  lines 586-617 (`companyRestoreFinalizeFunction`) and lines 619-715
  (`companyRestoreRevertFunction`)

**Steps:**

1. In `company-template.ts`, add `companyTemplateFinalizeFunction`, copying the shape of
   `companyRestoreFinalizeFunction` verbatim and substituting: id `company-template-finalize`,
   event `carbon/company-template-finalize`, concurrency key
   `"'company-template-' + event.data.companyId"` with `scope: "env"` and `limit: 1`, and
   the marker helpers `readTemplateMarker` / `clearTemplateMarker`. It reads
   `marker.metadata.snapshotPath`, calls
   `removeStoragePrefix(client, companyId, backupDir(snapshotPath))` when set, then clears
   the marker.

2. Add `companyTemplateRevertFunction`, copying `companyRestoreRevertFunction` and
   substituting the same id/event/marker helpers. It must:
   - read the marker; if there is no `snapshotPath`, log and return
     `{ templateRunId, reverted: false }` without touching data;
   - write `status: "reverting"`;
   - `readBackup(client, companyId, snapshotPath)`, `getCompanyTableCatalog(db)`, then
     `wipeAndLoad(db, catalog, snapshot, { companyId, userId: "", remap: false,
     includeGroup: marker?.metadata.includeGroup ?? false, targetGroupId, onProgress: report })`
     where `targetGroupId` comes from `resolveRestoreScope`;
   - `restoreAssetsFromBackup` from `backupAssetsDir(snapshotPath)` with `srcBucket: companyId`;
   - `removeStoragePrefix` the snapshot folder, then clear the marker;
   - on a throw, write `status: "failed"` with `error: \`Revert failed: ${message}\`` and
     **leave the snapshot path on the marker** so the user can retry. This is the same
     failure contract as restore's revert; do not clear the marker in the catch.

3. Widen the concurrency key on the existing `companyTemplateFunction` so all three share
   it, matching how restore does it. Keep the existing unkeyed `{ limit: 2 }` entry
   alongside it:

   ```typescript
       concurrency: [
         { limit: 2 },
         {
           key: "'company-template-' + event.data.companyId",
           scope: "env",
           limit: 1
         }
       ]
   ```

4. Add both new functions to the `./company-template` export line in
   `packages/jobs/src/inngest/functions/tasks/index.ts`, keeping the existing
   `companyTemplateFunction` export.

5. Register both in `packages/jobs/src/inngest/index.ts` in the same two places
   `companyTemplateFunction` already appears (the import list and the functions array —
   currently around lines 71 and 118).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exits 0.
grep -c "companyTemplateFinalizeFunction\|companyTemplateRevertFunction" packages/jobs/src/inngest/index.ts
# Expected: 4 (each name appears in both the import and the registration array).
```

**Out of scope:** Do not modify `companyRestoreFinalizeFunction` or
`companyRestoreRevertFunction` — copy from them, leave them alone.

---

## Task 6: Pass `snapshot: true` from onboarding

**Depends on:** Task 2

**Files:**
- Modify: `apps/erp/app/services/onboarding.server.ts` — one field on the trigger payload

**Steps:**

1. In `startCompanyTemplate` (currently lines 100-117), add `snapshot: true` to the
   `trigger("company-template", { ... })` payload alongside the existing `companyId`,
   `userId`, `datasetKey` and `templateRunId`.

2. Update the function's doc comment to record why: a signup-time template is snapshotted
   too, so it stays revertible from Settings later. The company is nearly empty at this
   point, so the snapshot is cheap.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0.
grep -n "snapshot: true" apps/erp/app/services/onboarding.server.ts
# Expected: one match inside startCompanyTemplate.
```

**Out of scope:** Do not change the re-entry path's call at `onboarding.server.ts:183-185`
in any other way, and do not touch `provisionCompanyData`'s three-way branch.

---

## Task 7: ERP service + server trigger wrappers for demo data

**Depends on:** Task 4

**Files:**
- Create: `apps/erp/app/modules/settings/demoData.service.ts`
- Create: `apps/erp/app/modules/settings/demoData.server.ts`
- Modify: `apps/erp/app/modules/settings/index.ts` — add `export * from "./demoData.service";`
- Copy from (precedent): `apps/erp/app/modules/settings/backups.service.ts`
  (`getCompanyRestoreRuns`, `getCompanyExportRun`) and
  `apps/erp/app/modules/settings/backups.server.ts` (`startCompanyRestore`,
  `finalizeCompanyRestore`, `revertCompanyRestore`)

**Steps:**

1. `demoData.service.ts` exports one reader:

   ```typescript
   export async function getCompanyTemplateRun(
     client: SupabaseClient<Database>,
     companyId: string
   );
   ```

   It selects `entityId, metadata, createdAt` from `externalIntegrationMapping` where
   `integration = "company-template"` and `companyId = companyId`, with `.maybeSingle()`
   — one marker row per company, exactly like `getCompanyExportRun` does for
   `"company-export"`. Return the raw `{ data, error }`; do not throw. Type the metadata
   locally in this file (`templateRunId`, `status`, `datasetKey`, `startedAt`, `error`,
   `snapshotPath`, `progress`) rather than importing from `@carbon/jobs` — the app must
   not pull job internals into its bundle.

2. `demoData.server.ts` exports three thin trigger wrappers, matching the shape of
   `backups.server.ts`:

   ```typescript
   export async function startCompanyTemplate(args: { companyId: string; userId: string; datasetKey: string }): Promise<{ templateRunId: string }>;
   export async function finalizeCompanyTemplate(args: { companyId: string; templateRunId: string }): Promise<void>;
   export async function revertCompanyTemplate(args: { companyId: string; userId: string; templateRunId: string }): Promise<void>;
   ```

   `startCompanyTemplate` mints `templateRunId` with `nanoid()` (same as
   `onboarding.server.ts:107` does) and triggers `"company-template"` with
   `snapshot: true`. The other two trigger `"company-template-finalize"` and
   `"company-template-revert"`. Keep these in a `.server.ts` file, not the service — the
   existing `backups.server.ts` comment explains this is to keep `Buffer` out of the
   client bundle.

3. Add only the **service** to the module barrel (`index.ts`). `.server.ts` files are not
   barrelled in this module — check how `backups.server.ts` is imported at its call sites
   and follow that exactly.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0.
```

**Out of scope:** Do not add demo-data functions to `backups.service.ts` or
`backups.server.ts`, and do not modify `settings.service.ts`.

---

## Task 8: The `Settings → Demo Data` route, path helper and nav entry

**Depends on:** Task 7

**Files:**
- Create: `apps/erp/app/routes/x+/settings+/demo-data.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add the path
- Modify: `apps/erp/app/modules/settings/ui/useSettingsSubmodules.tsx` — nav entry + gate
- Copy from (precedent): `apps/erp/app/routes/x+/settings+/backups.tsx` (loader at
  lines 104-113, the intent-dispatch action, the concurrent-run refusal at lines 179-185,
  and the optimistic `resolvedRunIds` hiding at lines 346-351)

**Steps:**

1. In `apps/erp/app/utils/path.ts`, add to the `path.to` object in its existing
   alphabetical position (between `customFields` and `deactivateIntegration`, wherever
   `demoData` sorts):

   ```typescript
       demoData: `${x}/settings/demo-data`,
   ```

2. In `useSettingsSubmodules.tsx`, add a route entry to the **System** group (the array
   starting at line 153), keeping the group's alphabetical order — it belongs between
   `Custom Fields` and the next entry:

   ```tsx
             {
               name: t`Demo Data`,
               to: path.to.demoData,
               role: "employee",
               icon: <LuFlaskConical />
             },
   ```

   Import `LuFlaskConical` from `react-icons/lu` alongside the file's existing `Lu*`
   imports. If that icon name does not exist in the installed `react-icons` version, use
   `LuBeaker`; if neither exists, **STOP and report** rather than picking an unrelated
   icon.

3. Add `path.to.demoData` to the existing `localOrInternalRoutes` set (line 37):

   ```typescript
   const localOrInternalRoutes = new Set<string>([path.to.backups, path.to.demoData]);
   ```

   This is what hides the nav entry from non-internal users on real deployments.

4. Create `demo-data.tsx` with `handle` (breadcrumb `msg\`Demo Data\``, `to: path.to.demoData`),
   a loader and an action. Both start with:

   ```typescript
   const { client, companyId, email } = await requirePermissions(request, {
     update: "settings"
   });
   requireBackupAccess(email);
   ```

   `requireBackupAccess` is imported from `~/utils/backups` — reuse it as-is rather than
   writing a second gate, so the two pages can never drift apart.

5. The loader returns `{ run, datasets }` where `run` comes from
   `getCompanyTemplateRun(client, companyId)` and `datasets` is derived **in the loader**
   from `DATASETS` / `datasetKeys()` in `@carbon/database/datasets`, mapping each to
   `{ key, label }` using the dataset's own `label` field (`"Aerospace & Satellite"`,
   `"Robotics OEM"`, `"Precision Manufacturing"`, `"Motor Assembly"`).

   A route loader is server-only and tree-shaken out of the browser bundle, and
   `onboarding+/industry.tsx:6` already imports from `@carbon/database/datasets` this
   way — so this costs nothing client-side. Reading the labels from source rather than
   hardcoding them means a fifth dataset appears on this page automatically and the two
   lists can never drift.

   *(Revised during execution: the original step hardcoded a four-entry list and carried
   a "STOP if a key is missing" escape hatch. Reading `DATASETS` makes that condition
   unreachable, so the hatch is gone.)*

6. The action dispatches on `formData.get("intent")` with four branches — `apply`
   (reads `datasetKey`, calls `startCompanyTemplate`), `keep` (`finalizeCompanyTemplate`),
   `revert` (`revertCompanyTemplate`), `dismiss` (deletes the failed marker; reuse the
   pattern `dismissCompanyExportFailure` uses in `backups.server.ts`). Follow the
   `accounting.tsx:84-166` idiom of returning `{ success, message }` per branch.

7. Before the `apply` branch does anything, refuse a concurrent run, mirroring
   `backups.tsx:179-185`:

   ```typescript
   if (run && run.status !== "failed") {
     return data(
       { success: false },
       await flash(request, error(null, "Finish your current demo data change — keep or revert it — first."))
     );
   }
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0.
pnpm exec biome check apps/erp/app/routes/x+/settings+/demo-data.tsx apps/erp/app/utils/path.ts apps/erp/app/modules/settings/ui/useSettingsSubmodules.tsx
# Expected: no error-severity findings (pre-existing warnings elsewhere are fine).
```

**Out of scope:** Do not modify `backups.tsx`. Do not remove or weaken
`canAccessBackups` / `requireBackupAccess`.

---

## Task 9: The status poll API route

**Depends on:** Task 7

**Files:**
- Create: `apps/erp/app/routes/api+/settings.demo-data-status.$templateRunId.ts`
- Copy from (precedent): `apps/erp/app/routes/api+/settings.backup-restore-status.$restoreRunId.ts`

**Steps:**

1. Copy the precedent file verbatim and change: the param name to `templateRunId`, the
   reader to `getCompanyTemplateRun`, and the returned shape to the template marker's
   metadata.

2. Keep both safety properties of the precedent exactly: `companyId` comes from
   `requirePermissions`, never from the URL, so a user cannot poll another company's run;
   and a failed access gate throws `new Response("Not found", { status: 404 })` rather
   than a 403, so the endpoint's existence is not disclosed.

3. Return `null` (not a 404) when there is no marker for that company — "no run" is a
   normal state the poller must be able to read.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0.
grep -n "404" apps/erp/app/routes/api+/settings.demo-data-status.\$templateRunId.ts
# Expected: at least one match (the access-gate response).
```

**Out of scope:** Do not add a new poll endpoint for the finalize or revert jobs — they
report through the same marker and therefore the same endpoint.

---

## Task 10: Demo Data UI components and progress phase labels

**Depends on:** Task 8

**Files:**
- Create: `apps/erp/app/modules/settings/ui/DemoData/TemplateCards.tsx`
- Create: `apps/erp/app/modules/settings/ui/DemoData/TemplateReviewRow.tsx`
- Create: `apps/erp/app/modules/settings/ui/DemoData/index.ts`
- Modify: `apps/erp/app/modules/settings/ui/index.ts` — export the new folder
- Modify: `apps/erp/app/modules/settings/ui/Backups/BackupProgressModal.tsx` — phase labels
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Backups/RestoreReviewRow.tsx`
  (lines 49-61 for the button set) and
  `apps/erp/app/modules/settings/ui/Backups/BackupProgressModal.tsx` (lines 17-41 for the
  phase maps, 184-216 for the polling effects)

**Steps:**

1. `TemplateCards.tsx` renders one card per dataset from the loader's `datasets` list,
   each with an Apply button that submits `intent=apply` and a hidden `datasetKey`.
   Buttons are disabled while a run is pending. Card copy, verbatim:

   > "Replace this company's data with a demo dataset — snapshotted first, so you can revert."

   Follow `backups.tsx:433-437` for card structure. There is deliberately **no**
   typed-confirmation modal: the safety story is reversibility, exactly as it is for
   restore (`BackupChoices.tsx:71-74` submits a destructive restore with a plain Submit).

2. `TemplateReviewRow.tsx` mirrors `RestoreReviewRow.tsx`: on `status === "ready"` render
   `[Keep]` and a destructive `[Revert]`; on `status === "failed"` render a secondary
   `[Dismiss]` plus the error text. Handlers `fetcher.submit({ intent, templateRunId },
   { method: "post" })` back to `path.to.demoData`.

   Section copy for the review card, verbatim:

   > "Demo data was applied to this company. Keep it, or revert to put back exactly what was here before."

3. In `BackupProgressModal.tsx`, add the three new phase keys to `PHASE_ORDER` and
   `PHASE_LABELS` (lines 17-41). The template forward run uses `snapshot | wipe | apply`;
   its revert reuses the existing `wipe | load | files`. Labels: "Snapshotting", "Clearing
   data", "Applying template". Add them as a separate ordered list keyed by mode rather
   than appending to the restore list — the modal picks its order from the mode it is
   given, and mixing the two would render phantom steps on a restore.

4. In the route component, wire the polling exactly as `BackupProgressModal.tsx:184-216`
   does: a 500 ms `setInterval` + `useFetcher.load` against
   `/api/settings/demo-data-status/{templateRunId}` while a run is active, and a 2.5 s
   `useRevalidator` otherwise. Hide a resolved review row optimistically with the
   `resolvedRunIds` trick from `backups.tsx:346-351` so it does not linger while the async
   finalize lands.

5. Mark every user-visible string with Lingui macros — `<Trans>` in JSX and
   `useLingui().t` in components, per `.claude/rules/i18n-lingui-system.md`. **Never**
   `import { t } from "@lingui/core/macro"` in app code; that throws at runtime here.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0.
pnpm exec biome check apps/erp/app/modules/settings/ui/DemoData apps/erp/app/modules/settings/ui/Backups/BackupProgressModal.tsx
# Expected: no error-severity findings.
```

**Out of scope:** Do not run `pnpm lingui:extract` — on this branch it produces roughly
120k lines of unrelated `.po` churn. Leave catalog extraction to a separate deliberate
commit.

---

## Task 11: Update the rules and AGENTS.md that this work makes stale

**Depends on:** none (but land it with the rest)

**Files:**
- Modify: `.claude/rules/onboarding-company-templates.md`
- Modify: `.claude/rules/company-backup-restore.md`

**Steps:**

1. In `onboarding-company-templates.md`, add a section covering: the
   `Settings → Demo Data` entry point, the snapshot / keep / revert lifecycle, the
   `snapshot` flag on the event, the two new events, and the two-wipes distinction
   (dev-seed wipe preserves bootstrap config and is what a template apply uses; the
   restore wipe is a tabula rasa and is what a revert uses). Correct the "Two callers, one
   code path" section — there are now two callers of the job, and `applyDataset` takes
   `wipeFirst`.

2. In `company-backup-restore.md`, record that `wipeAndLoad`, `getCompanyGroupId` and
   `resolveRestoreScope` are now exported and have a second caller in
   `company-template.ts`.

3. Fix two pre-existing stale lines in `company-backup-restore.md` while you are in it,
   per `.claude/rules/keep-sources-in-sync.md` (the code wins):
   - it claims `STORAGE_PATH_COLUMNS` holds "`modelPath`, `thumbnailPath`";
     `company-backup.ts:54` has only `thumbnailPath`, and the comment above it says
     `modelPath` is excluded on purpose.
   - it says "`satellite` is the only one today"; `DATASETS` has four keys.

**Verify:**
```bash
grep -n "modelPath" .claude/rules/company-backup-restore.md
# Expected: any remaining mention describes it as EXCLUDED, not as a member of the set.
grep -n "wipeFirst" .claude/rules/onboarding-company-templates.md
# Expected: at least one match.
```

**Out of scope:** Do not rewrite either rule wholesale. Targeted corrections only.

---

## Task 12: End-to-end verification

**Depends on:** Tasks 1-11

**Steps:**

1. Scoped typecheck of every touched package, then lint and unit tests:

   ```bash
   pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/lib --filter=@carbon/jobs --filter=erp
   pnpm exec biome check apps/erp/app packages/jobs/src packages/database/src packages/lib/src
   pnpm run test
   ```

   Do not run a whole-repo `typecheck` — it OOMs on this repo.

2. Prove the dev CLI is unchanged by the `beforeTiers` → `wipeFirst` migration. **Ask the
   user before running this** — it rebuilds a company's data, and the project rule is
   never to rebuild the database without the user:

   ```bash
   pnpm db:seed:dev -- --email dev@carbon.ms --dataset satellite
   ```

   Diff the printed `Seeded row counts` block against
   `.ai/runs/2026-08-13-seed-baseline.txt`, and the structural sums against
   `.ai/runs/2026-08-13-seed-baseline-structural.txt`. Any difference means the wipe
   migration changed behaviour — **STOP and report**, do not adjust the baseline.

3. Manual browser verification, with the user's permission, using the `/test` skill.
   Walk the acceptance criteria in the spec, at minimum:
   - apply `robotics` to a company that already has data; confirm the item list holds only
     robotics parts;
   - revert; confirm the pre-apply item / salesOrder / job counts come back;
   - apply again, then Keep; confirm the review row disappears and the snapshot folder is
     gone from the company's bucket;
   - while a run is pending, confirm a second apply is refused with the exact copy
     "Finish your current demo data change — keep or revert it — first.";
   - confirm a non-internal user on a non-local deployment cannot see the nav entry or
     reach the route.

4. Report results with actual command output. Do not claim the feature works without
   having run these.

**Out of scope:** Do not commit. The user commits; a plan file is not authorization.
