---
paths:
  - packages/ee/src/mount/**
  - apps/erp/app/routes/api+/integrations.mount.*
  - packages/jobs/src/inngest/functions/integrations/mount-publish.ts
  - packages/jobs/src/inngest/functions/integrations/mount-sweep.ts
  - apps/erp/app/modules/settings/ui/Integrations/MountPublishStatus.tsx
---

# Mount Integration

## Overview

Mount is a quality management system. The integration pushes customers, suppliers and
parts from Carbon to one Mount tenant. It is one-way: Carbon is the master for every
field it sends, and no code reads a Mount value back (`lib/mappers.ts`).

The descriptor is `Mount` in `packages/ee/src/mount/config.tsx` (id `"mount"`, category
"Quality", `active: true`). It is registered in `packages/ee/src/index.ts` `integrations[]`.
The only server hook is `onHealthcheck: mountHealthcheck` (`packages/ee/src/hooks.server.ts`).
There is no OAuth popup, no webhook and no install hook. The user enters an API client's
credentials in the settings form.

There is no event subscription. A publish run is a sweep: it finds the stale records and
pushes them one at a time. A record that fails is still stale on the next run, so the
sweep is its own retry. There is no operation ledger, unlike the accounting sync.

## Key files

| File | Holds |
|---|---|
| `packages/ee/src/mount/config.tsx` | `MountSettingsSchema`, the settings, the 3 actions, `SetupInstructions` |
| `packages/ee/src/mount/lib/constants.ts` | `MOUNT_DEFAULT_BASE_URL` (`https://api.mount.cloud`), `MOUNT_API_VERSION` (`2026-06-01`), `MOUNT_INTEGRATION_ID`, `MOUNT_PUBLISH_ACTION_IDS`, `isHttpsUrl` |
| `packages/ee/src/mount/lib/client.ts` | `MountClient` (singleton via `getMountClient()`): token exchange, domain lookup, the REST calls, `healthcheck` |
| `packages/ee/src/mount/lib/source.ts` | `createMountPublishSource`: the Kysely queries that list stale records |
| `packages/ee/src/mount/lib/publish.ts` | `publishEntityType`, `MOUNT_PUBLISH_BATCH_SIZE` (200), `matchCompanyType`, `describeMountHas` |
| `packages/ee/src/mount/lib/push.ts` | `pushCompanyToMount`, `pushItemToMount`: match, create or update, then link |
| `packages/ee/src/mount/lib/mappers.ts` | `mapCustomerToMountCompany`, `mapSupplierToMountCompany`, `mapItemToMountObject`, `MissingIdentifierError` |
| `packages/ee/src/mount/lib/run.ts` | `runMountPublishBatch`, `markMountPublishFailed`, the settings resolution |
| `packages/ee/src/mount/lib/outcome.ts` | The run record rules: `startPublishRecord`, `applyBatchToRecord`, `isFinalBatch`, `failPublishRecord`, `publishNeedsAttention`, `describePublishForNotification`, `MOUNT_PUBLISH_MAX_BATCHES` (50) |
| `packages/ee/src/mount/lib/types.ts` | Zod schemas of Mount objects, `MOUNT_ENTITY_TYPES`, `MountPublishRecordSchema`, `parseMountPublishRecords`, `MountApiError`, `MountNotFoundError` |
| `packages/ee/src/mount/lib/errors.ts` | `toMountApiError`, `describeMountErrorBody`, `describeHealthcheckFailure` |
| `apps/erp/app/routes/api+/integrations.mount.publish.ts` | The Push action route |
| `packages/jobs/src/inngest/functions/integrations/mount-publish.ts` | `mountPublishFunction` (Inngest id `mount-publish`) |
| `packages/jobs/src/inngest/functions/integrations/mount-sweep.ts` | `mountSweepFunction` (Inngest id `mount-sweep`) |
| `apps/erp/app/modules/settings/ui/Integrations/MountPublishStatus.tsx` | `useMountActionStates`: button states, polling, toasts, the outcome detail |

Export subpaths (`packages/ee/package.json`): `@carbon/ee/mount` (client-safe:
constants, mappers, outcome, types), `@carbon/ee/mount.server` (everything) and
`@carbon/ee/mount/hooks.server`.

## Data flow

1. A user with `update: "settings"` presses **Push customers**, **Push suppliers** or
   **Push parts** on the Mount drawer. The button POSTs the action's `endpoint`
   (`/api/integrations/mount/publish?entityType=…`).
2. The route checks that the company's `mount` row is active. It mints a `requestId`
   (`nanoid`) and calls `trigger("mount-publish", { companyId, entityTypes, userId, requestId, trigger: "manual" })`.
   It returns the `requestId` to the page.
3. `mount-publish` (event `carbon/mount-publish`) runs one `step.run` per batch, named
   `publish-<entityType>-<batch>`. Each step calls `runMountPublishBatch`.
4. `runMountPublishBatch` reads the integration, writes a `running` record on the first
   batch, resolves the settings to Mount ids, and calls `publishEntityType`.
5. `publishEntityType` lists `limit + 1` stale records (`listStale`) and pushes the first
   200 serially. The extra record tells it whether `more` remain.
6. For each record, `pushCompanyToMount` / `pushItemToMount`:
   1. If a mapping exists, PATCH that Mount record. A 404 (`MountNotFoundError`) falls through.
   2. Find Mount records by `identifier`. More than 1 match returns `ambiguous` and pushes nothing.
   3. 1 match: PATCH it. 0 matches: POST a new record.
   4. Link the Carbon row through `createMappingService(db, companyId).link(...)`.
7. `isFinalBatch` stops the run when no records remain, after 50 batches, after a
   failure with `entityId: "*"`, or after a batch that published 0 records.
8. The job sends a `NotificationEvent.IntegrationSync` notice to the user who pressed
   Push, only when `publishNeedsAttention` is true. Scheduled runs notify nobody.
9. `useMountActionStates` polls the loader while a run is `running` and shows the outcome
   under each button.

`mount-sweep` (cron `30 2 * * *`, 02:30 UTC) sends one `carbon/mount-publish` per company
with an active Mount row, `trigger: "schedule"`, for all 3 entity types.

### What Carbon sends

| Carbon record | Mount object | Fields |
|---|---|---|
| `customer` + `customerTax` | `Companies` | `identifier` = `readableId`, `name`, `organizationNumber` = `taxId`, `vatNumber`, `website`, `typeId` |
| `supplier` + `supplierTax` | `Companies` | same as the customer |
| `item` with `type = 'Part'` that is in the `parts` view | `Objects` | `identifier` = `readableId`, `title` = `name`, `definitionId` |

A record is stale when it has no mapping, its `lastSyncedAt` is null, or `lastSyncedAt`
is older than the row's `updatedAt`. For customers and suppliers the tax row's
`updatedAt` counts too. `lastSyncedAt` is the time the batch started to read
(`readAt`), so an edit made during the batch is stale on the next run.

### The run record

Each entity type keeps one record at `companyIntegration.metadata.lastPublish.<entityType>`
(`MountPublishRecordSchema`): `status` (`running` / `completed` / `failed`), `trigger`,
`runId`, `requestId`, counts, `ambiguous`, `failed`, `warnings`, `error`, `more` and
`deferred`. `writePublishRecord` (`run.ts`) writes it through `patchIntegrationState`
with the dot-path key, so a settings save during a run is not lost.

`deferred` holds the ids that failed or were ambiguous. The next batch sorts them last,
so records that keep failing do not block the rest.

## Settings

`MountSettingsSchema` (`config.tsx`). Groups: "Connection" and "Mapping".

| Key | Label | Required | Notes |
|---|---|---|---|
| `clientId` | Client ID | yes | |
| `clientSecret` | Client secret | yes | Vaulted: `SECRET_KEYS.mount = ["clientSecret"]` (`packages/ee/src/integrations/secrets.ts`) |
| `tenant` | Tenant | yes | Sent as `X-Tenant` |
| `scope` | Domain | no | A domain id, identifier or title. Resolved to `X-Domain-Id` |
| `baseUrl` | API URL | no | Empty means `MOUNT_DEFAULT_BASE_URL`. Must be HTTPS |
| `partDefinitionSlug` | Part definition slug | yes | Default `parts` |
| `customerTypeTitle` | Customer company type | no | Empty means Mount's "Customer" type |
| `supplierTypeTitle` | Supplier company type | no | Empty means Mount's "Supplier" type |

`MOUNT_PUBLISH_ACTION_IDS`: `customer` → `push-customers`, `supplier` → `push-suppliers`,
`item` → `push-parts`. `mount` is in `FORM_SECRET_INTEGRATIONS`
(`apps/erp/app/routes/x+/settings+/integrations.$id.tsx`), so the save refuses an install
with no client secret. Once installed, the drawer collapses the settings under
"Integration credentials" and shows the Actions first (`collapseSettings`).

## Gotchas

- **Auth is OAuth client credentials.** `exchangeToken` POSTs `/auth/v2/token` with
  `grant_type=client_credentials` and `X-Tenant`. Each request sends the Bearer token,
  `Api-Version: 2026-06-01` and `X-Tenant`. The token is cached per company with a 60 s margin.
- **A 401 or a first 403 re-exchanges the token once.** Mount fixes a token's member when it
  issues it. A token from before an admin set the Member ID gets a 403 that a new token fixes.
- **`maxRedirects: 0`.** Every request carries the secret or a token, so the client follows no redirect.
- **An unmatched Domain fails every request.** Mount ignores an `X-Domain-Id` that is not an id,
  and then runs the request tenant-wide. `resolveDomainId` throws instead.
- **The health check always takes a new token** (`force: true`), then reads `/Companies?$top=1`.
  `describeHealthcheckFailure` names the fix for each step and status.
- **A missing part definition fails the run.** The code never creates a definition in the
  customer's tenant. The error lists the slugs Mount has.
- **A missing company type is a warning, not a failure.** The records go out with no type.
- **Settings resolve per batch, per entity type.** A parts push never fails on a company type lookup.
- **One Mount part per part number.** Each revision is its own `item`. The `parts` view
  picks one revision (released before draft, then newest). Item links set
  `allowDuplicateExternalId: true`, so a new released revision takes over the Mount record.
- **Every record publishes, active or not.** Nothing is ever deleted from Mount. Status is
  not mapped (see the PENDING DECISION comment in `mappers.ts`).
- **A record with no `readableId` fails** with `MissingIdentifierError`. The other records continue.
- **Mount has no idempotency key.** `mount-publish` has `concurrency: { key: "event.data.companyId", limit: 1 }`,
  so two runs never POST the same stale set. A sweep that lands on a manual run waits.
- **`onFailure` records the failure.** After 2 retries, `markMountPublishFailed` marks each
  entity type the run did not finish as `failed`. A manual run then notifies the user who pressed Push.
- **`constants.ts` has no imports on purpose.** `config.tsx` is client-bundled. Importing these
  values from `client.ts` pulled `@carbon/auth/client.server` into the browser and broke hydration.

## Never

- Never import `lib/client.ts` or any `*.server` module from `config.tsx`. Put shared values in `lib/constants.ts`.
- Never create a Mount object definition or company type from the push.
- Never delete Mount records from Carbon, and never read Mount values back into Carbon.
- Never replace `companyIntegration.metadata` to write the run record. Use `patchIntegrationState` with the `lastPublish.<entityType>` path.
- Never run two publish runs for one company at once.
- Never add a cron or caller that skips `mount-publish`. A cron is a second caller of the same job.

## Validation

```bash
pnpm --filter @carbon/ee test        # client, errors, outcome, publish, push tests
pnpm --filter @carbon/ee typecheck
pnpm --filter @carbon/jobs typecheck
```

There is no spec or plan for Mount in `.ai/`. The design lives in the code comments.
