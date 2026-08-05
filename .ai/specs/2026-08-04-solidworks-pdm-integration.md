# SolidWorks PDM Integration

> Status: draft
> Author: Claude (with Brad Barbin)
> Date: 2026-08-04
> Research: `.ai/research/solidworks-pdm-integration.md`
> Plan: `.ai/plans/2026-08-04-solidworks-pdm-integration.md`
> Precedent: the Onshape integration (`packages/ee/src/onshape/`, `packages/jobs/src/inngest/functions/integrations/onshape-*.ts`, `apps/erp/app/routes/api+/integrations.onshape.*`, `apps/erp/app/routes/api+/webhook.onshape.$companyId.ts`)

## TLDR

Add a `solidworks-pdm` integration that mirrors the Onshape integration's two features against a customer's on-prem SOLIDWORKS PDM Professional vault, reached through the **PDM Web API** (the REST server that ships with PDM Professional, IIS-hosted, JWT auth): **(A) manual BOM sync** — from the item BOM explorer, pick a vault assembly + configuration, preview its computed BOM, and sync it into a Carbon make-method tree via the existing `sync` edge function (new discriminated-union variant); **(B) release asset sync** — a polling Inngest job (cron ground truth; the PDM 2025+ webhook is only a poll-now hint) finds files that entered the customer's "Released" workflow state, matches data-card part number + revision to `item.readableIdWithRevision`, and link-only-attaches the API thumbnail, a co-located converted drawing PDF, and a co-located converted STEP model (fanning out to `carbon/model-optimize`). No new tables: config + credentials live in `companyIntegration.metadata` (validated by a new `integration` catalog jsonschema), and external references live in `externalIntegrationMapping`. Sync is strictly PDM → Carbon; Carbon never writes to the vault. An on-prem COM agent (the CADLink-style architecture) is explicitly deferred.

## Problem Statement

Carbon's only CAD integration is Onshape — cloud-native, webhook-driven. The majority of job-shop and mid-market manufacturers run SOLIDWORKS with PDM Professional on-prem. Today those customers rekey part numbers, descriptions, revisions, and BOMs from PDM into Carbon by hand, and released drawings/models never reach the Carbon item record. The industry-standard behavior (research §9: CADLink, CAD2BOM, CustomTools) is a one-way, release-triggered push of item master + BOM + released documents from CAD/PDM into the ERP — Carbon should offer the same, packaged like the Onshape integration so all the existing plumbing (integration registry, settings UI, `companyIntegration`, `externalIntegrationMapping`, Inngest asset pipeline) is reused.

Concretely, a customer releases `BRKT-1042.SLDDRW` rev C in PDM: nothing happens in Carbon. With this integration, within one poll cycle Carbon item `BRKT-1042` rev C gets the released drawing PDF attached, the STEP model becomes its viewable `modelUpload`, and the vault thumbnail becomes its preview — exactly what the Onshape release sync does for Onshape customers today.

## Proposed Solution

### Architecture

Cloud-direct: the Carbon backend (Inngest jobs + ERP loaders) talks HTTPS to the customer's PDM **Web API server** (`https://pdm.example.com:65453/api/{vaultName}/…`), authenticating as a dedicated PDM service account (`POST /api/{vaultName}/authenticate` → JWT; TTL undocumented, so every call path re-authenticates once on 401). This is the same shape as the Onshape integration — a REST client in `packages/ee`, per-company credentials in `companyIntegration.metadata` — with two deliberate differences forced by PDM's nature (research §2, §4):

1. **Credentials form instead of OAuth.** PDM has no OAuth; the settings form collects `baseUrl`, `vaultName`, `username`, `password` (the `password` field type already exists in `IntegrationSetting`). No `onClientInstall` popup, no `install.ts`/`oauth.ts` routes.
2. **Polling instead of webhooks as ground truth.** PDM webhooks exist only on 2025+, are unsigned, and are not proven to fire for desktop-client transitions (research §4). A cron-driven Inngest poll is authoritative; the webhook receiver merely triggers an immediate poll.

Supported: PDM **Professional** with the Web API server reachable from Carbon's backend over HTTPS. Unsupported in v1: PDM Standard (no Web API), on-prem agent connectivity, writes back to the vault.

### Feature A — manual BOM sync (parity with `OnshapeSync.tsx`)

In the item BOM explorer (`apps/erp/app/modules/items/ui/Item/BoMExplorer.tsx`), when the `solidworks-pdm` integration is active, a `SolidWorksPdmSync` widget (clone of `OnshapeSync.tsx`) lets the user:

1. Search the vault for a file. `POST /api/{v}/search` returns only `[{ Id, Type }]` (research §7), so the loader hydrates the first 200 file-type ids via bulk `POST files/info`, filters to `.sldasm`/`.sldprt`, and returns at most 50 candidates. Pick one.
2. Pick a configuration (`GET files/{fileId}/{version}/configurations`, defaulting to the active configuration).
3. Fetch the **computed BOM** for that configuration at the latest checked-in version (`GET files/{fileId}/bominfo` → `GET bom/{bomTypeId}/{fileId}/{version}/{folderId}/computed?configId=`), normalized app-side into rows `{ partNumber, description, revision, quantity, unitOfMeasure, level, fileId, configId, folderId }` using the configured `partNumberVariable`/`revisionVariable` column names. The normalizer **rejects malformed responses before any sync**: exactly one case-insensitive column must match `partNumberVariable` (zero or multiple → error), the revision column must resolve, every quantity must be a finite non-negative number, and tree nesting must be consistent — a later validator cannot repair a wrong column pick or a mis-flattened tree. Preview the tree.
4. Sync: POST to `/api/integrations/solidworks-pdm/sync`, which invokes the `sync` edge function (`packages/database/supabase/functions/sync/index.ts`) with a new `type: "solidworks-pdm"` discriminated-union variant. The edge function reuses the existing tree-building logic (create/update `item` + `part`, build the `makeMethod`/`methodMaterial` tree) and writes `externalIntegrationMapping` rows: integration `"solidworks-pdm"` on the root item (`{ fileId, configId, folderId }`) and `"solidworksPdmData"` per item (raw normalized BOM row as metadata) — the same two-mapping pattern as `"onshape"`/`"onshapeData"`.

The widget stores/reads its saved file + configuration and `lastSyncedAt` from `externalIntegrationMapping`, exactly like `OnshapeSync.tsx` does.

### Feature B — release asset sync (parity with `onshape-revision-sync`/`onshape-backfill`)

Link-only: never creates items. Three triggers feed one per-company poll job, which fans out per file:

- **Cron** `solidworks-pdm-release-cron` (`{ cron: "*/30 * * * *" }`, pattern: `update-exchange-rates.ts`): iterates `companyIntegration` rows where `id = 'solidworks-pdm'`, `active = true`, and `metadata.assetSyncEnabled = true`, and sends one `carbon/solidworks-pdm-release-poll` event per company.
- **Webhook receiver** `apps/erp/app/routes/api+/webhook.solidworks-pdm.$companyId.ts` (pattern: `webhook.onshape.$companyId.ts`): accepts the PDM 2025+ `OnPostChangeState` webhook. Because payloads are unsigned, the payload is never trusted — a valid-looking event on an active, asset-sync-enabled company just triggers `carbon/solidworks-pdm-release-poll` (`mode: "incremental"`). Response contract (matches the Onshape receiver): unknown or inactive company → 400 "Integration not configured"; active + asset-sync-enabled company with a parseable JSON body → 200 (poll triggered); non-JSON body → 400.
- **Backfill action** — an `actions` entry on the integration config (`enabledWhenSetting: "assetSyncEnabled"`, pattern: Onshape's backfill) POSTs `/api/integrations/solidworks-pdm/backfill`, which triggers the poll with `mode: "backfill"` (ignores the cursor).

**Poll job** `solidworks-pdm-release-poll` (per company; concurrency key `companyId` limit 1; retries 10 like `onshape-backfill`):

1. Enumerate files **currently in** the configured released state. Default path (`metadata.searchCapability` unset or `"folder-sweep"`): recursive folder sweep (`folders/{id}/browse` + bulk `POST files/info`) filtered on current state. The search endpoint's workflow-state criteria (`"state-search"`) is an opt-in optimization used only when `metadata.searchCapability` is **explicitly** set to `"state-search"` after live-vault validation — never inferred at runtime, because its criteria syntax is undocumented and a silently-empty result would be indistinguishable from "nothing released" (research §8).
2. Dedupe against the `"solidworks-pdm-release-*"` mapping rows (written only by a *successful* file-sync, below): a candidate fans out only if no mapping already records its `{ fileId, version }`. There is **no modified-date cursor** — a release that doesn't bump the file's modified date is still caught, and a failed file-sync self-heals on the next sweep because its mapping row was never written. `metadata.lastReleaseSyncAt` is informational only (last completed sweep time), never a correctness gate.
3. For each new candidate, send `carbon/solidworks-pdm-file-sync` (concurrency key `fileId` limit 1; idempotency key `{companyId}:{fileId}:{version}`).

`mode: "backfill"` (the settings action) and `mode: "incremental"` (cron/webhook) run the same sweep — dedupe makes it idempotent; backfill exists as the manual "sweep now" trigger. This is **current-state synchronization, best-effort by design**: a file that is released and then transitions onward between sweeps is not seen (per-file transition history exists in the API but is prohibitively chatty to poll); the backfill action plus the next release of that file are the recovery paths, and the docs state this.

**File-sync job** `solidworks-pdm-file-sync` (per file; pattern: `onshape-revision-sync.ts` + `onshape-sync-element.ts` + `onshape-attach.ts`):

1. Resolve the active configuration id via `GET files/{fileId}/{version}/ActiveConfig`, then read the per-configuration data-card variables (`GET files/{fileId}/{version}/variables`) and select the `ConfigInfo` whose `ConfigurationId` matches; any variable missing there falls back to the `@` tab entry. Extract `partNumberVariable` and `revisionVariable`; the resolved `configId` is carried into the mapping metadata.
2. Match to a Carbon item on `readableIdWithRevision` using the same key convention as `onshape-matching.ts` (`releaseKey`); for drawings (`.slddrw`), also apply the shared-number-suffix heuristic (`sharedNumberSuffix`). No match → skip (logged, not an error).
3. Idempotency check, **keyed per file class** so a released part and its drawing (which match the same item) never clobber each other: integration `"solidworks-pdm-release-model"` (`.sldprt`/`.sldasm`) or `"solidworks-pdm-release-drawing"` (`.slddrw`), entityType `"item"` — the table's uniqueness is `(entityType, entityId, integration, companyId)`, so the two classes coexist as two rows. Skip when the incoming `version` is **≤** the recorded version (guards both replays and out-of-order polls overwriting newer state with older).
4. Attach (mirroring `onshape-attach.ts`):
   - `.sldprt`/`.sldasm`: co-located converted model — a file in the same folder with the same base name and `.step`/`.stp` extension (produced by the customer's PDM convert task, research §6) → download (size-capped like `downloadExternalDataToFile`) → `modelUpload` on the item → send `carbon/model-optimize`; API thumbnail (`GET files/{fileId}/{version}/thumbnails`) → `modelUpload.thumbnailPath`, with `carbon/model-thumbnail` as fallback.
   - `.slddrw`: co-located `.pdf` with the same base name → attach as item `document` (sourceDocument identifies SolidWorks PDM).
   - Native SOLIDWORKS files are **never** downloaded (Carbon can't render them; no translation API exists in PDM).
5. Upsert the class-specific `"solidworks-pdm-release-*"` mapping row with metadata `{ fileId, version, configId, fileName, stateName: releasedStateName }` plus `lastSyncedAt`/`remoteUpdatedAt` — `stateName` is what the UI status badge renders.

### Integration registration & settings

`packages/ee/src/solidworks-pdm/config.tsx` via `defineIntegration` (pattern: `onshape/config.tsx`):

- `id: "solidworks-pdm"`, `name: "SolidWorks PDM"`, `category: "CAD"`, inline SVG logo, `active: true` (no global env vars — credentials are wholly per-company, like the pre-OAuth Onshape model).
- Settings (groups **Connection** / **Release sync**):
  | name | type | required | default |
  |---|---|---|---|
  | `baseUrl` | text | yes | — (HTTPS enforced by zod; `http://` allowed only for `localhost`) |
  | `vaultName` | text | yes | — |
  | `username` | text | yes | — |
  | `password` | password | yes | — |
  | `releasedStateName` | text | no | `"Released"` |
  | `partNumberVariable` | text | no | `"Number"` |
  | `revisionVariable` | text | no | `"Revision"` |
  | `assetSyncEnabled` | switch | no | `false` |
- `actions`: the backfill button (above).
- Server hooks in `packages/ee/src/hooks.server.ts` registry:
  - `onInstall`: verify connectivity (authenticate + `GET api/{v}/info`); record `metadata.webApiVersion` (`GET api/version/webapi`); if `assetSyncEnabled` and version ≥ 2025, best-effort register the `OnPostChangeState` webhook at `/api/webhook/solidworks-pdm/{companyId}` (`POST configuration/hooks/url`) — failure logs and continues (polling covers it). Note: hook registration requires the PDM **"Can administrate add-ins"** permission on the service account, which Viewer/Contributor seats do not imply — the docs list it as an *optional* extra grant for webhook acceleration; vault data flow remains read-only PDM → Carbon regardless.
  - `onUninstall`: best-effort webhook deregistration.
  - `onHealthcheck`: authenticate + vault info (cached via the existing Redis health cache).

Metadata shape (validated by the new `integration.jsonschema` when `active = true`, enforced by the existing `verify_integration` trigger):

```jsonc
{
  "baseUrl": "https://pdm.example.com:65453",
  "vaultName": "Engineering",
  "username": "carbon-svc",
  "password": "…",
  "releasedStateName": "Released",
  "partNumberVariable": "Number",
  "revisionVariable": "Revision",
  "assetSyncEnabled": false,
  // written by the system, not the form:
  "webApiVersion": "2025",            // optional
  "searchCapability": "state-search", // optional
  "lastReleaseSyncAt": "2026-08-04T12:00:00.000Z" // optional
}
```

Keys are flat (not nested under `credentials`) because the generic `IntegrationForm` writes settings fields flat into metadata; the settings action's merge-don't-replace behavior (proven by the Onshape playbook) preserves system-written keys.

### Client

`packages/ee/src/solidworks-pdm/lib/client.ts` (pattern: `onshape/lib/client.ts`): `SolidWorksPdmClient` (axios, JWT held in-memory, single re-auth retry on 401), error types `SolidWorksPdmApiError` / `SolidWorksPdmAssetTooLargeError`, and factory `getSolidWorksPdmClient(client, companyId)` reading `companyIntegration` (returns `{ client, error }`, never throws). Methods: `authenticate`, `getWebApiVersion`, `getVaultInfo`, `search`, `getFilesInfo` (bulk POST), `getFileConfigurations`, `getActiveConfig`, `getFileVariables`, `getBomInfo`, `getComputedBom`, `browseFolder`, `getThumbnail` (follows the redirect; enforces the same `maxBytes` cap as downloads since the bytes are buffered), `downloadFileToTemp` (streamed, `maxBytes` cap), `registerWebhook`/`getWebhooks`/`deleteWebhook`. Exported from the `@carbon/ee` barrel as `SolidWorksPdm` + `SolidWorksPdmLogo`, client via subpath (mirroring `@carbon/ee/onshape`).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Connectivity | Cloud-direct to the customer-exposed PDM Web API over HTTPS | Mirrors the Onshape architecture the user asked for; zero installed software. The industry-standard on-prem COM agent (CADLink pattern, research §2) is a separate Windows-service product — deferred, and the client/matching/attach layers built here are reusable by it |
| Auth | Vault service-account username/password in `companyIntegration.metadata`; JWT fetched lazily, one re-auth retry on 401 | PDM Web API has no OAuth; token TTL is undocumented (research §1.2). Same storage pattern as every other Carbon integration's secrets |
| Release detection | Inngest cron poll every 30 min is ground truth; PDM 2025+ webhook only triggers an immediate poll | Webhooks are 2025+-only, unsigned, 15 s timeout, and unproven for desktop-originated transitions (research §4). Mapping-based dedupe + idempotent attach makes the poll safe to re-run regardless |
| Sync direction | PDM → Carbon only; Carbon never writes to the vault | Matches Onshape and the CAD→ERP release-push semantics every competitor connector implements (research §9) |
| Asset-sync matching | Data-card `partNumberVariable` + `revisionVariable` (active configuration) → `item.readableIdWithRevision`; link-only, never creates items | Exact mirror of Onshape feature B's contract (`onshape-matching.ts` `releaseKey`/`sharedNumberSuffix` reused) |
| Item creation | Only via manual BOM sync (feature A), through the existing `sync` edge function with a new union variant | Mirrors Onshape feature A; keeps privileged item/make-method creation in the one existing edge function |
| Models & drawings | Co-located convert-task outputs only (same folder + same base name: `.step`/`.stp`, `.pdf`); API thumbnail always; native SLDPRT/SLDASM/SLDDRW never downloaded | PDM has no translation API (unlike Onshape); release-time convert tasks are the universal PDM practice (research §6). Carbon's viewer/pipeline consumes STEP, not native SW |
| Configuration granularity | Active configuration only in v1 | Per-configuration item expansion (one SW file → N items) is a real PDM pattern but multiplies matching ambiguity; deferred with the mapping metadata (`configId`) already recorded to support it later |
| BOM type | Computed BOM at latest checked-in version, `configId`-scoped | Named-BOM support deferred; computed is always present and is what the `bominfo` → `computed` endpoints serve directly |
| PDM Standard | Unsupported | No Web API exists for Standard (research §1.1); only reachable via the deferred agent |
| Data model | No new tables — `integration` catalog seed row + `companyIntegration.metadata` + `externalIntegrationMapping` | The Onshape integration proves the existing plumbing suffices; keeps DB footprint to one idempotent seed migration |
| Idempotency | `externalIntegrationMapping` rows per file class (`"solidworks-pdm-release-model"` / `"-drawing"`) record last-synced `{fileId, version}` per item, with a version-≤ skip guard; mapping presence (not a date cursor) is what dedupes the poll | Makes sweeps re-runnable and self-healing (failed syncs retry next sweep), lets a part and its drawing coexist on one item, and blocks out-of-order overwrites; Onshape didn't need this (webhook-driven) but polling does |
| Heuristic 1 (multi-tenancy) | N/A — no new tables; every touched row (`companyIntegration`, `externalIntegrationMapping`, `document`, `modelUpload`) already carries `companyId` | Existing schema |
| Heuristic 2 (service shape) | `getSolidWorksPdmClient` returns `{ client, error }`; route loaders/actions use existing settings service fns (`getIntegration`, `upsertCompanyIntegration`) | Convention |
| Heuristic 3 (RLS) | N/A — no new tables | Existing policies cover all touched tables |
| Heuristic 4 (permissions) | Every new route copies the `requirePermissions` scope from its exact Onshape counterpart (settings/backfill: settings scopes; sync/pickers: parts scopes; webhook: public with per-company active-integration gate) | Onshape's scopes are the reviewed precedent |
| Heuristic 5 (forms) | Settings rendered by the generic `IntegrationForm` (ValidatedForm) from `settings[]` + zod `schema` — no custom form | Framework already does it |
| Heuristic 6 (module layout) | No new ERP module; integration code follows the per-integration directory convention in `packages/ee/src/solidworks-pdm/` | Convention (`packages/ee/src/onshape/` precedent) |
| Heuristic 7 (backward compat) | Additive only: new union variant in the `sync` edge function payload, new events, new catalog row. No existing contract changes | The `sync` function's discriminated union is designed for this |

## Data Model Changes

No new tables. One idempotent seed migration (created via `pnpm db:migrate:new solidworks-pdm-integration`, pattern: `20250410120243_onshape-integration.sql` + `20260703165330_onshape-asset-sync-jsonschema.sql`):

```sql
-- Seed the integration catalog row (idempotent; jsonschema validates metadata
-- via the existing verify_integration trigger when active = true)
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

(Verified: since `20241006185904_integration-refactor.sql` the `integration` table has exactly two columns, `id` and `jsonschema` — the INSERT above matches.)

`externalIntegrationMapping` gains rows with integration values `"solidworks-pdm"`, `"solidworksPdmData"`, `"solidworks-pdm-release-model"`, `"solidworks-pdm-release-drawing"` — the column is free TEXT; no migration needed.

## API / Service Changes

New files (all patterns are the Onshape counterparts):

- `packages/ee/src/solidworks-pdm/config.tsx` — `defineIntegration` config + logo.
- `packages/ee/src/solidworks-pdm/lib/client.ts` — client + factory (see above).
- `packages/ee/src/solidworks-pdm/lib/data.ts` — `solidWorksPdmDataValidator` (zod) for normalized BOM rows.
- `packages/ee/src/solidworks-pdm/hooks.server.ts` — `onInstall`/`onUninstall`/`onHealthcheck` + webhook register/deregister helpers.
- Registry edits: `packages/ee/src/index.ts` (add to `integrations` array + barrel exports), `packages/ee/src/hooks.server.ts` (server-hooks map).
- Routes under `apps/erp/app/routes/api+/`:
  - `integrations.solidworks-pdm.files.ts` (GET: vault file search for the picker)
  - `integrations.solidworks-pdm.files.$fileId.configurations.ts` (GET)
  - `integrations.solidworks-pdm.files.$fileId.bom.ts` (GET: normalized computed BOM)
  - `integrations.solidworks-pdm.sync.ts` (POST: invoke `sync` edge fn, write mappings)
  - `integrations.solidworks-pdm.backfill.ts` (POST: admin, gated on `assetSyncEnabled`, triggers backfill)
  - `webhook.solidworks-pdm.$companyId.ts` (POST: public receiver → poll trigger)
- Edge function: `packages/database/supabase/functions/sync/index.ts` — add the `type: "solidworks-pdm"` variant to `payloadValidator` and a handler that maps normalized rows into the existing item/make-method tree builder.
- Jobs (`packages/jobs/src/inngest/functions/integrations/`): `solidworks-pdm-release-cron.ts`, `solidworks-pdm-release-poll.ts`, `solidworks-pdm-file-sync.ts`, helpers `solidworks-pdm-matching.ts` (+ `.test.ts`) and `solidworks-pdm-attach.ts`; registered in `packages/jobs/src/inngest/index.ts`.
- Events: `carbon/solidworks-pdm-release-poll` and `carbon/solidworks-pdm-file-sync` in `packages/lib/src/events.ts` + `packages/lib/src/trigger.ts` (`taskToEvent`).
- Path helpers in `apps/erp/app/utils/path.ts` (`solidWorksPdmFiles`, `solidWorksPdmConfigurations`, `solidWorksPdmBom`, `solidWorksPdmSync`, `solidWorksPdmBackfill`).

## UI Changes

- `apps/erp/app/components/SolidWorksPdmSync.tsx` — clone of `apps/erp/app/components/OnshapeSync.tsx` (file search combobox → configuration combobox → BOM preview tree → Fetch/Sync/Save buttons).
- `apps/erp/app/modules/items/ui/Item/BoMExplorer.tsx` — mount `SolidWorksPdmSync` beside the existing `OnshapeSync` mount, each gated on its integration being active.
- Status badge: `apps/erp/app/components/Icons.tsx` gains `SolidWorksPdmStatus`, mirroring `OnshapeStatus`. Source of truth for its fields: `stateName` comes from the `"solidworks-pdm-release-*"` mapping metadata (the only producer that persists workflow state — see file-sync step 5); `revision` comes from the `solidworksPdmData` BOM-row metadata. When no release mapping exists yet, the badge shows revision only.
- Integration settings page needs **no custom UI** — the generic `IntegrationsList`/`IntegrationForm` renders the fields, groups, and backfill action from the config.

## Acceptance Criteria

- [ ] "SolidWorks PDM" appears in `/x/settings/integrations` with logo and description; Install opens the settings form with Connection + Release sync groups; submitting without `baseUrl`/`vaultName`/`username`/`password` shows field errors; an `http://` (non-localhost) `baseUrl` is rejected.
- [ ] With a fixture `companyIntegration` row (fake credentials, pattern: `.ai/playbooks/onshape-asset-sync.md`), the settings page renders all fields, the "Sync released assets" switch, and the backfill action button appears only when `assetSyncEnabled` is on; saving the form preserves `username`/`password` and system-written metadata keys (verified by SQL inspection of the merged metadata).
- [ ] `POST /api/integrations/solidworks-pdm/backfill` returns 200 and triggers the poll event when `assetSyncEnabled = true`; returns 400 when disabled.
- [ ] `POST /api/webhook/solidworks-pdm/{companyId}` returns 200 and triggers a poll for a `ChangeState`-shaped payload on an active company; returns 400 for an unknown company; never trusts payload contents (no attach happens without a poll).
- [ ] With the integration active, the SolidWorks PDM sync widget renders in the item BOM explorer; with it inactive, it does not.
- [ ] `solidworks-pdm-file-sync`, given a released `.sldprt` whose active-config part number + revision matches an item, attaches thumbnail + co-located STEP as `modelUpload` and sends `carbon/model-optimize`; a second run with the same `{fileId, version}` skips, and a run with an *older* version also skips (version-≤ guard). A released part and its drawing targeting the same item produce two coexisting mapping rows (`-model` / `-drawing`) without clobbering each other. Given a `.slddrw` with a co-located PDF, the PDF lands as an item document. No matching item → skip without error. (Proven by unit tests over the matching/attach decision logic; live-vault proof is flagged as environment-gated.)
- [ ] The BOM normalizer rejects malformed computed-BOM responses — zero or multiple part-number column matches, non-finite quantities, inconsistent nesting — with an error surfaced in the picker, and the sync edge function is never invoked with such data (unit-tested).
- [ ] `pnpm --filter @carbon/jobs test` passes with new `solidworks-pdm-matching.test.ts` covering: release-key matching, drawing shared-suffix matching, co-located-file basename convention, BOM row normalization, and idempotency skip.
- [ ] Scoped typechecks pass: `@carbon/ee`, `@carbon/jobs`, `erp`; the `sync` edge function's own-file deno errors do not increase.
- [ ] The `sync` edge function accepts a `type: "solidworks-pdm"` payload and produces the same item/make-method tree shape as an equivalent Onshape payload (unit-level or fixture-level proof).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Web API search may not filter by workflow state/date (docs don't say) | High | `folder-sweep` is the default and the only auto-selected path; `state-search` is opt-in per company (`searchCapability` set explicitly after live-vault validation), so an undocumented search quirk can never silently drop releases |
| Current-state polling misses a file that is released and transitions onward between sweeps | Low | Documented as best-effort current-state sync; per-file transition history is too chatty to poll; backfill + the file's next release are the recovery paths |
| No live vault available for development/verification | High | All matching/normalization/idempotency logic is pure and unit-tested; gating/settings/webhook paths verified via fixture rows (Onshape playbook pattern); live sync explicitly flagged environment-gated in the PR |
| JWT TTL undocumented | Low | Single re-auth retry on 401 built into the client |
| Customer exposes plain HTTP (PDM default is HTTP:65453) | Med | zod rejects non-HTTPS `baseUrl` (localhost exempt for dev); docs state the HTTPS requirement |
| Unsigned PDM webhooks could be spoofed | Med | Receiver treats payloads as poll-now hints only; all real data comes from authenticated API calls |
| Poll sweep cost on very large vaults (N+1: browse → info → variables, full sweep every cycle since dedupe is mapping-based) | Med | Bulk `POST files/info`, mapping dedupe keeps fan-out to new releases only, per-company concurrency 1, 30-min cadence; backfill retries 10 to ride out slowness |
| PDM license seat consumption by the service account is undocumented | Low | Documented prerequisite: one dedicated Viewer/Contributor seat; surfaced in the integration description/docs |
| Customer PDM version skew (webhooks 2025+, Web API maturity varies) | Low | `webApiVersion` capability flag; webhook registration best-effort; polling works on all Web-API-era versions |
| Plaintext service-account password in `companyIntegration.metadata` | Med | Same trust model as every existing integration's tokens (RLS-guarded settings scopes, JSON column); flagged for a future integration-wide secrets encryption pass |

## Open Questions

> All resolved autonomously per the combined spec+plan request (standing feedback: accept recommendations, document, surface for veto). Veto any of these and the affected sections revise.

- [x] **Architecture: cloud-direct Web API vs on-prem COM agent vs CADLink partnership?** Matters because it defines the supported customer set (Web API ⇒ PDM Professional 2022-ish+ with an internet-reachable IIS component) and the engineering shape. — **Autonomous:** cloud-direct Web API for v1: it mirrors the Onshape architecture (the explicit ask), needs no new product surface (no Windows installer), and its client/matching/attach layers are reusable by a future agent. The agent (research option 1/3) and a CADLink listing (option 4) are recorded as future work, not designed here.
- [x] **Scope: both Onshape-parity features, or asset sync only?** Matters for plan size. — **Autonomous:** both — "similarly to how we do the onshape integration" implies parity, and feature A reuses the existing `sync` edge function almost wholesale. The plan phases them (A before B) so either can ship alone.
- [x] **Release detection: webhook-first or poll-first, and at what cadence?** — **Autonomous:** poll-first (30-min cron), webhook as poll-now acceleration only, per the research's explicit warning that PDM 2025 webhook coverage of desktop transitions is unverified and payloads are unsigned.
- [x] **How do models/drawings reach Carbon given PDM has no translation API?** — **Autonomous:** rely on the customer's release-time convert tasks producing co-located `.step`/`.pdf` with the same base name (the universal PDM practice, research §6); sync the API thumbnail unconditionally. The convention is fixed in v1; making the location/naming configurable is future work.
- [x] **Per-configuration items: one SW file can hold N configurations with N part numbers — sync which?** — **Autonomous:** active configuration only in v1 (with `@`-tab fallback); `configId` is recorded in mappings so per-config expansion can be added without rework.
- [x] **Computed vs named BOM for feature A?** — **Autonomous:** computed only in v1 — always present, directly served by the API; named-BOM (the "BOM of record" pattern some customers use) is a documented fast-follow.
- [x] **Is PDM Standard supported?** — **Autonomous:** no — it has no Web API; only the deferred agent could serve it. Stated in the integration description.
- [x] **Where do vault credentials live?** — **Autonomous:** flat keys in `companyIntegration.metadata` validated by the catalog jsonschema — the established pattern for every integration's secrets (Onshape tokens live there today). The plaintext-at-rest concern is a pre-existing platform property, flagged in Risks rather than solved here.
- [x] **Should install auto-register the PDM webhook?** — **Autonomous:** best-effort on 2025+ vaults when asset sync is enabled (mirroring `ensureOnshapeReleaseWebhook`), non-fatal on failure since polling is authoritative.

## Changelog

- 2026-08-04: Created. Combined spec+plan request; all open questions resolved autonomously (recommendation-accepted mode) and listed above for veto. Research at `.ai/research/solidworks-pdm-integration.md`; plan at `.ai/plans/2026-08-04-solidworks-pdm-integration.md`.
- 2026-08-04: Revised per CodeRabbit review (PR #1331): poll dedupe is mapping-based (no modified-date cursor — releases without a modified-date bump are no longer missable, failed file-syncs self-heal); `folder-sweep` is the default discovery path with `state-search` strictly opt-in; release mappings split per file class (`-model`/`-drawing`) with a version-≤ skip guard; active-config resolution pinned to `GET /ActiveConfig` + `@`-tab fallback; picker hydrates search ids via bulk `files/info` with result caps; BOM normalizer must reject malformed responses pre-sync; `getThumbnail` gets the `maxBytes` cap; `SolidWorksPdmStatus` source of truth defined (`stateName` from release mappings); webhook registration privilege ("Can administrate add-ins") documented; webhook receiver response contract made explicit.
