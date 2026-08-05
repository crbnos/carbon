# SolidWorks PDM Integration — implementation plan

**Spec:** .ai/specs/2026-08-04-solidworks-pdm-integration.md
**Research:** .ai/research/solidworks-pdm-integration.md
**Branch:** solidworks-pdm-integration-spec

Read the spec first. The whole build is precedent-driven: almost every task clones an Onshape file and applies enumerated deltas. Where a task rests on an assumption about the PDM Web API, an escape hatch says so — STOP and report rather than improvising, because no live vault is available for verification.

## Progress

- [ ] Task 1: Seed the `solidworks-pdm` integration catalog row (migration)
- [ ] Task 2: Build `SolidWorksPdmClient` + factory in `@carbon/ee`
- [ ] Task 3: Add the normalized BOM row validator (`lib/data.ts`)
- [ ] Task 4: Register the integration (config, registry, server hooks)
- [ ] Task 5: Add path helpers
- [ ] Task 6: Picker API routes (files / configurations / bom)
- [ ] Task 7: Add `type: "solidworks-pdm"` to the `sync` edge function
- [ ] Task 8: Manual BOM sync route (POST)
- [ ] Task 9: `SolidWorksPdmSync` UI + BoMExplorer mount + status icon
- [ ] Task 10: Event + trigger wiring for release sync
- [ ] Task 11: Matching/normalization helpers + unit tests
- [ ] Task 12: Attach helper (documents, models, thumbnails)
- [ ] Task 13: `solidworks-pdm-file-sync` Inngest job
- [ ] Task 14: `solidworks-pdm-release-poll` job + cron fan-out
- [ ] Task 15: Backfill API route
- [ ] Task 16: Webhook receiver route
- [ ] Task 17: Docs page (conditional on existing Onshape docs)
- [ ] Task 18: Fixture playbook + browser verification

## Dependencies

- Task 1 is independent (run first; everything else can proceed without it locally, but the settings UI needs the row to activate).
- Tasks 2–3 are independent of each other; Task 4 needs Task 2. Task 5 is independent.
- Tasks 6, 8 need Tasks 2, 5. Task 7 is independent (edge function only). Task 8 also needs Task 7.
- Task 9 needs Tasks 5, 6, 8.
- Task 10 is independent. Tasks 11–12 need Task 2. Task 13 needs Tasks 10–12. Task 14 needs Tasks 10, 13. Tasks 15–16 need Tasks 10, 14 (they trigger the poll event).
- Tasks 6, 7, 10, 11 can run as parallel subagents once Task 2 lands.
- Tasks 17–18 last.

---

## Task 1: Seed the `solidworks-pdm` integration catalog row (migration)

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_solidworks-pdm-integration.sql` (via the command below — never hand-pick the timestamp)
- Copy from (precedent): `packages/database/supabase/migrations/20250410120243_onshape-integration.sql` and `packages/database/supabase/migrations/20260703165330_onshape-asset-sync-jsonschema.sql`

**Steps:**
1. Run `pnpm db:migrate:new solidworks-pdm-integration`.
2. Fill the generated file with exactly (the `integration` table has only `id` + `jsonschema` since `20241006185904_integration-refactor.sql`):

```sql
INSERT INTO "integration" ("id", "jsonschema")
VALUES (
  'solidworks-pdm',
  '{
    "type": "object",
    "properties": {
      "baseUrl": { "type": "string" },
      "vaultName": { "type": "string" },
      "username": { "type": "string" },
      "password": { "type": "string" },
      "releasedStateName": { "type": "string" },
      "partNumberVariable": { "type": "string" },
      "revisionVariable": { "type": "string" },
      "assetSyncEnabled": { "type": "boolean" },
      "webApiVersion": { "type": "string" },
      "searchCapability": { "type": "string", "enum": ["state-search", "folder-sweep"] },
      "lastReleaseSyncAt": { "type": "string" }
    },
    "required": ["baseUrl", "vaultName", "username", "password"]
  }'::json
)
ON CONFLICT ("id") DO UPDATE SET "jsonschema" = EXCLUDED."jsonschema";
```

3. Run `pnpm db:migrate` to apply it to the local stack.
4. Run `pnpm run generate:types`.

**Verify:**
```bash
pnpm db:migrate
# Expected: output lists {timestamp}_solidworks-pdm-integration.sql as applied, no errors
psql postgresql://postgres:postgres@localhost:54322/postgres -c "select id from integration where id='solidworks-pdm';"
# Expected: one row: solidworks-pdm
# (If the local DB is not on 54322, find the port with `docker ps` — do NOT rebuild the DB.)
git status --porcelain packages/database/src
# Expected: empty or whitespace-only — a seed row changes no generated types
```

**Out of scope:** any new table, any change to `companyIntegration`, `externalIntegrationMapping`, or the `verify_integration` trigger.

## Task 2: Build `SolidWorksPdmClient` + factory in `@carbon/ee`

**Depends on:** none
**Files:**
- Create: `packages/ee/src/solidworks-pdm/lib/client.ts`
- Modify: `packages/ee/package.json` — add a `./solidworks-pdm` subpath export ONLY IF the existing exports map lists `./onshape` explicitly (mirror that entry); if exports are wildcarded, no change
- Copy from (precedent): `packages/ee/src/onshape/lib/client.ts` (axios client class + error types + `getOnshapeClient` factory at line ~591)

**Steps:**
1. Read the entire Onshape client first. Clone its structure: an axios instance, typed methods, `OnshapeApiError`-style error classes, a size-capped streaming download, and a factory that loads `companyIntegration` and returns `{ client, error }` without throwing.
2. Implement `SolidWorksPdmClient` with constructor `{ baseUrl, vaultName, username, password }`. All URLs are `${baseUrl}/api/...` with the vault name in the path. Auth model (differs from Onshape): no token is passed in — the client lazily calls `POST /api/{vaultName}/authenticate` with `{ Username, Password }`, stores `JwtString` in memory, sends `Authorization: Bearer <jwt>` on every call, and on a 401 response re-authenticates once and retries the request once (then surfaces the error).
3. Methods (paths from the research file §7; response types as minimal TS interfaces — define only fields we consume):
   - `getWebApiVersion(): GET /api/version/webapi`
   - `getVaultInfo(): GET /api/{v}/info`
   - `search(criteria): POST /api/{v}/search` — returns `[{ Id, Type }]` (Type: 0=Folder, 1=File)
   - `getFilesInfo(fileIds): POST /api/{v}/files/info` (bulk)
   - `getFileConfigurations(fileId, version): GET /api/{v}/files/{fileId}/{version}/configurations`
   - `getActiveConfig(fileId, version): GET /api/{v}/files/{fileId}/{version}/ActiveConfig` — returns the active configuration id/name
   - `getFileVariables(fileId, version): GET /api/{v}/files/{fileId}/{version}/variables` — returns `ConfigInfo[]` (`{ ConfigurationName, ConfigurationId, Models: [{ VarName, VarValue }] }`)
   - `getBomInfo(fileId): GET /api/{v}/files/{fileId}/bominfo`
   - `getComputedBom(bomTypeId, fileId, version, folderId, configId): GET /api/{v}/bom/{bomTypeId}/{fileId}/{version}/{folderId}/computed?configId=&latest=true`
   - `browseFolder(folderId): GET /api/{v}/folders/{folderId}/browse`
   - `getThumbnail(fileId, version, folderId, { maxBytes })` — `GET /api/{v}/files/{fileId}/{version}/thumbnails?folderId=`; the API replies with a redirect `Location`; follow it and return bytes + content type, enforcing the same `maxBytes` cap as `downloadFileToTemp` while reading (abort and throw `SolidWorksPdmAssetTooLargeError` once the cap is exceeded — the thumbnail is buffered in memory, so an uncapped response is a memory hazard)
   - `downloadFileToTemp(fileId, version, folderId, { maxBytes })` — `GET /api/{v}/files/{fileId}/{version}/download`, streamed to a temp file with the same byte-cap behavior as Onshape's `downloadExternalDataToFile` (throw `SolidWorksPdmAssetTooLargeError` past the cap)
   - `registerWebhook(url, events)` / `getWebhooks()` / `deleteWebhook(id)` — `POST|GET /api/{v}/configuration/hooks/url` (2025+; callers treat failures as non-fatal)
4. Error classes: `SolidWorksPdmApiError` (status + message + url) and `SolidWorksPdmAssetTooLargeError`, mirroring the Onshape pair.
5. Factory `getSolidWorksPdmClient(client: SupabaseClient<Database>, companyId: string)`: read `companyIntegration` row `id = "solidworks-pdm"`, require `active`, require `metadata.baseUrl/vaultName/username/password` (flat keys), return `{ client, error: null }` or `{ client: null, error: string }`. No token persistence back to the DB (unlike Onshape's refresh flow — PDM JWTs are re-fetched, not refreshed).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0, no new errors
```

**Out of scope:** retries beyond the single 401 re-auth (Inngest owns retry policy); any write endpoint (check-in, state change, datacard save); caching tokens in Redis or the DB.

## Task 3: Add the normalized BOM row validator (`lib/data.ts`)

**Depends on:** none
**Files:**
- Create: `packages/ee/src/solidworks-pdm/lib/data.ts`
- Copy from (precedent): `packages/ee/src/onshape/lib/data.ts` (`onShapeDataValidator`)

**Steps:**
1. Read the Onshape validator to match its style and the field set the `sync` edge function consumes.
2. Export `solidWorksPdmDataValidator` — a zod schema for one normalized BOM row: `{ partNumber: string, description: string optional default "", revision: string optional default "", quantity: number, unitOfMeasure: string optional, level: number, fileId: string, configId: string optional, folderId: string optional }` — plus `type SolidWorksPdmBomRow = z.infer<...>`. Match the Onshape validator's conventions for optionality/coercion exactly where fields overlap (partNumber, description, quantity).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** parsing raw PDM API responses here (that normalization lives in the Task 6 BOM loader).

## Task 4: Register the integration (config, registry, server hooks)

**Depends on:** Task 2
**Files:**
- Create: `packages/ee/src/solidworks-pdm/config.tsx`
- Create: `packages/ee/src/solidworks-pdm/hooks.server.ts`
- Modify: `packages/ee/src/index.ts` — add `SolidWorksPdm` to the `integrations` array + barrel exports
- Modify: `packages/ee/src/hooks.server.ts` — add the `solidworks-pdm` entry to the `serverHooks` map
- Copy from (precedent): `packages/ee/src/onshape/config.tsx`, `packages/ee/src/onshape/hooks.server.ts`

**Steps:**
1. `config.tsx`: `defineIntegration` with `id: "solidworks-pdm"`, `name: "SolidWorks PDM"`, `category: "CAD"` (same literal as Onshape's), `active: true` (no env-var gate — credentials are per-company), an inline SVG `Logo` component (simple "PDM" wordmark in currentColor; do not fetch brand assets), `description` stating: PDM Professional only, requires the customer's PDM Web API server reachable over HTTPS, and one dedicated vault service account. `images: []`.
2. `settings` (with `settingGroups` `Connection` and `Release sync` — copy the group mechanics from any integration using `group`, e.g. grep `settingGroups` in `packages/ee/src`): `baseUrl` (text, required), `vaultName` (text, required), `username` (text, required), `password` (password, required), `releasedStateName` (text, default `"Released"`), `partNumberVariable` (text, default `"Number"`), `revisionVariable` (text, default `"Revision"`), `assetSyncEnabled` (switch, default false).
3. `schema`: zod object with all eight fields; `baseUrl` must parse as URL and be `https:` unless hostname is `localhost`/`127.0.0.1`; `assetSyncEnabled` uses the same `z.preprocess` string→boolean trick as Onshape's schema. Also `.passthrough()` so system-written keys (`webApiVersion`, `searchCapability`, `lastReleaseSyncAt`) survive validation — check how the settings action at `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` merges metadata before deciding whether passthrough is needed, and mirror whichever integration already preserves extra keys (Onshape's `onshapeCompanyId` proves the merge path exists).
4. `actions`: `[{ id: "backfill", label: "Backfill released assets", description: <one sentence>, endpoint: "/api/integrations/solidworks-pdm/backfill", enabledWhenSetting: "assetSyncEnabled" }]`.
5. No `oauth`, no `onClientInstall`.
6. `solidworks-pdm/hooks.server.ts`: export `solidWorksPdmOnInstall` (authenticate + `getVaultInfo`; on failure return/throw the same error shape Onshape's install path surfaces via `integration-errors.ts`; on success write `metadata.webApiVersion` via `upsertCompanyIntegration`-style update, then if `assetSyncEnabled` and version ≥ 2025 best-effort `registerWebhook` for the post-ChangeState event pointing at `${origin}/api/webhook/solidworks-pdm/${companyId}` — wrap in try/catch, log, continue), `solidWorksPdmOnUninstall` (best-effort `deleteWebhook`), `solidWorksPdmOnHealthcheck` (authenticate + vault info; return the exact healthcheck result shape used by Onshape's `onHealthcheck` — read it in `packages/ee/src/onshape/hooks.server.ts` first).
7. Wire all three into the `serverHooks` map in `packages/ee/src/hooks.server.ts`; add `export { Logo as SolidWorksPdmLogo, SolidWorksPdm } from "./solidworks-pdm/config"` to `packages/ee/src/index.ts` and append `SolidWorksPdm` to the `integrations` array.

If the settings action's metadata merge turns out to REPLACE rather than merge (contradicting the Onshape playbook's step 3), STOP and report — do not improvise a merge in the config.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: exit 0 for both
```

**Out of scope:** the backfill/webhook routes themselves (Tasks 15–16); translations of setting labels (the check-and-commit gate's /translate pass handles .po fill).

## Task 5: Add path helpers

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — add API path helpers
- Copy from (precedent): the `onShapeDocuments`/`onShapeVersions`/`onShapeElements`/`onShapeBom`/`onShapeSync` entries in the same file

**Steps:**
1. Next to the Onshape entries, add: `solidWorksPdmFiles` → `/api/integrations/solidworks-pdm/files`, `solidWorksPdmConfigurations(fileId)` → `/api/integrations/solidworks-pdm/files/${fileId}/configurations`, `solidWorksPdmBom(fileId)` → `/api/integrations/solidworks-pdm/files/${fileId}/bom`, `solidWorksPdmSync` → `/api/integrations/solidworks-pdm/sync`, `solidWorksPdmBackfill` → `/api/integrations/solidworks-pdm/backfill`. Match the exact naming/casing style of the neighboring Onshape helpers.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** none.

## Task 6: Picker API routes (files / configurations / bom)

**Depends on:** Tasks 2, 5
**Files:**
- Create: `apps/erp/app/routes/api+/integrations.solidworks-pdm.files.ts`
- Create: `apps/erp/app/routes/api+/integrations.solidworks-pdm.files.$fileId.configurations.ts`
- Create: `apps/erp/app/routes/api+/integrations.solidworks-pdm.files.$fileId.bom.ts`
- Copy from (precedent): `apps/erp/app/routes/api+/integrations.onshape.documents.ts` (list loader shape + `requirePermissions` scope — copy the scope verbatim), `...d.$did.v.$vid.elements.ts` (param loader), `...d.$did.v.$vid.e.$eid.bom.ts` (BOM loader)

**Steps:**
1. `files.ts` (GET loader): `requirePermissions` with the same scope as `integrations.onshape.documents.ts`; read `?q=` search text; `getSolidWorksPdmClient`; call `search` with a filename criteria built from `q`. Search returns only `[{ Id, Type }]` — so take at most the first **200** file-type ids, hydrate them via one bulk `getFilesInfo` call, filter to extensions `.sldasm`/`.sldprt` (case-insensitive), and return at most **50** results as `{ files: [{ id, name, folderId, version }] }`. Return plain objects (never `Response.json`). Empty `q` → return `{ files: [] }` without calling the API.
2. `configurations.ts` (GET loader): same scope; params `fileId`, query `version` and `folderId` (pass through from the file pick); call `getFileConfigurations`; return `{ configurations: [{ id, name }] }`.
3. `bom.ts` (GET loader): same scope; params `fileId`, query `version`, `folderId`, `configId`; call `getBomInfo` then `getComputedBom` with `latest=true`; **normalize here**: read the integration metadata's `partNumberVariable`/`revisionVariable`, locate the matching entries in the BOM `Columns[]` by name (case-insensitive), and flatten the recursive row tree into `SolidWorksPdmBomRow[]` (Task 3 type) with `level` = tree depth and `quantity` from the BOM quantity column. The normalizer is **strict — it throws rather than degrading** (a later validator cannot repair a wrong column pick or a mis-flattened tree): zero OR more than one column matching `partNumberVariable` → throw naming the columns found; configured revision column missing → throw; any quantity that is not a finite number ≥ 0 → throw with the row's part number; any child row whose depth is not parent depth + 1 → throw. The loader catches and returns the message as a form-level error so the picker shows it and Sync is never enabled with malformed rows. Return `{ rows }`.

Escape hatch: the exact JSON field names of the computed-BOM response (`Columns`, row tree nesting) are documented only loosely (research §7). Write the normalizer as a small pure function `normalizeComputedBom(raw, { partNumberVariable, revisionVariable })` exported from the route file's sibling `packages/ee/src/solidworks-pdm/lib/bom.ts` so Task 11 can unit-test it against a hand-written fixture; if the real response shape can't be inferred from the research file, STOP and report rather than guessing silently — the fixture then documents the assumed shape for live-vault validation.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** UI; writing mappings; folder browsing UI (search-only picker in v1).

## Task 7: Add `type: "solidworks-pdm"` to the `sync` edge function

**Depends on:** none
**Files:**
- Modify: `packages/database/supabase/functions/sync/index.ts` — new discriminated-union variant + handler
- Copy from (precedent): the existing `type: "onshape"` variant in the same file (union at line ~25, handler below)

**Steps:**
1. Before editing, record the baseline own-file error count: `cd packages/database/supabase/functions && deno check sync/index.ts 2>&1 | grep -c "sync/index.ts"` (lesson: this tree is not deno-check-clean; gate on the delta).
2. Read the whole `onshape` handler. Add a `z.object({ type: z.literal("solidworks-pdm"), companyId, userId, itemId, rows: <inline zod matching SolidWorksPdmBomRow — duplicate the shape here; Deno functions must not import from packages/ee>, source: z.object({ fileId, configId: optional, folderId: optional }) })` variant to `payloadValidator`.
3. Implement the handler by extracting/reusing the Onshape handler's tree-building core (items/parts/make-method creation from leveled rows). The normalized rows already carry `partNumber`/`description`/`revision`/`quantity`/`level`, so the handler maps them into the same internal structure the Onshape BOM rows produce. Write `externalIntegrationMapping` rows: integration `"solidworks-pdm"` on the root item with metadata `{ fileId, configId, folderId }`, and `"solidworksPdmData"` per created/updated item with the raw row as metadata — mirroring how the Onshape handler writes `"onshape"`/`"onshapeData"` (find those exact writes in the file and copy their column usage, including `companyId` and audit fields).
4. If the Onshape tree-building core is too entangled with Onshape-specific row fields to reuse without behavior risk, duplicate it into a clearly-named function for the new variant instead of refactoring the shared path — preserving Onshape behavior outranks DRY here.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check sync/index.ts 2>&1 | grep -c "sync/index.ts"
# Expected: count <= the baseline recorded in step 1 (no new own-file errors)
```

**Out of scope:** changes to the `onshape` variant's behavior; `config.toml` (the `sync` function is already registered).

## Task 8: Manual BOM sync route (POST)

**Depends on:** Tasks 5, 7
**Files:**
- Create: `apps/erp/app/routes/api+/integrations.solidworks-pdm.sync.ts`
- Copy from (precedent): `apps/erp/app/routes/api+/integrations.onshape.sync.ts` (copy its `requirePermissions` scope, its edge-function invocation via `client.functions.invoke("sync", ...)`, and its mapping upsert verbatim, adjusting names)

**Steps:**
1. Clone the Onshape sync action: validate the posted body (`itemId`, `rows` per `solidWorksPdmDataValidator`, `source: { fileId, configId?, folderId? }`), invoke the `sync` edge function with `type: "solidworks-pdm"`, and upsert the root `externalIntegrationMapping` row exactly the way the Onshape route does (same table columns, `lastSyncedAt` update included).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** none.

## Task 9: `SolidWorksPdmSync` UI + BoMExplorer mount + status icon

**Depends on:** Tasks 5, 6, 8
**Files:**
- Create: `apps/erp/app/components/SolidWorksPdmSync.tsx`
- Modify: `apps/erp/app/modules/items/ui/Item/BoMExplorer.tsx` — mount beside `OnshapeSync` (line ~160)
- Modify: `apps/erp/app/components/Icons.tsx` — add `SolidWorksPdmStatus`
- Copy from (precedent): `apps/erp/app/components/OnshapeSync.tsx` (the whole component: fetchers, comboboxes, BOM preview tree, Sync/Save buttons, saved-selection + `lastSyncedAt` read from `externalIntegrationMapping`); `OnshapeStatus` in `Icons.tsx`

**Steps:**
1. Clone `OnshapeSync.tsx` → `SolidWorksPdmSync.tsx` with these deltas: the three-level Document→Version→Element pickers become two levels — a debounced file **search input + results combobox** (GET `path.to.api.solidWorksPdmFiles?q=`) and a **configuration combobox** (GET `...solidWorksPdmConfigurations(fileId)?version=&folderId=`); "Fetch" loads the normalized BOM (GET `...solidWorksPdmBom(fileId)?...&configId=`); the preview tree renders `partNumber`/`description`/`quantity`/`revision` by `level`; "Sync" POSTs to `path.to.api.solidWorksPdmSync`. Keep the saved-mapping read/write behavior (integration id `"solidworks-pdm"`).
2. In `BoMExplorer.tsx`, find how the `OnshapeSync` mount is gated on the Onshape integration being active, and add the equivalent `SolidWorksPdmSync` mount gated on `solidworks-pdm` — both may render if both integrations are active.
3. `SolidWorksPdmStatus` in `Icons.tsx`: clone `OnshapeStatus`. Field sources (these are the only producers that persist them): `stateName` from the `"solidworks-pdm-release-model"`/`"-drawing"` mapping metadata (written by Task 13 step 5), `revision` from the `solidworksPdmData` mapping metadata. No release mapping yet → render revision only. A plain text badge is sufficient (no state-color mapping in v1).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: both exit 0
```

**Out of scope:** MES; any redesign of the BOM explorer; per-configuration multi-item sync.

## Task 10: Event + trigger wiring for release sync

**Depends on:** none
**Files:**
- Modify: `packages/lib/src/events.ts` — add `carbon/solidworks-pdm-release-poll` and `carbon/solidworks-pdm-file-sync` schemas (Onshape precedents at lines ~514 and ~526)
- Modify: `packages/lib/src/trigger.ts` — add both to `taskToEvent`
- Copy from (precedent): the `carbon/onshape-backfill` + `carbon/onshape-revision-sync` entries in both files

**Steps:**
1. `carbon/solidworks-pdm-release-poll` payload: `{ companyId: string, mode: "incremental" | "backfill" }`.
2. `carbon/solidworks-pdm-file-sync` payload: `{ companyId: string, fileId: string, version: number, folderId: string, fileName: string, messageId: string }` (`messageId` = `${companyId}:${fileId}:${version}`, used for idempotency like Onshape's).
3. Mirror the zod style and the `taskToEvent` key naming of the Onshape entries exactly.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** the jobs themselves.

## Task 11: Matching/normalization helpers + unit tests

**Depends on:** Task 2 (types), Task 6 (`normalizeComputedBom` lives in `packages/ee/src/solidworks-pdm/lib/bom.ts`)
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/solidworks-pdm-matching.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/solidworks-pdm-matching.test.ts`
- Copy from (precedent): `packages/jobs/src/inngest/functions/integrations/onshape-matching.ts` + `onshape-matching.test.ts` (reuse `releaseKey`, `sharedNumberSuffix`, `escapeLikePattern` — import them if exported, otherwise re-export/copy with attribution comment)

**Steps:**
1. Pure functions: `extractCardValues(configInfos, activeConfigId, { partNumberVariable, revisionVariable })` → selects the `ConfigInfo` whose `ConfigurationId === activeConfigId` (the id from `getActiveConfig`), falling back per-variable to the `@` tab entry when absent (input = the `ConfigInfo[]` shape from Task 2); `releaseMatchKey(partNumber, revision)` → delegates to the Onshape `releaseKey` convention; `colocatedCandidateNames(fileName)` → for `x.sldprt`/`x.sldasm` returns `["x.step", "x.stp"]`, for `x.slddrw` returns `["x.pdf"]`, case-insensitive, else `[]`; `classifyPdmFile(fileName)` → `"model" | "drawing" | "other"`; `releaseMappingIntegration(fileClass)` → `"solidworks-pdm-release-model" | "solidworks-pdm-release-drawing"`.
2. Tests (vitest, mirror the Onshape test file's structure): active-config selection by id, per-variable `@` fallback, and unknown `activeConfigId` → full `@` fallback; empty part number → no match key; drawing shared-suffix matching via the reused `sharedNumberSuffix`; `colocatedCandidateNames` for all three extensions + uppercase variants; `classifyPdmFile` edge cases (`.SLDASM`, no extension). `normalizeComputedBom` fixture tests: a valid fixture (hand-write the raw computed-BOM JSON, documenting the assumed API shape per Task 6's escape hatch) asserting flattened rows/levels/quantities, plus **rejection cases** — zero part-number column matches, two ambiguous matches, a non-finite/negative quantity, and a child row skipping a level — each asserting a thrown error.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- solidworks-pdm-matching
# Expected: all new tests pass
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0 (noUncheckedIndexedAccess: use optional chaining on indexed access in tests)
```

**Out of scope:** network calls; DB access.

## Task 12: Attach helper (documents, models, thumbnails)

**Depends on:** Task 2
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/solidworks-pdm-attach.ts`
- Copy from (precedent): `packages/jobs/src/inngest/functions/integrations/onshape-attach.ts` (the Carbon-side storage upload, `document` row creation, `modelUpload` row creation + item linkage, thumbnail storage — copy the column usage and storage paths verbatim, changing only the `sourceDocument` label to `"SolidWorks PDM"` and path segments from onshape to solidworks-pdm)

**Steps:**
1. Read `onshape-attach.ts` end-to-end first. Export the same operation set it provides (attach model file → `modelUpload` + item link; attach PDF → `document` linked to the item; store thumbnail → `modelUpload.thumbnailPath`), taking already-downloaded temp file paths/bytes as input so this module stays PDM-API-free.
2. Filename sanitization: reuse whatever sanitizer `onshape-attach.ts` uses (lesson: storage keys from raw filenames break silently — never interpolate raw names).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** matching logic (Task 11); deciding WHAT to attach (Task 13).

## Task 13: `solidworks-pdm-file-sync` Inngest job

**Depends on:** Tasks 10, 11, 12
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/solidworks-pdm-file-sync.ts`
- Modify: `packages/jobs/src/inngest/functions/integrations/index.ts` — export it
- Modify: `packages/jobs/src/inngest/index.ts` — register it (Onshape registrations at lines ~118–119)
- Copy from (precedent): `packages/jobs/src/inngest/functions/integrations/onshape-revision-sync.ts` (function options, payload parse, enabled-check, `withRateLimitRetry` wrapper, `model-optimize`/`model-thumbnail` fan-out) and `onshape-sync-element.ts` (per-asset orchestration)

**Steps:**
1. `inngest.createFunction({ id: "solidworks-pdm-file-sync", retries: 3, idempotency: "event.data.messageId", concurrency: { key: "event.data.fileId", limit: 1 } }, { event: "carbon/solidworks-pdm-file-sync" }, ...)`.
2. Body: parse payload → `getCarbonServiceRole()` → check integration active + `assetSyncEnabled` (clone the `isOnshapeAssetSyncEnabled` helper pattern as `isSolidWorksPdmAssetSyncEnabled`, reading `companyIntegration` metadata) → `getSolidWorksPdmClient` → `getActiveConfig` then `getFileVariables` → `extractCardValues(configInfos, activeConfigId, …)` → `releaseMatchKey`; no key or no matching item (`item.readableIdWithRevision` lookup — copy the exact matching query from `onshape-sync-element.ts`, including `escapeLikePattern` usage and the drawing shared-suffix path for `.slddrw`) → return `{ skipped: true, reason }`.
3. Idempotency, keyed per file class: look up `externalIntegrationMapping` with integration `releaseMappingIntegration(classifyPdmFile(fileName))` (`"solidworks-pdm-release-model"` for `.sldprt`/`.sldasm`, `"-drawing"` for `.slddrw`), entityType `"item"`, entityId = matched item id, companyId. If the recorded metadata `version >= payload.version`, return `{ skipped: true, reason: "up-to-date" }` — the `>=` guard blocks both replays and an out-of-order poll overwriting newer release state with older. The two class-specific integration values mean a released part and its drawing (same item) keep separate rows and never clobber each other.
4. By `classifyPdmFile`: model → `browseFolder(folderId)`, find first `colocatedCandidateNames` hit, `downloadFileToTemp` it, attach via Task 12, `step.sendEvent("model-optimize", ...)` exactly like `onshape-revision-sync.ts`; fetch `getThumbnail`, store via Task 12, else fall back to `carbon/model-thumbnail`. Drawing → co-located PDF → attach as document. `other` → skip.
5. Upsert the class-specific `"solidworks-pdm-release-*"` mapping row (metadata `{ fileId, version, configId, fileName, stateName: <the metadata's releasedStateName> }`, `lastSyncedAt: now`, `companyId`, audit fields — copy column usage from wherever `onshape-sync-element.ts`/the sync route writes mappings). `stateName` is what `SolidWorksPdmStatus` (Task 9) renders; this upsert happens ONLY after the attaches succeed — the poll's dedupe depends on that ordering.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs && pnpm --filter @carbon/jobs test
# Expected: exit 0; existing + Task 11 tests pass
```

**Out of scope:** creating items; syncing files not in the released state (the poll already filtered).

## Task 14: `solidworks-pdm-release-poll` job + cron fan-out

**Depends on:** Tasks 10, 13
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/solidworks-pdm-release-poll.ts` (poll function + cron function in one file)
- Modify: `packages/jobs/src/inngest/functions/integrations/index.ts` + `packages/jobs/src/inngest/index.ts` — export/register both
- Copy from (precedent): `packages/jobs/src/inngest/functions/integrations/onshape-backfill.ts` (retries 10, per-company concurrency, cursor loop) and `packages/jobs/src/inngest/functions/scheduled/update-exchange-rates.ts` (cron iterating active `companyIntegration` rows)

**Steps:**
1. Cron function `solidworks-pdm-release-cron`: `{ cron: "*/30 * * * *" }`; select `companyIntegration` where `id = 'solidworks-pdm'` and `active = true`; filter rows where `metadata.assetSyncEnabled === true`; `step.sendEvent` one `carbon/solidworks-pdm-release-poll` (`mode: "incremental"`) per company. Zero rows → return early (log, like the exchange-rates function).
2. Poll function: `{ id: "solidworks-pdm-release-poll", retries: 10, concurrency: { key: "event.data.companyId", limit: 1 } }`, event `carbon/solidworks-pdm-release-poll`. Body:
   - Load integration metadata. There is **no date cursor** — dedupe is mapping-based (below), so `mode: "incremental"` and `mode: "backfill"` run the same sweep; `mode` is kept for logging only.
   - Candidate discovery, honoring `metadata.searchCapability` — **default is `"folder-sweep"`**:
     - unset or `"folder-sweep"`: recursively `browseFolder` from the vault root, bulk `getFilesInfo` per folder batch, filter current state = `releasedStateName`.
     - `"state-search"` (used ONLY when metadata explicitly says so — set by hand after live-vault validation, never inferred at runtime): call `client.search` with workflow-state-name criteria, then cross-check each result's current-state field from bulk `getFilesInfo`; any mismatch → log, ignore the mismatching rows, and proceed with the verified subset. Never auto-flip the flag in either direction: an undocumented search syntax returning silently-empty results must not be able to make releases invisible.
   - Dedupe: drop candidates whose class-specific `"solidworks-pdm-release-*"` mapping row (Task 13 step 3 lookup, matched by fileId in metadata) already records `version >= candidate.version`. Because Task 13 writes that row only after successful attaches, a failed file-sync automatically re-qualifies next sweep.
   - Fan out one `carbon/solidworks-pdm-file-sync` per remaining candidate via `step.sendEvent` (batched).
   - After the sweep completes, write `metadata.lastReleaseSyncAt = sweepStartIso` (merge-update the metadata JSON — never replace it wholesale). This field is informational (shown in settings) — it is NOT read by discovery.
   
   Escape hatch: the search criteria body format is undocumented. Implement `state-search` behind a small request-builder function with the assumed format in one place; if the assumption can't be expressed from the research file, ship `folder-sweep` only and report the gap — do not invent criteria syntax silently.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs && pnpm --filter @carbon/jobs test
# Expected: exit 0; tests pass
```

**Out of scope:** attaching assets (Task 13); webhook/backfill triggers (Tasks 15–16).

## Task 15: Backfill API route

**Depends on:** Tasks 10, 14
**Files:**
- Create: `apps/erp/app/routes/api+/integrations.solidworks-pdm.backfill.ts`
- Copy from (precedent): `apps/erp/app/routes/api+/integrations.onshape.backfill.ts` (copy `requirePermissions` scope, the `assetSyncEnabled` gate returning 400 with a message, and the `trigger(...)` call verbatim, adjusting names)

**Steps:**
1. Clone with deltas: gate message references SolidWorks PDM; trigger `carbon/solidworks-pdm-release-poll` with `{ companyId, mode: "backfill" }`; success body `{ success: true, message: "SolidWorks PDM asset backfill started" }` (plain object return).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** none.

## Task 16: Webhook receiver route

**Depends on:** Tasks 10, 14
**Files:**
- Create: `apps/erp/app/routes/api+/webhook.solidworks-pdm.$companyId.ts`
- Copy from (precedent): `apps/erp/app/routes/api+/webhook.onshape.$companyId.ts` (public action shape, active-integration + `assetSyncEnabled` checks, 400 "Integration not configured" for unknown company, zod envelope, 200 acks)

**Steps:**
1. Clone with deltas: the zod envelope is lenient — `z.object({ EventType: z.union([z.string(), z.number()]).optional(), VaultName: z.string().optional() }).passthrough()`; any POST that parses as JSON on an active, asset-sync-enabled company triggers `carbon/solidworks-pdm-release-poll` `{ companyId, mode: "incremental" }` and returns `{ success: true }`. Non-JSON body → 400. Unknown/inactive company → 400 "Integration not configured". **Never** read file ids or state names from the payload (unsigned source — spec Risks).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** signature verification (PDM doesn't sign); rate limiting beyond what the route framework provides.

## Task 17: Docs page (conditional on existing Onshape docs)

**Depends on:** Tasks 1–16 (documents the finished behavior)
**Files:**
- Possibly create: a sibling of the Onshape page under `docs/content/` (exact path determined in step 1)

**Steps:**
1. Run `grep -ril onshape docs/content | head`. 
2. If it returns one or more pages: invoke the `carbon-docs` skill and author a SolidWorks PDM page as a sibling (same directory, same frontmatter shape), covering: prerequisites (PDM Professional, Web API server exposed over HTTPS, dedicated service-account seat, release-time convert tasks producing co-located STEP/PDF), the settings fields, what syncs (both features), and what is out of scope (PDM Standard, writes to vault, per-configuration items). Ground every claim in the implemented code, not this plan.
3. If it returns nothing: there is no CAD-integration docs surface yet — skip page creation and record "no docs surface for integrations; follow-up" in the PR body. Do not invent a new docs section in this task.

**Verify:**
```bash
pnpm --filter docs build
# Expected: exit 0 (only if a page was created; otherwise N/A — state which branch was taken)
```

**Out of scope:** glossary changes; API reference (codegen).

## Task 18: Fixture playbook + browser verification

**Depends on:** Tasks 1–16
**Files:**
- Create: `.ai/playbooks/solidworks-pdm.md`
- Copy from (precedent): `.ai/playbooks/onshape-asset-sync.md` (fixture SQL, gating checks, selector notes)

**Steps:**
1. Boot the stack with plain `crbn up` (portless). Login per the `/auth` skill.
2. Write the playbook mirroring the Onshape one, with the PDM fixture:

```sql
insert into "companyIntegration" (id,"companyId",active,metadata,"updatedAt","updatedBy")
values ('solidworks-pdm','<companyId>',true,
 '{"baseUrl":"https://localhost:9999","vaultName":"Fixture","username":"fixture","password":"FIXTURE_FAKE","releasedStateName":"Released","partNumberVariable":"Number","revisionVariable":"Revision","assetSyncEnabled":false}'::json,
 now(),'<userId>')
on conflict (id,"companyId") do update set active=excluded.active, metadata=excluded.metadata, "updatedAt"=now();
```

3. Verify with agent-browser (submit RVF forms via `requestSubmit`, per the known agent-browser gotcha):
   - `/x/settings/integrations` shows the SolidWorks PDM card.
   - `/x/settings/integrations/solidworks-pdm` renders Connection + Release sync groups; the backfill action appears only after `assetSyncEnabled` is toggled on and saved; saving preserves `username`/`password` in metadata (SQL check).
   - `POST /api/integrations/solidworks-pdm/backfill` from the authenticated session: 200 when enabled, 400 when disabled.
   - `curl POST /api/webhook/solidworks-pdm/<companyId>` with `{"EventType":8}`: 200 `{"success":true}`; with an unknown companyId: 400.
   - Item BOM explorer shows the SolidWorks PDM sync widget while the fixture row is active (the pickers will error against the fake baseUrl — expected; capture with the `/error` skill and note it).
4. Cleanup SQL (delete the fixture row, keyed on the FIXTURE password) goes in the playbook.
5. Record in the run notes: live-vault sync (Tasks 13–14 end-to-end against real PDM) is **environment-gated, not verified** — the PR must say so explicitly.

**Verify:**
```bash
ls .ai/playbooks/solidworks-pdm.md
# Expected: file exists; all playbook steps above executed with screenshots for the settings page and BOM explorer widget
```

**Out of scope:** live PDM vault testing; performance testing of vault sweeps.
