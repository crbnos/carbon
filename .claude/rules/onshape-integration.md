---
paths:
  - packages/ee/src/onshape/**
  - packages/jobs/src/inngest/functions/integrations/onshape-*.ts
  - apps/erp/app/routes/api+/integrations.onshape.*.ts
  - apps/erp/app/routes/api+/webhook.onshape.$companyId.ts
  - apps/erp/app/components/Onshape*.tsx
  - apps/erp/app/hooks/useOnshapePipeline.ts
  - packages/database/supabase/functions/sync/index.ts
---

# Onshape Integration

One-way ingest from Onshape (CAD/PLM) into Carbon: released CAD models and
drawing PDFs onto items, released revisions into engineering data, and BOM
import. Nothing is ever pushed back to Onshape except translation (export) jobs
and webhook management.

**TWO pipelines ship side by side on ONE integration.** Which one a company runs
is `companyIntegration.metadata.pipeline`. They share the OAuth connection, the
webhook subscription and the settings form; exactly one of them consumes an
event. Existing companies have no `pipeline` key and are unaffected.

| | Legacy (default) | v2 (`pipeline: "next"`) |
|---|---|---|
| Join | `item.readableIdWithRevision === partNumber[.revision]` | `externalIntegrationMapping` rows keyed by Onshape ids |
| Surfaces | asset sync + backfill, release import, BOM sync panel | create part, link part, BOM import, release handling |
| Writer | `sync` edge function (synchronous) + three Inngest jobs | three Inngest jobs |
| Creates items? | BOM sync only | BOM import and the create route only |

## The `pipeline` key

- `parseOnshapeV2Settings` / `getOnshapeV2Settings` (`lib/settings.ts:70`, `:118`).
- **Strict equality against `"next"`** (`settings.ts:81-82`). An absent key, a
  null, a legacy row or a typo all resolve to `legacy` — legacy BY CONSTRUCTION,
  not by falling through to a default. Pinned by `settings.test.ts`.
- `isV2 = active && pipeline === "next"`, so the gate fails closed on an
  inactive or missing integration (`settings.ts:94`).
- `readFailed` is the third state: a QUERY ERROR, distinct from "absent" and from
  "legacy" (`settings.ts:129-133`). Every writer treats it as retryable — a
  transient database error must never masquerade as an opt-out and turn a real
  import into a silent no-op. Every v2 job throws on it; every v2 route answers
  "try again", never "v2 is not enabled".
- Every v2 job re-reads the gate on EVERY execution, outside its step, so
  switching a company back to legacy kills an in-flight retry.
- The browser copy is `useOnshapePipeline` (`apps/erp/app/hooks/useOnshapePipeline.ts`),
  same strict equality. Presentation only — it decides what renders, never
  whether a write is allowed.
- `x+/_layout.tsx:271-292` PROJECTS the integrations list before returning it:
  `{ id, active, companyId, updatedAt, updatedBy, metadata: { pipeline,
  allowUnreleasedSync } }`. The raw view returns `metadata` verbatim, which holds
  plaintext OAuth tokens and the webhook signing secret; returning it serialised
  every connected integration's credentials into the HTML of every authenticated
  page.

## The v2 identity model

An Onshape element/part id identifies a thing ACROSS all its revisions; a Carbon
`item` row IS one revision. That mismatch is the whole design.

- A **subassembly** is `(documentId, elementId)`.
- A **Part Studio part** is `(documentId, elementId, partId)` — one Part Studio
  element holds many bodies and each body is its own Carbon item, so the element
  alone does not address it (`lib/mapping.ts:38-53`). An element-level GLTF
  export returns every body in one file, which is why `partIds` exists on the
  exporter (`onshape-sync-element.ts:126`).
- `externalId` = `did:eid` or `did:eid:partId`, components `encodeURIComponent`d,
  positional and open-ended so a configuration component can be appended later
  (`buildElementExternalId`, `mapping.ts:72`; inverse at `:90`, returns null for
  anything malformed rather than half-matching).

### Two mapping rows, and what each is for

| `integration` | `externalId` | `allowDuplicateExternalId` | Answers | Rows per part |
|---|---|---|---|---|
| `onshapeElement` | `did:eid[:partId]` | **true** | which CAD thing this Carbon item is | one per Carbon revision |
| `onshapeRevision` | the Onshape `revisionId` | **false** | which Onshape release produced this item revision | one, enforced 1:1 |

Both are `entityType: "item"` on the one `externalIntegrationMapping` table
(`mapping.ts:30-36`). `UNIQUE (entityType, entityId, integration, companyId)` is
always enforced, which is why these are two `integration` values and not two
columns on one row.

**The invariant, stated plainly:**

- The element mapping is REVISION-AGNOSTIC. Resolving "which Carbon item is this
  Onshape thing" from it ALONE is a bug: the mapping narrows to the part FAMILY,
  and the row's own revision picks the member (`resolveBomRow`, `lib/bom.ts:347`).
  Observed live resolving a BOM line naming revision A to the item at revision C
  (`bom.ts:336-346`), and it is the same defect that would put revision A's
  geometry on revision C's item (`onshape-v2-assets.ts:3-8`).
- The inverse is equally a bug: treating two revisions of one part as a
  COLLISION. `EL-402.A` and `EL-402.C` both claiming one element is correct, not
  a conflict — the link route only refuses a competing claim at the SAME revision
  (`integrations.onshape.v2.link.ts:132-181`), and the create route distinguishes
  "this exact revision is already here" from "a different revision of this part
  is already here" (`v2.create.ts:137-178`).

Both mistakes were made repeatedly during the rebuild. Any new v2 code path that
maps an Onshape thing to a Carbon item must resolve in two steps.

### Data access (`lib/mapping.ts`)

- Reads: `readItemIdsForElement` (`:194`, returns MANY by design),
  `readItemIdForRevision` (`:221`, `.maybeSingle()`),
  `readElementMappingsForItems` (`:249`), `readItemIdsForElements` (`:436`).
  Both bulk readers chunk `.in()` at 200 — PostgREST builds it into the URL, and
  an unbounded list fails as a malformed request rather than as "too many ids".
- A read error THROWS (`mapping.ts:211`). Swallowed, it reads as "no mapping
  exists" and sends the caller down the create-a-new-item path, which is how v1
  built parallel item trees.
- `writeElementMapping` (`:303`) is delete-then-insert by `entityId` — the
  always-enforced UNIQUE means re-linking cannot be an upsert. Not atomic: a
  crash leaves the item UNLINKED, which is the safe direction (an absent mapping
  is recoverable; one pointing at the wrong element is not).
- `writeRevisionMapping` (`:358`) is UPDATE-then-insert, deliberately. An item
  already linked to an older release 23505s against ITSELF on a plain insert
  (reads as "another item claims this release"), and a delete-first can fail its
  own insert on the partial unique index and destroy the provenance it was
  rewriting. It returns `{ ok } | { ok: false, conflict, error }` — a real
  conflict means two Carbon items claim one Onshape release and is reported, not
  swallowed.
- `patchElementMappingMetadata` (service role) read-modify-writes `metadata` on an
  EXISTING element row, returning false when there is none. It cannot reuse
  `writeElementMapping`, which is delete-then-insert of the whole row and would
  reset `createdBy`/`createdAt`. Its merge (`mergeElementMappingMetadata`, pure
  and unit-pinned) is shallow except for `bomImport`: a patch naming `startedAt`
  REPLACES the marker (a new run must not inherit the previous outcome), a patch
  without one merges into it (the job stamping its own finish). The BOM-import
  marker is written by the dispatching ROUTE — `v2.create`'s import branch and
  `v2.import` — and closed by the job, which is safe because the job only ever
  rewrites element mappings for rows it ADOPTS or MINTS, never for the top-level
  item.
- Every WRITE takes the SERVICE ROLE, and the parameter is named `serviceRole` to
  make a wrong client obvious at the call site (see the RLS note below).

## Package (`@carbon/ee/onshape`)

One export subpath, `./onshape` → `src/onshape/lib/index.ts`
(`packages/ee/package.json:17`); it re-exports `bom`, `client`, `data`,
`document.type`, `element.type`, `legacy`, `mapping`, `reconcile`, `resolve`,
`settings`. `hooks.server.ts` is NOT in that barrel — it is re-exported from
`@carbon/ee/hooks.server` (`packages/ee/src/hooks.server.ts:19`).

- `config.tsx` — the `Onshape` descriptor via `defineIntegration` (id `onshape`,
  category `CAD`, `active: !!ONSHAPE_CLIENT_ID`). Setting groups (`:16`), eight
  settings (`:44`), the backfill action (`:208`), and `onClientInstall` (popup +
  `postMessage` `app_oauth_completed`, `:227`). The zod schema is NOT here — it
  is `onshapeSettingsSchema` in `lib/settings.ts:152`, so it can be unit-tested
  without the auth env `ONSHAPE_CLIENT_ID` drags in.
- `lib/client.ts` — `OnshapeClient` + `getOnshapeClient(client, companyId, userId)`
  (`client.ts:615`). All calls go to `https://cad.onshape.com/api/v10/...`.
  `OnshapeApiError` carries `status` + `retryAfterSeconds`;
  `OnshapeAssetTooLargeError` marks a permanently-unsyncable export.
- `lib/settings.ts` — the pipeline resolver. Pure half (`parseOnshapeV2Settings`)
  is unit-tested without a database, because the whole safety argument for
  shipping alongside rests on it returning `isV2: false` for every legacy-shaped
  row.
- `lib/mapping.ts` — the identity contract above. Pure half kept free of heavy
  imports (no auth/inngest/env at module load) so it stays testable.
- `lib/bom.ts` — Onshape BOM response → rows with their CAD identity intact, the
  tree builder, and `resolveBomRow`. Verified against a live response (RD-410,
  8 rows, 26 headers).
- `lib/reconcile.ts` — plans the change to one make method's material list.
- `lib/resolve.ts` — re-resolves a client-supplied selection against Onshape.
- `lib/legacy.ts` — counts items the legacy pipeline manages that v2 cannot see.
- `lib/data.ts` — `onShapeDataValidator`, the BOM-row array the sync edge
  function accepts (legacy only).
- `lib/element.type.ts` — `OnshapeElementType` (`ASSEMBLY`/`PARTSTUDIO`/`DRAWING`,
  the STRING enum used as a `getElements` query filter) and `OnshapeWVMType`
  (`w`/`v`/`m`). Not the same thing as the numeric `elementType` below.
- `hooks.server.ts` — webhook register/deregister/converge +
  `onshapeConnectionHasWriteScope`. Registered in the server-hooks registry with
  `onUninstall` only (`packages/ee/src/hooks.server.ts:49`).

Client methods worth knowing: `getCompanies` (`client.ts:181`),
`createWebhook`/`getWebhooks`/`deleteWebhook` (194/214/224),
`getVersions` (228), `getElements` (239), `getElementMetadata` (256),
`getBillOfMaterials` (273, indented + multiLevel + `generateIfAbsent`),
`getRevisions` (287, per part number + numeric elementType),
`getCompanyRevisions` (304) / `getCompanyRevisionsPage` (333),
`createPartStudioTranslation`/`createAssemblyTranslation`/`createDrawingTranslation`
(379/411/437), `getTranslation` (456), `downloadExternalData` (469),
`getElementThumbnail` (502), `downloadExternalDataToFile` (526),
`static refreshAccessToken` (583).

Only two export formats are accepted: GLTF for models, PDF for drawings
(`client.ts:40-41`). Mesh translations must send a `resolution` or Onshape fails
them. Every request carries a 60 s timeout (`client.ts:118`).

`getElementMetadata` (`client.ts:256`) exists because `getElements` returns only
the element's NAME. See the v2 elements route below.

## OAuth install / connect

- `integrations.onshape.install.ts` — builds the authorize URL. Scope is
  `OAuth2Read OAuth2Write`, joined with a literal `%20` OUTSIDE `URLSearchParams`
  (which would emit `+`) — `install.ts:30`. `state` is a fresh `crypto.randomUUID()`
  and is **not** verified on the callback beyond being present.
- `integrations.onshape.oauth.ts` — callback. Handles Onshape's `error` param
  before parsing for `code` (`oauth.ts:66`); `invalid_scope` maps to the
  `write-permission` error code. Failures redirect to the integrations page with
  `?integration=onshape&error=<code>`; the copy lives in
  `apps/erp/app/modules/settings/integration-errors.ts` (7 codes).
- Credentials land in `companyIntegration.metadata` (`oauth.ts:152-174`):
  `credentials { type: "oauth2", accessToken, refreshToken, expiresAt }`, plus
  `scope` and `baseUrl`. Later writes add `onshapeCompanyId`
  (`hooks.server.ts:55`) and the settings save adds the declared settings.
- **Tokens are stored unencrypted** — plain strings in a JSONB column. Same for
  `webhookSigningSecret`, which the setting's own description says out loud
  (`config.tsx:107`).
- **A reconnect MERGES rather than replaces.** `upsertCompanyIntegration` upserts
  the object it is handed (`settings.server.ts:264`), so the callback reads the
  existing row first and spreads it (`oauth.ts:139-156`). Before that, a
  reconnect wiped every saved setting — harmless-looking until the pipeline
  selector, where it would silently move a migrated company back to legacy. The
  settings save merges the same way (`{ ...existingMetadata, ...formData }`,
  `integrations.$id.tsx:1399`); that merge is SHALLOW, which is why clearing the
  signing-secret field stores `""` rather than removing the key.
- No webhook is registered on connect (`oauth.ts:176-181`) — every consumer is
  off by default, so there is nothing to subscribe for.
- `expiresAt` is always written as now + 3600 s, both at the callback
  (`oauth.ts:161`) and on refresh (`client.ts:666`), regardless of what Onshape
  returned.
- A connection authorized before `OAuth2Write` was requested holds a read-only
  token, and a refresh cannot widen it (the refresh grant sends no scope) — only a
  reconnect can. `onshapeConnectionHasWriteScope` reads the captured `scope` and
  treats a missing field (legacy installs) as read-only (`hooks.server.ts:78`).
  The settings save forces BOTH legacy toggles back off and tells the user to
  reconnect (`integrations.$id.tsx:1411-1419`, message at 1506).

## Settings — nine keys

Declared in `config.tsx:44-206`, validated by `onshapeSettingsSchema`
(`lib/settings.ts:152`). `SwitchField` posts the literal strings
`"true"`/`"false"`, so every switch uses an explicit `z.preprocess` —
`z.coerce.boolean()` would make `"false"` truthy.

**The form shows one pipeline's settings at a time.** `pipeline` is the only
ungrouped field and renders alone at the top; the Legacy pipeline group and the
Onshape v2 group are each hidden wholesale by the other's selection. Only
`webhookSigningSecret` is ungated — the receiver verifies the signature before
it branches on pipeline.

| Setting | Type / default | Group | Gates |
|---|---|---|---|
| `pipeline` | options, `"legacy"` | — | which implementation handles this company; `"next"` selects v2 |
| `assetSyncEnabled` | switch, `false` | Legacy pipeline | the `onshape-revision-sync` dispatch, the `onshape-backfill` job + route + the Backfill action's visibility (`config.tsx:221`) |
| `releaseImportEnabled` | switch, `false` | Legacy pipeline | the `onshape-release-import` dispatch and the job's own gate |
| `releaseImportMode` | options, `"changeNotice"` | Legacy pipeline | which branch legacy release import takes: `changeNotice` (reviewable) or `revision` (immediate) |
| `webhookSigningSecret` | text, `""` | Security | opt-in HMAC verification in the receiver; empty = verification skipped |
| `attachAssetsOnRelease` | switch, `true` | Onshape v2 | whether `onshape-release-v2` pulls the model on a release. It does NOT gate the BOM import or the create/link flows — those always pull, which is what the setting's own description promises |
| `releaseImportV2` | options, `"changeNotice"` | Onshape v2 | `off` / `changeNotice` / `revision` — what v2 does with the engineering data in a release |
| `allowUnreleasedSync` | switch, `false` | Onshape v2 | the unreleased picker, the v2 versions route, and the v2 BOM preview/import's released-only refusal |
| `createItemsOnRelease` | switch, `false` | Onshape v2 | whether a released element with NO linked Carbon item is created rather than refused. Read strictly `=== true` — copying `attachAssetsOnRelease`'s `!== false` would start minting parts for every existing v2 install on deploy |

- The three legacy keys are IGNORED while v2 is selected, and the group
  description says so (`config.tsx:18-21`). The webhook enforces it; the form
  now also hides them, so the two pipelines' settings can never be read as one
  list.
- `visibleWhen` takes ONE condition or an ARRAY of them, all of which must hold
  (`packages/ee/src/types.ts`). `IntegrationForm`'s `WhenVisible` evaluates one
  condition per component instance and recurses for the rest — `useControlField`
  is a hook, so one instance must read a fixed number of fields.
- Every gated field leads its `visibleWhen` with `pipeline`
  (`{ field: "pipeline", equals: "legacy" | "next" }`). No coercion is needed —
  an options field's control value IS the string. Leading with it is required,
  not stylistic: `ConditionalSettingsGroup` hides a group wholesale on the FIRST
  condition its settings share, so a different lead would leave a group header
  with nothing under it.
- `releaseImportMode` is the one field with two gates — the pipeline, then
  `{ field: "releaseImportEnabled", equals: "true" }`. The literal string
  `"true"` is correct because the comparison is against `String(controlValue)`
  and a switch's control value is a boolean. `releaseImportV2` needs no second
  gate: it is one field with an `off` option rather than a switch plus a nested
  mode.
- A `visibleWhen`-hidden field is unmounted and posts NOTHING, so every gated
  key is `.optional()`, NOT `.default()`. The save merges the parsed result over
  the stored metadata (`{ ...existingMetadata, ...d }`), so a default on a
  hidden key rewrites the OTHER pipeline's settings on every save — turning a
  legacy company's asset sync off the first time it saved on v2, and back on,
  unasked, on returning. Absent means "leave the stored value alone", and every
  reader already treats an absent key as its own default. Pinned by
  `lib/settings.test.ts`. `pipeline` is the one key that keeps a default: it is
  never hidden.
- The Backfill action carries the same `visibleWhen` shape (`config.tsx:221`),
  gated on legacy AND `assetSyncEnabled`. Gating on the setting alone would show
  it on a v2 company still carrying `assetSyncEnabled: true` from before the
  switch — and the route refuses a v2 company outright.
- `webhookSigningSecret` is declared `text`, NOT `password`/`secret`, matching the
  paperless-parts precedent. Both masked types render a `<Password>` input and
  nothing in `IntegrationForm` sets `autoComplete`, so a browser password manager
  silently autofills them — observed writing a saved password into this field on
  save, which would then make the receiver reject every genuine Onshape delivery.
  Masking buys little here (the value is plaintext JSON in the row either way);
  a silently wrong value costs webhook ingestion. Onshape's signing keys are
  company-level, not per-webhook.
- `parseOnshapeV2Settings` accepts booleans AND the form's `"true"`/`"false"`
  strings, and falls back to the DEFAULT for anything else — an unrecognised
  value must never silently enable a behaviour (`settings.ts:56-61`).

Migration `20260818094500_onshape-v2-jsonschema.sql` declares `pipeline`,
`attachAssetsOnRelease`, `releaseImportV2` and `allowUnreleasedSync` in the
`onshape` row of `integration.jsonschema`, which `verify_integration()` validates
`companyIntegration.metadata` against. It supersedes
`20260817155435_onshape-release-import-jsonschema.sql` (which superseded
`20260703165330_onshape-asset-sync-jsonschema.sql`). Data-only: `required` stays
`["baseUrl", "credentials"]`, every settings key is optional, no row is touched,
and an absent key is indistinguishable from the default at every read site.

## Webhook registration

`packages/ee/src/onshape/hooks.server.ts`. ONE subscription per Carbon company,
**company-scoped in Onshape** (`createWebhook` requires `companyId` or
`documentId`; Carbon always sends the Onshape company id — `client.ts:194-210`).

- Subscribed events: `["onshape.revision.created"]` only
  (`hooks.server.ts:132`). `collapseEvents` defaults to false.
- Callback URL: `${getAppUrl()}/api/webhook/onshape/${carbonCompanyId}`
  (`callbackPath`, `hooks.server.ts:8`).
- `alreadyRegistered` compares on the **path**, not the full URL —
  `webhook.url.includes(path)` (`hooks.server.ts:115`) — so a host change
  (localhost, a tunnel, prod) still resolves this company's webhook. Deregistration
  filters the same way and deletes every match.
- The Onshape company id comes from `metadata.onshapeCompanyId` when present, else
  `getCompanies()[0].id`, which is then persisted so the webhook and the jobs
  target the same Onshape tenant (`resolveAndStoreOnshapeCompanyId`,
  `hooks.server.ts:31`; the jobs' copy is `resolveOnshapeCompanyId`,
  `onshape-backfill.ts:131`).
- `ensureOnshapeReleaseWebhook(companyId, wanted)` (`hooks.server.ts:181`) is
  register-or-deregister, called ONLY from the integration settings save
  (`integrations.$id.tsx:1526`). **`wanted` is pipeline-aware**
  (`integrations.$id.tsx:1520-1525`): on v2 it is
  `attachAssetsOnRelease || releaseImportV2 !== "off"`, on legacy it is
  `assetSyncEnabled || releaseImportEnabled`. Reading only the legacy flags would
  DEREGISTER the subscription the moment someone switched to v2, silently, while
  the save flashed success. The subscription is shared, so it exists while ANY
  consumer is on and is deleted only when all are off. A failed registration
  while `wanted` is a hard, flashed error; the settings are already saved by then.
- `onshapeOnUninstall` deregisters on disconnect (`hooks.server.ts:192`).
- Neither function throws; both return `{ ok } | { ok: false, error }`.
- The background client is built for the integration's `updatedBy` (the installer),
  falling back to the string `"system"` (`hooks.server.ts:22`).

## Webhook receiver — `apps/erp/app/routes/api+/webhook.onshape.$companyId.ts`

`loader` answers a GET with `{ success: true }` for Onshape's endpoint validation
(line 112). The `action` control flow, in order:

1. `companyId` param present, else 400 (line 125).
2. `getIntegration(serviceRole, "onshape", companyId)` — 400 on query error,
   missing row, or `active !== true` (lines 130-155).
3. **Pipeline resolution** (line 169): `isV2 = metadata.pipeline === "next"`.
4. **Consumer gate** (lines 175-200), BEFORE the body is read, so a company that
   opted into nothing takes a byte-identical path to before any of this existed.
   - Legacy consumers are `!isV2 && …=== true`. On a v2 company they are DEAD
     whatever their stored values say — a company that migrated with them left on
     would otherwise have both pipelines act on one release, producing duplicate
     change notices and double the export calls.
   - v2 consumers are read only when `isV2`: `attachAssetsOnRelease !== false`
     (absent means on) and `releaseImportV2 !== "off"` (absent means
     `changeNotice`).
   - None enabled → log and ack `200`.
5. `rawBody = await request.text()` — read ONCE as text (line 206), because HMAC
   needs the exact bytes Onshape signed; re-serializing a parsed object would not
   reproduce them.
6. **Optional HMAC** (lines 212-231). `metadata.webhookSigningSecret` trimmed;
   empty/absent = skip and proceed (fail-open by design). When set,
   `verifyOnshapeSignature` (line 76) requires `x-onshape-webhook-timestamp`,
   rejects a non-finite one, rejects `|now - timestamp| > 5 min`
   (`SIGNATURE_MAX_AGE_MS`, line 63), computes
   `Base64(HMAC-SHA256(secret, "<timestamp>.<rawBody>"))`, and accepts EITHER
   `x-onshape-webhook-signature-primary` OR `-secondary` — Onshape rotates keys and
   sends both, so accepting either is what makes rotation zero-downtime. Failure
   is a `401`. `signaturesMatch` (line 66) length-checks before
   `crypto.timingSafeEqual`, which THROWS on a length mismatch — the same guard
   `webhook.xero.ts:75` still lacks.
7. `JSON.parse(rawBody)` — 400 on failure (line 235).
8. `onshapeWebhookEnvelope.safeParse` — 400 on failure (line 244). The envelope
   (lines 34-64) is `.passthrough()` on purpose so a new Onshape field never
   rejects a real event. `releaseId`, `releaseName` and `revision` already
   arrived and already survived passthrough — they were simply dropped at the
   destructure until they were added to it (lines 47-53, 262-264).
9. `switch (event)`:
   - `onshape.revision.created` (line 281): requires
     `integration.data.updatedBy` (the acting user — the webhook itself is
     unauthenticated) plus `messageId`, `partNumber`, `documentId`, `versionId`,
     `elementId` and a numeric `elementType`, else warn and break (lines 288-303).
     Then:
     - `assetSyncEnabled` → `trigger("onshape-revision-sync", …)` (line 304).
     - `isV2` → ONE `trigger("onshape-release-v2", …)` carrying
       `groupKey: releaseId ?? elementId` (lines 320-348), then **break** —
       exclusive, never falling through to the legacy dispatches. One job for the
       whole event because a separate asset job would race the import that
       creates the item it needs to attach to; the job owns the policy so the
       receiver stays a router.
     - `releaseImportEnabled` (legacy only) → `trigger("onshape-release-import", …)`
       (line 372), SKIPPING when `releaseId` is missing (line 354) and when
       `elementType === 2` (drawings, line 359).
   - `onshape.workflow.transition` (line 390): deliberately nothing. The wrapper
     event is thin (a release-package objectId + a transition name); the
     per-element `revision.created` events are what Carbon acts on.
   - default (line 395): ack, logged only — covers `webhook.register`, pings, and
     anything unhandled.
10. Always `{ success: true }` for a well-formed authorized event so Onshape does
    not retry-storm (line 402).

Routing, gating and signature behaviour are pinned by
`webhook.onshape.$companyId.test.ts`, including "dispatches ONLY the v2 job when
the company is on the v2 pipeline" and "is unaffected by a pipeline value that is
not exactly `next`".

## The Onshape jobs

Registered at `packages/jobs/src/inngest/functions/integrations/index.ts:9-13`
and in the functions array at `packages/jobs/src/inngest/index.ts:156-160`.
Events are declared in `packages/lib/src/events.ts:523-621`, task keys in
`packages/lib/src/trigger.ts:23-28`. All of them run on the service role
(`getCarbonServiceRole()`), so every query must carry `companyId` by hand.

| Job | Pipeline | Retries | Idempotency | Concurrency key |
|---|---|---|---|---|
| `onshape-backfill` | legacy | 10 | — | `event.data.companyId` |
| `onshape-revision-sync` | legacy | 3 | `event.data.messageId` | `event.data.elementId` |
| `onshape-release-import` | legacy (also called INLINE by v2) | 3 | `event.data.messageId` | `event.data.releaseId` |
| `onshape-release-v2` | v2 | 10 | `event.data.messageId` | `event.data.groupKey` |
| `onshape-bom-import` | v2 | 10 | — | `event.data.companyId` |
| `onshape-v2-item-assets` | v2 | 10 | — | `event.data.itemId` |

### `onshape-backfill` (`onshape-backfill.ts:431`)

- Gate: `isOnshapeAssetSyncEnabled` (line 112) — `active && assetSyncEnabled === true`
  — checked OUTSIDE any step so flipping the toggle off kills an in-flight retry
  (line 452). The route `integrations.onshape.backfill.ts` re-checks the same flag,
  and **refuses outright when `metadata.pipeline === "next"`** (`backfill.ts:35-47`):
  the backfill matches by `readableIdWithRevision`, which is exactly the
  part-number join v2 exists to replace, and would attach geometry to whichever
  revision happened to share a string.
- Onshape-driven and call-light: page the company's revisions, match locally, and
  spend export calls only on matches. Omit `after` for a full backfill; pass it for
  an incremental reconcile.
- Pagination follows Onshape's own `next` cursor, never an incremented offset —
  Onshape caps `offset` at 100 (`client.ts:333`, used at `onshape-backfill.ts:212`).
  `page.next` is authoritative for "more pages exist".
- `isObsolete` revisions are dropped (line 224).
- Resolution: models by one `.in("readableIdWithRevision", modelKeys)` query per
  page (line 260); drawings per row by shared-number ILIKE (line 282). Already-synced
  work is skipped without an Onshape call — models on `item.modelUploadId`, drawings
  on `itemHasPdfDocument` (line 170).
- Step granularity: one fast memoized step per page match, then ONE step per matched
  export+attach (`sync-page-N-item-M`). An `OnshapeAssetTooLargeError` returns
  `skippedTooLarge` instead of throwing (line 411). Five consecutive step failures
  abort the run (`MAX_CONSECUTIVE_FAILURES`, line 79).
- Fires `carbon/model-optimize` for every attached model and `carbon/model-thumbnail`
  only when the Onshape-rendered thumbnail did not stick.

### `onshape-revision-sync` (`onshape-revision-sync.ts:265`)

- Same `isOnshapeAssetSyncEnabled` gate, outside the step (line 281).
- LINK-ONLY: attaches to an item that already exists, never creates one.
- Resolution: the webhook gives a `revisionId`, not the revision LETTER, so the
  letter is re-resolved from `getRevisions(onshapeCompanyId, partNumber, elementType)`
  preferring the entry matching this event's `versionId` AND `elementId`, falling
  back to `versionId` alone (lines 90-104). Then
  `item.readableIdWithRevision === releaseKey(partNumber, revision)`
  (`.maybeSingle()`, line 193).
- Skip reasons: `unknown-element`, `no-matching-item`, `ambiguous-item`,
  `revision-not-found`, `asset-too-large` (permanent — a retry cannot shrink an
  export).
- The whole body is wrapped in `withRateLimitRetry`, which converts a 429 into an
  Inngest `RetryAfterError` honoring `Retry-After` (default 60 s, clamped to 300 s)
  — Inngest suspends the run instead of blocking the step
  (`onshape-backfill.ts:87`).
- The payload schema (line 252) does NOT include `releaseId`/`revision`, so zod
  strips the two extra fields the receiver sends.

### `onshape-release-import` (`onshape-release-import.ts:858`)

The Inngest function is a thin wrapper; the work is `runOnshapeReleaseImport`
(line 406), which the v2 release job calls DIRECTLY.

- Gate: `getOnshapeReleaseImportSettings` (line 128) — `active && releaseImportEnabled === true`;
  mode is `"revision"` only on that exact string, anything else falls back to
  `changeNotice`. **A caller may pass `gate` instead** (line 403), which replaces
  the settings read entirely. v2 does: a v2 company necessarily has the legacy
  keys off, so without the override the v2 release import would refuse itself as
  `disabled`.
- Skip reasons (line 51): `disabled`, `drawing-element`, `revision-not-found`,
  `no-matching-item`, `revision-already-imported`, `no-dispatcher`.
- Resolution (`resolveReleaseTarget`, line 211) queries the `item` siblings of one
  `readableId` and hands them to `selectReleaseTarget` (`onshape-matching.ts:74`),
  a pure helper so the edge cases are unit-pinned:
  - already-imported spans **every** sibling, active or not — an inactive draft
    revision still occupies `item_unique (readableId, revision, companyId, type)`,
    so ignoring it turns a re-release into a 23505 that rolls back the affected
    row and leaves an empty notice;
  - the SOURCE must be ACTIVE — an inactive sibling is a draft revision owned by
    an open notice, and the affected-item picker filters inactive items out
    entirely, so a human could not build on one either;
  - ordering prefers NAMED revisions over the initial `''`/`'0'`, newest
    `createdAt` first — the same preference as the `latest_items` CTE and the
    legacy BOM route's fallback.
- The family it resolves is `carbonReadableId ?? partNumber` (line 432). Legacy
  passes neither and joins by number; v2 passes CARBON's readableId for the family
  while `partNumber` stays ONSHAPE's, because that is what
  `/revisions/companies/{id}/partnumber/{n}` is asked about.
- The revision LETTER and the Onshape-side NAME come from `getRevisions`
  (`resolveReleasedRevision`, line 253); on any non-rate-limit failure it falls
  back to the letter from the webhook and imports without the name. A
  `RetryAfterError` is rethrown so a rate limit stays a rate limit.
- A part number Carbon has never seen is SKIPPED as `no-matching-item`, not minted
  (line 436). Minting would land it with Carbon defaults (Inventory / Make) and
  poison MRP for purchased leaf parts. Creating parts is the BOM import's and the
  v2 create route's job.

**`revision` mode** (line 473): one `items_createRevision` with the Onshape letter,
`active: true`, no change notice. Additive, writes no supersession, reversible by
deactivating the item — which is why it, and not an auto-applied change notice, is
the "no review" option (`applyChangeNotice` drives four transitions to a terminal
`Done`, is not one transaction, and `itemSupersession`'s PK is `("itemId")` alone,
so a second release on the same predecessor would overwrite the first's successor
pointer — lines 31-36).

**`changeNotice` mode** (line 522): one Draft change notice per Onshape release, one
affected item per released element, change type `Revision`, carrying Onshape's
letter. A human drives the normal Draft → Start → Engineering Complete →
Implementation → Done flow. The notice gets `assignee = payload.userId` (the
installer) because a Draft notifies nobody — only Start/Implementation/Done have
notification events. `reasonForChange` carries release provenance as tiptap JSON
(`onshapeProvenance`, line 720) — it is a rich-text column, so a plain string
would not render.

**Grouping.** There is NO release-level Onshape event: a 9-element release arrives
as 9 separate `onshape.revision.created` deliveries in nondeterministic order with
no "release complete" signal. So `releaseId` is the grouping key and a marker row
in `externalIntegrationMapping` is the CLAIM: the first element to insert it creates
the notice; every sibling reads it and appends to the notice it names. Serialization
comes from the concurrency key (`releaseId` on the legacy job, `groupKey` on the v2
one). **No new table, no schema change.** The claim is inserted IMMEDIATELY after
the notice, before any affected item, so a mid-run death retries into the existing
notice (line 576); a `23505` on the claim means a sibling won, and the loser
re-reads and adopts that notice (lines 598-617).

**Two error layers.** `unwrapDispatch` (line 110): `result.success` only says the
dispatch worked; the Supabase envelope inside carries its own error. Treating a
failed write as success would poison the release's marker so it could never be
retried.

**Same-part parallel notices are PERMITTED**, matching the UI — the one-open-CO-per-part
guard was dropped (`apps/erp/app/modules/items/AGENTS.md:89`). The UI also WARNS via
`ItemOpenChangeNoticeAlert`, so the job records prior open notices in
`metadata.openNoticeCollisions` (`findOpenNoticesForItem`, line 160;
`recordMarkerProgress`, line 775). That lookup queries notice STATUS, not
`item.active + changeOrderId` — `changeOrderId` survives release permanently and
cancelling a notice is a bare status flip, so the item-row shape would report
cancelled and released notices as in-flight forever.

### `onshape-release-v2` (`onshape-release-v2.ts:67`)

The whole `onshape.revision.created` event for a v2 company: attach the released
geometry, and bring the release into engineering data when configured to. Doing
both here, in order, is the point — for a NEW revision the target item does not
exist until the import creates it, so a parallel asset job resolves
`revision-missing` and the model never lands.

- Gate: `getOnshapeV2Settings`; `readFailed` throws, `!isV2` returns
  `{ skipped: true, reason: "pipeline-not-v2" }` (lines 89-97).
- `elementType === 2` returns `drawing-element` (line 105). v1 attaches a
  drawing's PDF by stripping the number to a shared suffix, which is disproved on
  real data — RD-410, DRW-410 and PK-410 all reduce to `-410`, matching five items
  across two parts. Until a mapping-based mechanism exists, v2 refuses rather than
  guessing which item the PDF belongs to.
- An empty `revision` returns `revision-missing-from-event` (line 116). A release
  ALWAYS names a revision; treating an empty one as the initial revision would
  resolve the family to its revision-`0` member and stamp released geometry onto
  the item that predates every release.
- **Part Studio fan-out** (lines 143-160). The webhook payload has no `partId`
  field and one Part Studio hides N bodies behind one element id, so the partIds
  are recovered from `getRevisions` by matching `elementId` + the released
  revision. No match falls back to `[null]`, i.e. an assembly element.
- Per partId: `readItemIdsForElement` → drop claimants whose `item` row did not
  come back (no FK, so a deleted item leaves its mapping behind) → `resolveBomRow`
  against the released revision. A match is the target.
- No target and `releaseImportV2 !== "off"` → delegate to
  `runOnshapeReleaseImport` with `gate: { enabled: true, mode }` (lines 245-279).
  The family's `readableId` is derived from the mapped items and must be
  unanimous; two different numbers behind one element is reported as ambiguous
  rather than resolved by whichever row came back first.
- After an import, the created item is RE-RESOLVED and then LINKED —
  `writeElementMapping` plus `writeRevisionMapping` (lines 290-325). Without the
  re-resolve the attach never runs, and `items_createRevision` copies the source
  revision's `modelUploadId` and `thumbnailPath`, so the new revision would not
  merely lack geometry: it would silently display the PREVIOUS revision's,
  presented as the released one. Without the link, v2 stays blind to what it just
  created.
- v2 mints a part from a release ONLY when `createItemsOnRelease` is on.
  Off (the default) keeps the reported skip, "No Carbon item is linked to this
  Onshape part". On, the job:
  - probes the readableId FAMILY first and refuses if the number is taken by an
    unmapped item. `claimants.length === 0` means no MAPPING exists, not that
    the number is free — every item the LEGACY pipeline created is exactly that,
    and `item_unique` is on the RAW revision column with NULL distinct, so
    inserting `'A'` against an existing `''`/NULL row raises no conflict and
    produces a second family member with no lineage;
  - takes its replenishment from `resolveOnshapeReplenishment`
    (`onshape-replenishment.ts`) — see below — plus Inventory tracking and EA;
  - inserts `item` directly and then the MANDATORY `part` row (the `parts` view
    inner-joins it, so an item without one is invisible), writes both mappings,
    and lets the normal provenance + asset flow run on the new item;
  - NEVER routes a fresh mint through `runOnshapeReleaseImport` — a creation is
    not a change;
  - reports every creation in the notification, naming what was assumed. An
    assembly minted Make arrives with an empty Draft make method, so planning
    briefly sees something buildable out of nothing; the release path carries
    geometry, not structure, and reporting is the mitigation rather than a
    cleverer guess.
- Assets run last, gated on `attachAssetsOnRelease`, through
  `pullOnshapeAssetsForElement` inside `withRateLimitRetry`, each attach followed
  by `trigger("model-optimize", …)`.
- Refusals are NOTIFIED (lines 403-422): a release is webhook-driven, so a skip
  recorded only in the Inngest return value reaches nobody, and the user finds out
  when a revision turns out to have no model and no change notice.

### `onshape-bom-import` (`onshape-bom-import.ts:383`)

User-initiated from a specific make method. Replaces the legacy `sync` edge
function path, which was synchronously awaited by the request, could not retry,
could not report progress, and left a half-written item tree with nothing to
resume from.

What it deliberately does NOT do: match on part numbers; delete-and-rebuild a
material list; create a revision of an existing part.

- Concurrency is per COMPANY, not per make method: the walk recurses into child
  methods, so two imports of different assemblies sharing a subassembly would each
  reconcile that child against a list the other is changing, and `methodMaterial`
  has no unique constraint on `(makeMethodId, itemId)` to catch the duplicate. It
  also serializes `getOnshapeClient`'s read-modify-write token refresh.
- `assertWritableMethod` (line 77): Draft only, never one owned by an open change
  notice, and — under `plmReleaseControl = "enforce"` — never one whose item is at
  `revisionStatus: "Production"`. That last check is `checkRevisionLock`
  replicated (jobs cannot import `~/modules`), and it closes a real escape hatch:
  creating a new method version is NOT lock-gated, so a user refused at the UI
  could mint a Draft on a Production item and have Onshape write the BOM the UI
  would not let them touch a line of. Re-checked per subassembly during the walk
  (lines 989-1000).
- Refuses an UNRELEASED version unless `allowUnreleasedSync`, tested on the
  ASSEMBLY's own row, never on its children (line 478). A child row's Revision
  cell is that COMPONENT's revision, and standard content or a purchased part
  legitimately has none while the assembly is released — testing the children
  would abort an ordinary released import after the route already answered
  "Import started". An unreadable top-level row counts as UNRELEASED: Onshape
  requires a part number to release, so refusing on null cannot block a released
  import.
- Resolution per row: `readItemIdsForElements` for the whole tree in one query,
  then `resolveBomRow` by revision, then the family probe by number.
  - `matched` → use it.
  - `ambiguous` / `revision-missing` → REFUSED, and every candidate item id is
    recorded as PROTECTED for that row.
  - `unmapped` but the NUMBER is taken at the same revision → `adoptExistingItem`
    (line 154) links it, unless several items share the number and revision or the
    item already belongs to a DIFFERENT Onshape element. Refusing that second case
    matters: `writeElementMapping` deletes by `entityId` alone, so adopting would
    destroy the other link and silently re-point the item — a part-number string
    match deciding an identity join.
  - `unmapped` and the number exists at OTHER revisions only → refused. Minting
    would add a family member with no revision lineage.
  - genuinely unknown → minted, then `part` upserted, then linked, then fed back
    into the in-memory index (line 879) so a part used under two subassemblies
    does not try to mint twice and land in only one parent's BOM.
  - A `23505` on the mint re-runs the family probe, so a retry after a partial
    mint is self-healing rather than permanently poisoned.
- **Replenishment on a MINTED row is decided by whether the row has CHILDREN**
  (lines 757-765), derived from the tree rather than from "the next row is
  deeper", so a row whose only apparent child was dropped as an orphan counts as a
  leaf:
  - children → `replenishmentSystem: "Make"`, `defaultMethodType: "Make to Order"`.
  - leaf → `replenishmentSystem: "Buy"`, `defaultMethodType: "Pull from Inventory"`.

  This is not a guess. `methodMaterial.methodType` is DENORMALIZED from the
  component's `defaultMethodType` (line 345), so minting a subassembly as Buy
  makes the PARENT's line read "Pull from Inventory" and the nested BOM never
  explodes — the sub-tree would exist and never plan, while MRP raised a purchase
  order for something Carbon knows how to build. Everything else takes Carbon's
  own defaults (`itemTrackingType: "Inventory"`, `unitOfMeasureCode: "EA"`),
  because Onshape's BOM says nothing reliable about them.
- An **EXISTING** item that this import gives children to but which Carbon still
  calls Buy is REPORTED as a warning, never overwritten (lines 983-987).
  Replenishment is a Carbon decision Onshape says nothing about; left silent it is
  invisible and expensive.
- Reconciliation per level via `reconcileMethodMaterials` (`lib/reconcile.ts:76`),
  keyed on the component `itemId` — the only stable join, since `methodMaterial`
  has no Onshape back-pointer and Onshape's row ids are scoped to one response.
  Only `quantity` and `order` are written. `methodOperationId`, `scrapQuantity`,
  `kit`, `sourcingType`, `storageUnitIds`, `tags` and the row's
  `methodMaterialStep` children survive because they are never named. The legacy
  writer deletes every row and re-inserts, which is why "keep the BOP" is
  impossible there.
  - `protectedItemIds` keeps a refused row's existing line: absent from `desired`,
    it would otherwise read as "Onshape dropped this" and be DELETED, which is the
    opposite of what the user was told. Protection is scoped PER ROW, not one flat
    set — a flat set would protect the component everywhere, so a part refused
    under assembly A would also survive under assembly B where Onshape really did
    drop it.
  - `allowRemoval` is false whenever ANY row was unreadable (line 930). A Carbon
    line whose row vanished is then indistinguishable from one Onshape genuinely
    dropped, and deleting on that basis destroys a line — with its routing link,
    scrap and step children — on the strength of a row we admit we could not read.
- New `methodMaterial` rows carry `unitOfMeasureCode` from the COMPONENT ITEM
  (NOT NULL, and Onshape's "Unit of measure" column describes the CAD quantity,
  not Carbon's stocking unit), plus `itemType` and `methodType` denormalized from
  the component.
- Recursion only into children that resolved to a Carbon item AND have children of
  their own. A childless row is a leaf regardless of how Carbon classifies the
  item — the legacy writer resolves a child method whenever the item is Make,
  which empties a hand-built BOM on a part Onshape reports as a leaf.
- The TOP-LEVEL item's own model is pulled explicitly (line 1022): Onshape returns
  the queried assembly separately from its components, so without this the one
  item the user is looking at is the only one in the tree with no geometry.
- A `Make to Order` line must ALSO carry `materialMakeMethodId`, and the import
  sets it to the method it reconciled the children into. `get_method_tree`
  resolves a line's sub-method as `COALESCE("materialMakeMethodId", CASE WHEN
  "methodType" = 'Pull from Inventory' THEN <activeMakeMethods lookup> END)` —
  the fallback fires ONLY for `Pull from Inventory`, so a `Make to Order` line
  with a null column TERMINATES the recursion and the whole sub-BOM disappears
  from the BoM explorer, the BOM API, the CSV export and cost roll-up while
  still sitting in the database. The app's own `upsertMethodMaterial` resolves
  it from `activeMakeMethods`; the import uses the method it actually wrote to,
  which differs for an adopted item whose Active method is not the draft being
  imported into.
- Assets run LAST and ALWAYS — deliberately not gated on `attachAssetsOnRelease`,
  which is about releases that happen with nobody in Carbon. Someone who asked to
  import a bill of materials wants the geometry with it, so assets are not a
  switch of their own on this path. Grouped by element, each attach followed by
  `trigger("model-optimize", …)`. A transient failure or a `RetryAfterError` is
  rethrown; a PERMANENT one is reported so geometry cannot cost the user the BOM.

### The BOM import outcome

`OnshapeBomImportOutcome` (`onshape-bom-outcome.ts:7`) — kept out of the job
module because importing that boots the Inngest client, which requires signing
keys.

| Field | Meaning |
|---|---|
| `imported` | lines written across every level |
| `created` | parts minted |
| `adopted` | existing parts LINKED rather than created |
| `updated` / `removed` | material lines changed / deleted |
| `assetsAttached` / `assetsSkipped` | models attached / not |
| `unreadableRows` | `parsed.skipped + parsed.orphaned` |
| `protectedLines` | existing lines left untouched because their row was refused |
| `skipped[]` | `{ partNumber, revision, reason }` per refused row |
| `warnings[]` | things the import DID that a person still needs to know |

`warnings` is distinct from `skipped` on purpose: nothing was refused, so counting
these as refusals would misreport a successful import. The Buy-subassembly warning
is the current occupant.

`summarizeOutcomeForUser` (`:40`) names the parts rather than counting them, and
GROUPS by reason — one assembly refused for one cause produces the same sentence
per row, and eight copies of it is a wall the reader skims past. Capped at
`MAX_LISTED_SKIPS = 5` names per reason, remainder as a count. Unit-tested in
`onshape-bom-summary.test.ts`.

**The notification** (`onshape-bom-import.ts:1115-1141`) fires when
`countNeedingAttention(outcome) > 0` (`onshape-bom-outcome.ts:39` — refusals plus
unreadable rows plus protected lines plus warnings), and only for a real user
(`userId !== "system"`). ONE helper feeds both the gate and the title: deriving
them separately is how the title came to say "0 item(s) needing attention" on a
notification that only fired because a row could not be read. A clean
import is already visible — the BOM the user is looking at changes. Without it the
outcome dies in the job log: the panel toasts "Import started" and a refused row is
indistinguishable from one that imported cleanly. It uses
`NotificationEvent.IntegrationSync` with `documentId: "onshape"`, which is IN-APP
ONLY (`notify.ts:194`) and takes its title and body from the payload
(`content.ts:1197`); the in-app row links to `path.to.integration(id)`. The
"Accounting sync needs attention" string is only that event's FALLBACK title —
still the reason the release import notifies via the change notice's `assignee`
instead of sending one of these.

### `onshape-v2-item-assets` (`onshape-v2-item-assets.ts:33`)

Pulls the model for ONE already-linked item. The create and link routes queue it;
without it an item created from a released revision arrives with no geometry while
the same part imported through a BOM arrives with it — same pipeline, two results,
decided by which button was pressed. A job rather than inline work because an
export is a translate-poll-download round trip: minutes in the worst case, and
rate-limitable.

### Shared v2 asset machinery

`onshape-v2-assets.ts` never answers "which Carbon item is this" — callers resolve
and hand it an `itemId`.

- `pullOnshapeAssetsForElement` (`:83`) exports and attaches in ONE call: a local
  export file cannot cross an Inngest step boundary, since each `step.run` is a
  separate HTTP invocation. It owns its scratch directory and removes it in a
  `finally`.
- One `getElementThumbnail` render per element, reused by every body in it — and
  applied ONLY when `partId === null` (`:154`). `getElementThumbnail` takes no
  partId, so stamping it on a per-body item shows the whole studio as the picture
  of one part: the same lie `partIds` exists to stop, reintroduced as the image. A
  body gets its thumbnail from its own GLB via the `model-optimize` chain.
- `assetBaseName` must be STABLE across runs — `attachOnshapeAssetsToItem` uses the
  model FILENAME as its idempotency key, so a varying base mints a new
  `modelUpload` every run and files the previous model away as a document. Callers
  pass `readableIdWithRevision`-shaped names, and an Onshape revision of `"0"`
  counts as unnamed (`isInitialRevisionLabel`).
- `isTransientExportError` (`:66`): 429, a 5xx, or a status-less `OnshapeApiError`
  (the client's 60 s timeout) is worth another attempt and must ESCAPE — the
  callers wrap this in `withRateLimitRetry` precisely so a 429 becomes a
  `RetryAfterError`. `OnshapeAssetTooLargeError` and any other 4xx are permanent,
  per-target skips: one unexportable body must not cost the other six their models.
- `groupAssetTargetsByElement` (`:204`) keys on
  `documentId:versionId:elementId:configuration` — two configurations of one
  element are two groups, because the configuration is part of the identity of what
  gets exported.
- `exportOnshapeModelToDisk` (`onshape-sync-element.ts:126`) is the shared
  exporter, taking `partIds` and `configuration`. Legacy callers omit both, so
  their behaviour is unchanged. Omitting `configuration` exports the element's
  DEFAULT, which for a configured part is a different shape from the one the BOM
  line names.
- `attachOnshapeAssetsToItem` (`onshape-attach.ts:184`) now writes
  `item.modelUploadId` as a COMPARE-AND-SET on the `priorModelId` this run read
  (`:388-409`), and throws when it matches zero rows. An unconditional update let a
  concurrent attach lose its model to an orphaned row. `eq(column, "")` does NOT
  match SQL NULL, so the no-prior-model case uses `.is(…, null)`.

## The v2 routes

All under `apps/erp/app/routes/api+/integrations.onshape.v2.*.ts`, paths in
`utils/path.ts:189-195`. Shared shape:

- Permission is on **parts**, not settings (`view` for loaders, `create`/`update`
  for writes). The Onshape connection and the pipeline setting are then read with
  the SERVICE ROLE. Under the legacy routes the connection is read with the user's
  client, so those reads silently require `settings_view`, and the token refresh
  they trigger silently fails without `settings_update`.
- `settings.readFailed` → "Could not read the Onshape settings just now. Try
  again." Wording a transient error as a configuration state sends the user to
  change a setting that was never wrong — and re-saving it re-registers the
  webhook.
- `!settings.isV2` → refused.
- `getOnshapeClient` is narrowed on `.client`, never on `.error`: the union is
  `{client, error: null} | {client: null, error: string}` and `""` is a valid
  falsy error string, which is why the legacy routes carry a `@ts-expect-error`
  there instead.

| Route | Verb | Does |
|---|---|---|
| `v2.revisions` | loader | every released revision in the Onshape company, drawings and obsoletes excluded, each with its `externalId` and a `linked` flag. Pages on Onshape's `next` cursor, `MAX_PAGES = 20`, and REPORTS `truncated` |
| `v2.versions` | loader | a document's versions, each marked `released` by joining against the company revisions sweep. Requires `allowUnreleasedSync`. Workspaces are deliberately never offered — the BOM, parts and translation endpoints all hardcode `/v/{versionId}`, so a workspace would 404 at BOM time rather than at pick time. Reports `truncated` (list) and `releasedUnknown` (badges) separately |
| `v2.elements` | loader | the ASSEMBLIES in a version, each with its real Onshape PART NUMBER |
| `v2.bom` | loader | the BOM preview: per row, `update` / `create-revision` / `create` / `ambiguous`, plus `skipped`/`orphaned` counts and a summary |
| `v2.create` | action | create a Carbon part from a released revision, from the whole New Part payload, and optionally queue its BOM import |
| `v2.link` | action | link an EXISTING Carbon item to a released revision |
| `v2.import` | action | validate, link the target item, and queue `onshape-bom-import` |

### Why `v2.elements` exists

An Onshape element's **NAME** and its **PART NUMBER** are different fields and
diverge freely — an assembly named "RD-410 Wandleser RFID" can carry part number
TB-900. `getElements` returns only the name. The part number is what becomes the
Carbon item, so it is what the user has to be choosing and what has to travel with
the selection; the legacy elements loader could only pass the name along as though
it were the part number. The route reads it per element from
`getElementMetadata`, preferring Onshape's stock property id
`57f3fb8efa3416c06701d60f` over the localised name `"Part number"`
(`v2.elements.ts:24`, `:42-52`). Metadata is one request per element, so the
fan-out is capped at `MAX_ELEMENTS = 50` and reported as `truncated`; a failed
metadata read logs and keeps the assembly with a thinner label rather than
dropping it.

### `v2.create` and `v2.link` refusals

- The Onshape half of the payload is IDENTITY ONLY. Nothing the client sends about
  the part itself is persisted: `resolveOnshapeRevision` (`lib/resolve.ts:57`)
  re-fetches the revision from Onshape and requires `revision`, `documentId`,
  `versionId`, `elementId` and `partId` to ALL agree, then the route writes
  Onshape's own values. Matching on revision alone would accept a selection whose
  document/element had been swapped for another part's. Refusals:
  `drawing-element`, `revision-not-found`, `obsolete`, `lookup-failed`; a 429 is
  rethrown untouched.
- `v2.create` refuses BEFORE creating anything if the CAD thing already has a
  Carbon item, and distinguishes "this exact revision is already in Carbon" (via
  the revision mapping) from "another revision of this part is already here" (via
  the element mapping). Conflating them produces a message that is simply wrong: a
  company that has released A, B and C has three picker entries per part sharing
  one elementId.
- `v2.create` takes the WHOLE New Part payload from the form —
  `partBaseValidator` minus `id`/`revision`/`name`/`readableId`/`modelUploadId`,
  with the storage and shelf-life refines still applied, plus
  `importBom: zfd.checkbox()`. Those three identity fields are OFF the schema
  entirely rather than accepted and ignored, so a hand-posted number cannot be
  persisted. The UI seeds replenishment from the element type (Assembly → Make /
  Make to Order, otherwise Buy / Pull from Inventory) and shows it for
  confirmation. `customFields: setCustomFields(formData)` comes along, as on the
  ordinary new-part action.
- `v2.create` RE-READS the created item by `(readableId, revision, companyId,
  type)` instead of trusting what `upsertPart` returned. That function's insert
  branch finishes with a lookup against the `parts` VIEW, which is
  `DISTINCT ON (readableId, companyId)` ordered so a NAMED revision sorts first —
  so creating `ABC` rev `0` beside an existing unlinked `ABC` rev `A` succeeds
  and hands back rev A's id, and both mappings plus the asset pull would land on
  the wrong item. When the re-read finds nothing the route refuses the LINK and
  says so, rather than mapping a row it cannot identify.
- `importBom` is refused outright when `elementType !== 1` (a Part Studio body has
  no bill of materials) and soft-checked with `getUserClaims` for `update` +
  `delete` on parts. NOT a second `requirePermissions`: that THROWS a redirect on
  denial, so a create-only user would be bounced off the page and never get the
  part. The import is the optional half; the part is not.
- **Exactly one asset path runs per creation.** With `importBom` the route queues
  `onshape-bom-import` against the item's auto-created Draft `makeMethod` and
  SKIPS `onshape-v2-item-assets` — the import job pulls the top-level item's own
  model itself, and running both double-exports one element against a
  rate-limited API while `attachOnshapeAssetsToItem`'s compare-and-set files the
  loser's model away as a document.
- `v2.link` requires `confirmOverwrite` and is destructive by consent on the fields
  Onshape owns — currently the NAME only, written as a narrow two-column update
  rather than `items_updateItem` (which sanitises undefined keys to null and
  requires fields this caller has no business supplying). The part NUMBER is never
  touched: once the mapping exists the number is a label, and rewriting
  `readableId` would break every document, PO and job that renders it. A
  `numberMismatch` is returned so the UI can say so.
- `v2.link` reports a HALF-MADE link: if the element mapping is written and
  `writeRevisionMapping` then fails, the user is told, because otherwise they are
  told the link is complete when its provenance half is missing.
- `v2.import` requires `update` + `create` + `delete` on parts — the job mints
  parts and deletes material lines, so asking only for `update` let the route do
  more than the permission it checked. It re-checks the same four refusals the job
  makes (not Draft, CO-owned, unreleased-into-a-named-revision, PLM lock) so the
  user sees them immediately: the job's refusal throws inside a step on a function
  declared `retries: 10`, so a deterministic refusal the route did not catch is
  retried eleven times and then dies in the job log while the user was told
  "Import started".
- `v2.import` writes the target item's element mapping ITSELF, for every import,
  not only when a part number came along — an assembly with no Onshape part number
  is still importable, and gating the link on it left the top-level item the one
  thing in the tree joined by nothing. When a revision IS named it is verified
  through `resolveOnshapeRevision` first; a named revision with no part number is
  refused, since there is nothing to check the claim against.

## v2 UI

- `PartsTable` — "From Onshape" is a LINK to `${path.to.newPart}?source=onshape`,
  not a modal. The `OnshapeCreatePart` modal it used to open was deleted: it
  re-implemented three fields the New Part form already has and could not reach
  the other twelve, and the two surfaces had already diverged on how they seeded
  replenishment.
- `PartForm` — owns the create-from-Onshape flow, behind an explicit
  `withOnshapeSource` prop (never inferred from `type`: the three inline-create
  callers in `components/Form/{Part,Item,Items}.tsx` read a PostgrestResponse
  back and would break if this form could redirect them). Under a selection the
  identity fields become `InputControlled … isReadOnly` — `isReadOnly`, because a
  DISABLED input submits nothing and the client-side `partValidator` would fail
  on `id`/`revision`/`name` first; and WITHOUT `isUppercase`, which would
  re-create the lowercase-part-number defect v2 exists to fix. The dropzone is
  hidden (the Onshape pull compare-and-sets `modelUploadId`), and the action
  switches to `v2.create`.
- `PartForm`'s two decisions are pure and unit-pinned in
  `ui/Parts/onshapePartSource.ts`: `seedFromElementType` (assembly → Make / Make
  to Order) and `bomOptionState` (offered only for `elementType === 1`, disabled
  without create + update + delete on parts).
- `PartHeader` — "Link to Onshape" menu item → `OnshapeLinkPart`, plus an
  "Importing from Onshape…" badge driven by `useOnshapeImportStatus`.
- `Item/BoMExplorer` — renders `OnshapeSync` (legacy) or `OnshapeBomImport` (v2),
  never both: showing both would let someone write string-matched items with no
  mapping while v2 is live, silently poisoning the migration.
- `OnshapeRevisionPicker` — the shared released-revision list. Loads on OPEN, not
  on mount: the sweep costs real Onshape calls. `hideLinked` is true for creating
  and false for linking. `onlyElementType: 1` for a BOM import, since a Part Studio
  body has no bill of materials.
- `OnshapeUnreleasedPicker` — a SECOND path, not a mode: an unreleased version has
  no revision to select, so the user picks document → version → assembly. Offered
  only when `allowUnreleasedSync`. It sends the element's PART NUMBER, from
  `v2.elements`, and shows the name only as a label.
- `OnshapeBomImport` — preview-then-confirm; the preview says what will HAPPEN per
  row rather than just listing rows, and surfaces `skipped + orphaned` as dropped
  rows so a partial BOM is never presented as the whole one. Still the surface for
  an item that already exists; the New Part form deliberately shows no preview,
  since the part does not exist yet and every row would preview against nothing.
- `useOnshapeImportStatus` (`apps/erp/app/hooks/`) — reads
  `metadata.bomImport` off the item's `onshapeElement` mapping and polls every
  3 s while it is running. POLL ONLY: `externalIntegrationMapping` is not in the
  `supabase_realtime` publication, so a push affordance would need a migration.
  A `startedAt` older than 15 minutes with no `finishedAt` reads as UNKNOWN, not
  as running — `onshape-bom-import` is `retries: 10` and a crashed run never
  reaches its stamp.
- The unreleased picker is deliberately NOT wired into the New Part form.
  `onshapeV2CreateValidator.revision` is `z.string().min(1)` and
  `OnshapeUnreleasedPicker` emits `revision: ''`, so it would fail validation
  with nothing on screen to explain why. Creating from an unreleased version is
  a separate branch nobody has written.

## Buy vs Make — one rule, three sources

`onshape-replenishment.ts` in `packages/jobs`. Both paths that CREATE a part use
it, so the same part cannot classify two ways depending on whether it arrived
through a BOM import or a release.

It lives in `packages/jobs` and is env-free for the same reason
`onshape-matching.ts` and `onshape-bom-outcome.ts` do: importing the
`@carbon/ee/onshape` barrel pulls in `client.ts`, which boots `@carbon/env` and
throws "INNGEST_SIGNING_KEY is not set" in a unit test. Both consumers are in
this package anyway.

Precedence:

1. **Onshape's "Purchasing Level"** — `"Purchased"` → Buy / Pull from Inventory,
   anything else in that column → Make / Make to Order. This is the column the
   LEGACY integration reads (`integrations.onshape.d.$did.v.$vid.e.$eid.bom.ts`
   :139,:148) and the only place an engineer STATES the intent rather than
   implying it. **It is COMPANY-DEFINED, not a stock Onshape property** —
   verified live 2026-08-21 that it appears in neither the 26 stock BOM columns
   nor the 19 stock element metadata properties, and that the test company
   defines no custom properties at all. A company without it is the normal case.
   Read case- and whitespace-insensitively on the DISPLAY NAME, because a
   company-defined column has no stable propertyId to key on.
   **It must be a TEXT property, not a List.** A List returns its display LABEL
   in the BOM but a numeric id in element metadata — `State` is `"Released"` in
   the BOM and `2` in `getElementMetadata` on the same element — so a List
   "Purchasing Level" would never match `"Purchased"` on the release path. The
   one created in the Carbon test company (`6a882bf6d9b435cf25eebd37`, Assembly
   + Part categories) is Text for this reason. That is the same
   fragility the BOM-column note describes, and it is what the spec's deferred
   "extensible custom-field mapping" question would fix.
   - BOM import: from `row.columns`, which `bom.ts` already keeps for exactly
     this ("Every column, keyed by display name — for custom-field mapping
     later").
   - Release: from `getElementMetadata`, since a release carries no BOM. One
     extra call, made only on the auto-create branch, and non-fatal.
2. **Structure**, when the column is absent. A BOM row with children is made and
   a leaf is bought; a released ASSEMBLY element is made and a part studio BODY
   is bought. An unrecognised element type falls to Buy — the safer wrong
   answer, since it does not claim Carbon can build something it has no method
   for.

**What it deliberately does NOT do is legacy's fallback.** Legacy's `else`
branch calls every part Make when the column is absent — which is every company
that has not defined one — and that poisons MRP for purchased leaf parts. It is
recorded as a defect in `.ai/plans/2026-08-13-onshape-import-revisions.md`.
Absent falls to STRUCTURE, never to a blanket answer.

Per the spec's field-ownership rule this is **seeded once on create and Carbon's
thereafter**: replenishment is a business decision, not a CAD fact, so no later
sync overwrites it. `describeOnshapeReplenishment` names WHICH source decided,
because "Onshape told us" and "we inferred it from the shape of the tree" earn
very different trust from whoever reads the notification.

## elementType — the numeric one

The webhook and the revisions API use a NUMERIC `elementType`
(`client.ts:60-66`); `OnshapeElementType` in `element.type.ts` is a separate STRING
enum used only as a `getElements` filter.

| Value | Element | Legacy asset sync | Legacy release import | v2 |
|---|---|---|---|---|
| 0 | Part Studio | GLTF → `modelUpload` on the matched item | affected item / revision | per-BODY items, exported with `partIds` |
| 1 | Assembly | GLTF → `modelUpload` on the matched item | affected item / revision | one item |
| 2 | Drawing | PDF → a `document` on the MODEL item | **excluded** | PDF → the model item, joined by element id |

**Drawing rule (legacy).** A released drawing is its own `DRW-xxxx` element sharing
the number of the model it documents. Its PDF attaches to the MODEL item
(`PRT-xxxx`/`ASM-xxxx`) at the same revision and a `DRW-xxxx` item is NEVER created.
Matching strips the leading letter prefix to a shared suffix
(`sharedNumberSuffix`, `onshape-matching.ts:25`) and ILIKEs `%<suffix>`; the
suffix must start with a non-alphanumeric separator or it is unusable as an anchor
(`-002033` would otherwise match `PRT-1002033`), and LIKE wildcards are escaped
(`escapeLikePattern`, `:102`). Exactly one match attaches; zero is
`no-matching-item`, more than one is `ambiguous-item`. Pure helpers, unit-tested in
`onshape-matching.test.ts`.

That same collision is why release import excludes `elementType 2`: a drawing
resolves to the SAME Carbon item as its model, so importing it would be a second
affected item violating `UNIQUE(changeOrderId, itemId)` on the first import of a
normal release — and deriving its change type from the `DRW-` readableId instead
would mint a junk part. The receiver filters it and the job re-checks it as a
backstop (`onshape-release-import.ts:413`).

**v2 resolves drawings by ID** (Phase 7, shipped 2026-08-21). The suffix
heuristic is disproved on real data — RD-410, DRW-410 and PK-410 all reduce to
`-410`, matching five items across two parts — so v2 never uses it. It refuses
only when the id lookup itself is ambiguous.

`OnshapeClient.getAppElementReferences(documentId, wvm, wvmId, elementId)` wraps
`GET /api/v10/appelements/d/{did}/{wvm}/{wvmid}/e/{eid}/references`.
`{targetDocumentId}:{targetElementId}` is exactly `buildElementExternalId`'s
format, so it is a primary-key lookup into `externalIntegrationMapping`.
Verified live at BOTH workspace and version level (2026-08-21, identical
payloads); version level is the one that matters, since every release path reads
at `/v/{vid}/`. The endpoint 400s with "Element must be an application" on
anything that is not a drawing.

`lib/drawing.ts` owns the resolution, in two halves:

- `chooseDrawingModelTarget(references, isModelElement, drawingElementId)` —
  PURE and unit-pinned. Drops records missing either id, drops a self-reference,
  drops non-model targets, dedupes on `{doc}:{el}`. Returns one / none / many.
  `targetConfiguration` is deliberately NOT part of the key: the externalId
  ignores the configuration, so splitting on it would manufacture an ambiguity
  the mapping layer does not have.
- `resolveDrawingModelItem(client, carbon, args)` — the async half. Element types
  come from `listDocumentElements`, NOT from the reference record: every record
  of both targets came back with `referenceType: 0` and every other
  discriminating field null, so the record cannot tell a model from the
  BILLOFMATERIALS element on the sheet. Drawings are identified by
  `dataType === "onshape-app/drawing"` — passing `?elementType=DRAWING` returns
  nothing, because the listing calls a drawing `APPLICATION`.

Two narrowings that are easy to get wrong:

- `readItemsForElementIncludingParts` (`mapping.ts`), not
  `readItemIdsForElement`. A reference record carries NO partId, so an exact
  externalId match finds zero rows for a drawing of a Part Studio body while N
  rows shaped `{doc}:{el}:{partId}` exist.
- Then `resolveBomRow` on the RELEASED REVISION. The element mapping is
  revision-agnostic by construction, so attaching at the element puts revision
  A's drawing on the item at revision C — the exact failure
  `onshape-v2-assets.ts` was written to prevent.

Refusal reasons: `drawing-references-no-model`, `drawing-references-many`,
`drawing-model-unmapped`, `drawing-model-revision-missing`,
`drawing-model-ambiguous`. The last is one element whose family has several
members at one revision — a different problem from two target ELEMENTS, and it
has its own reason so the message does not misdescribe it.

**Three paths carry the drawing pass**, all through
`pullOnshapeDrawingsForDocument` (`onshape-drawings.ts`):

| Path | Direction | Where |
|---|---|---|
| `onshape-release-v2`, `elementType === 2` | drawing-first | its own `handle-drawing` step; never reaches `runOnshapeReleaseImport` |
| `onshape-release-v2`, model release | model-first | after the asset attach, gated on `attachAssetsOnRelease` |
| `onshape-v2-item-assets` (create + link) | model-first | after the model pull; this job also GAINED a notification, having previously returned refusals nobody read |
| `onshape-bom-import` | model-first | once per document-version, after the asset loop; refusals are `warnings`, not `skipped` |

**DIRECTION ASYMMETRY** is why model-first costs more: references runs drawing →
model and Onshape has no inverse, so a model-first caller lists the document's
elements and calls references on every drawing. 1 + N calls per document-version
— hence grouping by `(documentId, versionId)` rather than per element.

The document is named after the ITEM (`readableIdWithRevision`), never after the
drawing's own part number, in BOTH the drawing-first and model-first paths. The
PDF lives on the model item and the same drawing can arrive either way; naming it
two ways files one drawing as two documents, since the attach helper
de-duplicates on the storage path. Verified live: both paths produce exactly one
row, `TB-900.A-<drawingElementId>.pdf`.

`syncOnshapeDrawingAssetsToItem` now takes an optional `client`. Building one per
drawing is a refresh-token race (token refresh is an unlocked read-modify-write
of the whole `metadata` column) and escapes the caller's rate-limit wrapper. Its
filename also gained the drawing element id: the attach helper de-duplicates on
the storage PATH, so two drawings of one model previously collapsed onto a single
document row.

**The webhook needs no change** — pinned by two tests in
`webhook.onshape.$companyId.test.ts`. The v2 branch never filtered on
elementType, so a drawing already dispatches `onshape-release-v2` carrying
`elementType: 2`. Do NOT relax the partNumber gate: Onshape's release dialog
makes a drawing's part number required and blocks the release without one, so
that gate cannot fire for a genuinely released drawing.

**Still unproven:** that the webhook really carries `elementType === 2` for a
released drawing. No released drawing exists in the test account — the attempt is
blocked on "Drawing has a pending update". The model-first paths depend on no
webhook field and are exercisable without one.

Two things to know. A drawing's `elementType` in the `/elements` listing is
**`APPLICATION`, not `DRAWING`** — the references endpoint 400s on every other
type — but that is the listing API's string encoding, not the numeric one. The
revisions API reports `1` for every released assembly and `0` for every released
part, matching the scheme the refusal branches assume, so `2` for a drawing is
sound. And `webhook.onshape.$companyId.ts:292` refuses to dispatch without a
`partNumber` — but Onshape itself will not release a drawing without one (its
release dialog makes the field required), so that gate likely never fires for a
released drawing and should not be relaxed on the old reasoning.

## Legacy BOM import path

User-driven, separate from the webhook, and the legacy pipeline's only path that
CREATES items.

- UI: `apps/erp/app/components/OnshapeSync.tsx`, rendered from the item's BoM
  explorer when `integrations.has("onshape")` AND the company is not on v2
  (`modules/items/ui/Item/BoMExplorer.tsx:166`). Cascading document → version →
  assembly combobox, then Load BOM, then Save.
- `integrations.onshape.d.$did.v.$vid.elements.ts` filters to
  `OnshapeElementType.ASSEMBLY` at a VERSION (`wvm: "v"`), so only assemblies are
  offered. It returns Onshape's raw element list — names, no part numbers.
- `integrations.onshape.d.$did.v.$vid.e.$eid.bom.ts` — the loader. Flattens
  Onshape's `headers`/`rows` into named columns, unwrapping object-valued columns
  via `displayName` (line 78), then resolves each row to a Carbon item by
  `readableIdWithRevision` in one `.in()` query (line 111). Rows with no match
  fall back to `Purchasing Level === "Purchased" ? Buy : Make` (lines 211-220).
- **Known bug, fix NOT on this branch** (commit `20faf4496`, reverted here):
  Onshape stamps revisions only on RELEASED versions, so a row from an unreleased
  version carries an empty `Revision` and can only exact-match a revision-`0`
  item. The sync therefore builds a complete parallel item tree at revision `''`
  and repoints the parent's make method at it, orphaning the real revision's
  children silently. `20faf4496` fixes it — a bare-revision row with no exact
  match falls back to the LATEST existing revision of the same `readableId` — but
  it changes a live legacy path, and the route and the edge function must deploy
  together or an existing revision's BOM is wiped. It was pulled out of the v2
  branch to ship as its own PR; the commit is still in this branch's history, so
  `git cherry-pick 20faf4496` onto `main` reconstructs it. See
  `.ai/reviews/2026-08-19-onshape-v2-legacy-impact.md`.
- `integrations.onshape.sync.ts` — the action. Validates rows with
  `onShapeDataValidator`, invokes the `sync` edge function with `type: "onshape"`,
  then replaces the item's `entityType: item / integration: onshape` mapping row
  (delete via service role, insert via the user client — the RLS note below).
- `packages/database/supabase/functions/sync/index.ts` `case "onshape"` (line 175)
  — the writer, inside one Kysely transaction. Finds or creates a Draft
  `makeMethod` for the top level, DELETES and rebuilds `methodMaterial` (line 372),
  and walks the BOM tree. A MATCHED item gets only `updatedBy`/`updatedAt`; its
  `name` and `description` are left as Carbon has them. A NEW item is always
  created as `type: "Part"`, `unitOfMeasureCode: "EA"`, `replenishmentSystem:
  "Buy"`/`"Make"` with an empty make method — it never copies from an existing
  sibling revision. `20faf4496` changes both of those (Onshape-owned fields
  written on a match; a new item cloned from the latest sibling including its
  `methodOperation` rows) and is reverted here — see the bullet above.

## `externalIntegrationMapping` usage

Four `integration` values and five shapes, all on the one table
(`20260128140000_external-integration-mapping.sql`):

| `entityType` | `integration` | `entityId` | `externalId` | dup? | Written by |
|---|---|---|---|---|---|
| `item` | `onshape` | Carbon item id | null | — | legacy BOM sync picker state (`integrations.onshape.sync.ts:75`); read by `OnshapeSync.tsx:77` to restore the picker + `lastSyncedAt` |
| `item` | `onshapeData` | Carbon item id | `readableIdWithRevision` | false | the `sync` edge function (lines 446, 601); read by `components/BoMExplorer/BoMExplorer.tsx:521` for the Onshape State badge |
| `onshapeRelease` | `onshape` | `releaseId` | `releaseId` | — | the release-import claim (`onshape-release-import.ts:576`); metadata carries `changeNoticeId`, `claimedByMessageId`, `documentId`, `versionId`, `releaseName`, `importedAt`, `items[]`, `openNoticeCollisions?` |
| `item` | `onshapeElement` | Carbon item id | `did:eid[:partId]` | **true** | v2 (`mapping.ts`); metadata carries `elementType`, `versionId`, `versionName`, `partNumber`, `fromUnreleasedVersion`, `lastSyncedAt`, `bomImport` |
| `item` | `onshapeRevision` | Carbon item id | Onshape `revisionId` | **false** | v2 (`mapping.ts:358`); metadata carries `revision`, `releaseId`, `releaseName`, `documentId`, `versionId`, `elementId`, `importedAt` |

`UNIQUE (entityType, entityId, integration, companyId)` is what makes the release
marker a claim and what makes the element link delete-then-insert. The partial
`UNIQUE (integration, externalId, entityType, companyId) WHERE
allowDuplicateExternalId = false` is what the `onshapeData` upserts conflict on and
what enforces the 1:1 revision link.

The v2 mapping metadata is where the VOLATILE Onshape state lives, and keeping it
there is what lets `item.revision` stay clean: an unreleased sync has no Onshape
revision to record, so it targets Carbon's initial revision and sets
`fromUnreleasedVersion` here rather than inventing a revision string that would
leak into documents, POs, accounting sync and CSV exports.

**RLS: SELECT and INSERT policies only, no UPDATE and no DELETE**
(`20260204001831_external-integration-mapping-rls.sql`). A PostgREST UPDATE from a
user-scoped client matches zero rows and returns `{ data: [], error: null }` — no
error, no signal. Every marker and mapping MUTATION therefore runs on the service
role, and the legacy BOM sync route deletes the old mapping through
`getCarbonServiceRole()`.

## Migrating a company from legacy to v2

- Items the legacy pipeline manages carry `onshapeData` / `onshape` mappings and no
  `onshapeElement` one, so **v2 cannot see them at all** until someone links them.
- `findUnlinkedLegacyOnshapeItems` (`lib/legacy.ts:47`) is that count. It filters
  `entityType = "item"` (the `onshape` value is OVERLOADED — it also marks the
  release claim, whose entityType is `onshapeRelease`), de-duplicates ids (one item
  can legitimately carry both legacy rows), and resolves against `item` so mappings
  orphaned by a deleted item drop out. PAGED at 1000: PostgREST caps an unbounded
  select there and says nothing, and the warning's whole job is to state the size
  of the work.
- The settings save flashes it at the moment of the switch
  (`integrations.$id.tsx:1534-1556`) — a successful save redirects and unmounts the
  drawer, so the flash is what the user actually sees. A failed count logs and does
  not fail the save.
- The adoption path is `OnshapeLinkPart` → `v2.link`, per item.
- The legacy backfill is refused on a v2 company (see `onshape-backfill` above).

## Gotchas

- **Revision `0` / `''` / NULL all collapse to "no revision."**
  `item.readableIdWithRevision` is `GENERATED ALWAYS AS (COALESCE(readableId || CASE
  WHEN revision = '0' THEN '' WHEN revision = '' THEN '' ELSE '.' || revision END,
  readableId)) STORED` (`20250519122022_revisions.sql:2`), and
  `releaseKey`/`getReadableIdWithRevision`/`isInitialRevisionLabel` mirror it. A
  numeric Onshape revision scheme is therefore ambiguous at revision `0`: it
  produces the same match key as an unrevised item while remaining a DISTINCT value
  in `item.revision` and in `item_unique`. Every v2 comparison uses the RAW
  `revision` column, never the generated one.
- **`item_unique` does not catch a same-family duplicate.** It is on the RAW
  revision column and Postgres treats NULL as distinct, so inserting `'0'` against
  an existing `''`/NULL row raises no conflict while `readableIdWithRevision`
  collapses both to the bare number — two rows indistinguishable everywhere a human
  looks. The BOM import resolves the family by number itself rather than relying on
  the constraint (`onshape-bom-import.ts:671-733`).
- **`getNextRevision` does not converge on every Onshape label.** It only advances
  pure digits or 1–2 uppercase letters; anything else is returned UNCHANGED
  (`items.service.ts:263-280`). An Onshape label like `A2` would be handed straight
  back and collide on `item_unique`, so the Onshape letter is passed EXPLICITLY into
  `items_addChangeNoticeAffectedItem` / `items_createRevision`.
- **These jobs run on the service role — RLS gives no tenancy backstop.** Every
  `.from(...)` must carry `.eq("companyId", …)` by hand.
- **`getOnshapeClient` does a read-modify-write of the whole `metadata` column on
  token refresh** (`client.ts:657-673`): it reads `metadata`, spreads it, and writes
  the merged object back. Two concurrent Onshape functions for one company each read
  the pre-refresh metadata and each write their own tokens — last write wins, and
  the loser's refresh token has already been consumed. A concurrent settings save
  can also lose whatever the refresh wrote. There is no locking; the per-job
  concurrency keys do not serialize ACROSS jobs. `onshape-bom-import`'s
  company-level key is partly there to serialize this within one import.
- **`createdBy` must be passed explicitly to `items_createRevision`.** Its service
  parameter is literally named `args`, and the MCP direct executor's
  `paramName === "args"` branch pushes the payload through WITHOUT
  `enrichWithAuthContext` (`direct-executor.ts:225-229`), so the declared
  `injectAuth` is silently skipped and the item insert fails on `createdBy`'s NOT
  NULL constraint. The same is true of any other service whose param is named
  `args`. `injectAuth` also never includes `userId`, which is why
  `addChangeNoticeAffectedItem` gets an explicit one.
- **`items_addChangeNoticeAffectedItem` does not return `newItemId`.** It writes
  `newItemId` onto the `changeOrderAffectedItem` row but returns only
  `{ id, draftMakeMethodId }` (`items.service.ts:6299-6304`). The release import
  therefore READS IT BACK off `changeOrderAffectedItem` by the returned affected-item
  id before writing Onshape's attributes; without that read-back
  `applyOnshapeAttributes` silently never runs on the change-notice path and the
  draft revision stays a byte-for-byte copy of its base, which renders as the
  literal "No changes yet." empty diff.
- **`applyOnshapeAttributes` is a narrow two-column `item` update, not
  `items_updateItem`** (`onshape-release-import.ts:745`): that service runs the
  payload through `sanitize()`, which turns a present-but-undefined key into null,
  and its schema requires `name` + `replenishmentSystem`. `v2.link` writes the name
  the same way for the same reason.
- **The job's `CHANGE_NOTICE_OPEN_STATUSES` is a deliberate duplicate** of
  `changeNoticeOpenStatuses` in `apps/erp/app/modules/items/items.models.ts`
  (`onshape-release-import.ts:79`) — `packages/jobs` cannot import `~/modules`. The
  BOM import duplicates `checkRevisionLock`'s Production rule for the same reason.
  Keep them in sync.
- **`no-dispatcher` is a real runtime state.** `getWorkflowDispatch()` is filled
  lazily by the ERP on the first request to `/api/inngest`
  (`setWorkflowDispatch`, `packages/jobs/src/workflows/actions/dispatcher.ts:30`);
  before that the release import throws rather than half-importing.
- **A forged webhook matters more now.** Asset sync could not inject content (the
  job re-resolves everything against the Onshape API), but release import creates
  Draft change notices and the callback path is enumerable. Fail-open on an absent
  secret is what keeps existing customers byte-identical; a company that cares sets
  `webhookSigningSecret`.
- **`state` on the OAuth callback is checked for presence only** (`oauth.ts:95`) —
  it is not compared against anything stored.
