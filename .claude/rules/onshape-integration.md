---
paths:
  - packages/ee/src/onshape/**
  - packages/jobs/src/inngest/functions/integrations/onshape-*.ts
  - apps/erp/app/routes/api+/integrations.onshape.*.ts
  - apps/erp/app/routes/api+/webhook.onshape.$companyId.ts
  - apps/erp/app/components/OnshapeSync.tsx
  - packages/database/supabase/functions/sync/index.ts
---

# Onshape Integration

One-way ingest from Onshape (CAD/PLM) into Carbon: released CAD models and drawing
PDFs onto existing items, released revisions into engineering data, and a
user-driven BOM import. Three consumers share one OAuth connection and one
webhook subscription. Nothing is ever pushed back to Onshape except translation
(export) jobs and webhook management.

Three independent surfaces, each with its own trigger and its own on/off switch:

| Surface | Trigger | Gate | Creates items? |
|---|---|---|---|
| Asset sync (+ backfill) | `onshape.revision.created` webhook / manual action | `assetSyncEnabled` | Never — link-only |
| Release import | the same webhook | `releaseImportEnabled` | Only via `createRevision` of an existing part |
| BOM import | user picks document/version/assembly in the item's BoM explorer | integration installed | Yes — creates the item tree |

## Package (`@carbon/ee/onshape`)

One export subpath, `./onshape` → `src/onshape/lib/index.ts`
(`packages/ee/package.json:17`); it re-exports `client`, `data`,
`document.type`, `element.type`. `hooks.server.ts` is NOT in that barrel — it is
re-exported from `@carbon/ee/hooks.server` (`packages/ee/src/hooks.server.ts:19`).

- `config.tsx` — the `Onshape` descriptor via `defineIntegration` (id `onshape`,
  category `CAD`, `active: !!ONSHAPE_CLIENT_ID`). Settings, setting groups, the
  zod schema, the backfill action, and `onClientInstall` (popup + `postMessage`
  `app_oauth_completed`, `config.tsx:124`).
- `lib/client.ts` — `OnshapeClient` + `getOnshapeClient(client, companyId, userId)`
  (`client.ts:591`). All calls go to `https://cad.onshape.com/api/v10/...`.
  `OnshapeApiError` carries `status` + `retryAfterSeconds`;
  `OnshapeAssetTooLargeError` marks a permanently-unsyncable export.
- `lib/data.ts` — `onShapeDataValidator`, the BOM-row array the sync edge function
  accepts.
- `lib/element.type.ts` — `OnshapeElementType` (`ASSEMBLY`/`PARTSTUDIO`/`DRAWING`,
  the STRING enum used as a `getElements` query filter) and `OnshapeWVMType`
  (`w`/`v`/`m`). Not the same thing as the numeric `elementType` below.
- `hooks.server.ts` — webhook register/deregister/converge +
  `onshapeConnectionHasWriteScope`. Registered in the server-hooks registry with
  `onUninstall` only (`packages/ee/src/hooks.server.ts:48`).

Client methods worth knowing: `getCompanies` (`client.ts:181`),
`createWebhook`/`getWebhooks`/`deleteWebhook` (194/214/224),
`getBillOfMaterials` (249, indented + multiLevel + `generateIfAbsent`),
`getRevisions` (263, per part number + numeric elementType),
`getCompanyRevisions` (280) / `getCompanyRevisionsPage` (309),
`createPartStudioTranslation`/`createAssemblyTranslation`/`createDrawingTranslation`
(355/387/413), `getTranslation` (432), `downloadExternalData` (445),
`getElementThumbnail` (478), `downloadExternalDataToFile` (502),
`static refreshAccessToken` (559).

Only two export formats are accepted: GLTF for models, PDF for drawings
(`client.ts:40-41`). Mesh translations must send a `resolution` or Onshape fails
them. Every request carries a 60 s timeout (`client.ts:118`).

## OAuth install / connect

- `integrations.onshape.install.ts` — builds the authorize URL. Scope is
  `OAuth2Read OAuth2Write`, joined with a literal `%20` OUTSIDE `URLSearchParams`
  (which would emit `+`) — `install.ts:30`. `state` is a fresh `crypto.randomUUID()`
  and is **not** verified on the callback beyond being present.
- `integrations.onshape.oauth.ts` — callback. Handles Onshape's `error` param
  before parsing for `code` (`oauth.ts:65`); `invalid_scope` maps to the
  `write-permission` error code. Failures redirect to the integrations page with
  `?integration=onshape&error=<code>`; the copy lives in
  `apps/erp/app/modules/settings/integration-errors.ts` (7 codes).
- Credentials land in `companyIntegration.metadata`
  (`oauth.ts:140-155`): `credentials { type: "oauth2", accessToken, refreshToken,
  expiresAt }`, plus `scope` and `baseUrl`. Later writes add `onshapeCompanyId`
  (`hooks.server.ts:55`) and the settings save adds the four declared settings.
- **Tokens are stored unencrypted** — plain strings in a JSONB column. Same for
  `webhookSigningSecret`, which the setting's own description says out loud
  (`config.tsx:79`).
- **Reconnecting REPLACES the whole metadata column.** `upsertCompanyIntegration`
  upserts the object it is handed (`settings.server.ts:274`) and the callback
  passes only credentials/scope/baseUrl — so a reconnect wipes `assetSyncEnabled`,
  `releaseImportEnabled`, `releaseImportMode`, `webhookSigningSecret` and
  `onshapeCompanyId`. The settings save is the merging path
  (`{ ...existingMetadata, ...formData }`, `integrations.$id.tsx:1395`); that
  merge is SHALLOW, which is why clearing the signing-secret field stores `""`
  rather than removing the key.
- No webhook is registered on connect (`oauth.ts:160-164`) — asset sync and
  release import are both off by default, so there is nothing to subscribe for.
- `expiresAt` is always written as now + 3600 s, both at the callback
  (`oauth.ts:145`) and on refresh (`client.ts:642`), regardless of what Onshape
  returned.
- A connection authorized before `OAuth2Write` was requested holds a read-only
  token, and a refresh cannot widen it (the refresh grant sends no scope) — only a
  reconnect can. `onshapeConnectionHasWriteScope` reads the captured `scope` and
  treats a missing field (legacy installs) as read-only (`hooks.server.ts:78-84`).
  The settings save forces BOTH toggles back off and tells the user to reconnect
  (`integrations.$id.tsx:1407-1415`, message at 1503).

## Settings — exactly four, and what each gates

Declared in `config.tsx:28-85`, validated by the zod schema at `config.tsx:86-111`.
`SwitchField` posts the literal strings `"true"`/`"false"`, so both switches use an
explicit `z.preprocess` — `z.coerce.boolean()` would make `"false"` truthy.

| Setting | Type / default | Gates |
|---|---|---|
| `assetSyncEnabled` | switch, `false` | the `onshape-revision-sync` dispatch, the `onshape-backfill` job + its route + the visibility of the Backfill action (`enabledWhenSetting`, `config.tsx:121`) |
| `releaseImportEnabled` | switch, `false` | the `onshape-release-import` dispatch and the job's own gate |
| `releaseImportMode` | options, `"changeNotice"` | which branch release import takes: `changeNotice` (reviewable) or `revision` (immediate) |
| `webhookSigningSecret` | text, `""` | opt-in HMAC verification in the receiver; empty = verification skipped |

`releaseImportMode` renders as two choice cards, sits in the `Release import`
setting group, and is nested under the switch via
`visibleWhen: { field: "releaseImportEnabled", equals: "true" }` — the literal
string `"true"` is correct because `ConditionalSettingField` compares
`String(controlValue)` (`config.tsx:71-73`). A `visibleWhen`-hidden field is
unmounted and posts NOTHING, which is why the enum carries a `.default` rather
than being a bare `z.enum`.

`webhookSigningSecret` sits in the `Security` group and is declared `text`, NOT
`password`/`secret`, matching the paperless-parts "Webhook Signing Secret"
precedent. Both masked types render a `<Password>` input and nothing in
`IntegrationForm` sets `autoComplete`, so a browser password manager silently
autofills them — observed writing a saved password into this field on save, which
would then make the receiver reject every genuine Onshape delivery. Masking buys
little here (the value is plaintext JSON in the row either way); a silently wrong
value costs webhook ingestion. Onshape's signing keys are company-level, not
per-webhook.

Migration `20260817155435_onshape-release-import-jsonschema.sql` declares the
three new keys in the `onshape` row of `integration.jsonschema`, which
`verify_integration()` validates `companyIntegration.metadata` against. It
supersedes `20260703165330_onshape-asset-sync-jsonschema.sql`. Data-only; no row
is touched, and an absent key is indistinguishable from `false` at every read
site.

## Webhook registration

`packages/ee/src/onshape/hooks.server.ts`. ONE subscription per Carbon company,
**company-scoped in Onshape** (`createWebhook` requires `companyId` or
`documentId`; Carbon always sends the Onshape company id — `client.ts:194-210`).

- Subscribed events: `["onshape.revision.created"]` only
  (`hooks.server.ts:132`). `collapseEvents` defaults to false.
- Callback URL: `${getAppUrl()}/api/webhook/onshape/${carbonCompanyId}`
  (`callbackPath`, `hooks.server.ts:8`).
- `alreadyRegistered` compares on the **path**, not the full URL —
  `webhook.url.includes(path)` (`hooks.server.ts:116`) — so a host change
  (localhost, a tunnel, prod) still resolves this company's webhook. Deregistration
  filters the same way and deletes every match (`hooks.server.ts:158-163`).
- The Onshape company id comes from `metadata.onshapeCompanyId` when present, else
  `getCompanies()[0].id`, which is then persisted so the webhook and the jobs
  target the same Onshape tenant (`resolveAndStoreOnshapeCompanyId`,
  `hooks.server.ts:31-67`; the jobs' copy is `resolveOnshapeCompanyId`,
  `onshape-backfill.ts:131`).
- `ensureOnshapeReleaseWebhook(companyId, wanted)` (`hooks.server.ts:181`) is
  register-or-deregister. It is called ONLY from the integration settings save
  (`integrations.$id.tsx:1515`) with
  `wanted = assetSyncEnabled || releaseImportEnabled` — the subscription is
  shared, so it exists while EITHER is on and is deleted only when both are off.
  A failed registration while `wanted` is a hard, flashed error; the settings are
  already saved by then.
- `onshapeOnUninstall` deregisters on disconnect (`hooks.server.ts:192`).
- Neither function throws; both return `{ ok } | { ok: false, error }`.
- The background client is built for the integration's `updatedBy` (the installer),
  falling back to the string `"system"` (`hooks.server.ts:22`).

## Webhook receiver — `apps/erp/app/routes/api+/webhook.onshape.$companyId.ts`

`loader` answers a GET with `{ success: true }` for Onshape's endpoint validation
(line 112). The `action` control flow, in order:

1. `companyId` param present, else 400 (line 124).
2. `getIntegration(serviceRole, "onshape", companyId)` — 400 on query error,
   missing row, or `active !== true` (lines 130-155).
3. **Either-flag gate** (lines 163-174): read `assetSyncEnabled` and
   `releaseImportEnabled` off `metadata`, both strict `=== true`; if neither, log
   and ack `200`. This gate is deliberately BEFORE the body is read, so a company
   that opted into neither takes a byte-identical path to before release import
   existed.
4. `rawBody = await request.text()` — read ONCE as text (line 180), because HMAC
   needs the exact bytes Onshape signed; re-serializing a parsed object would not
   reproduce them.
5. **Optional HMAC** (lines 189-202). `metadata.webhookSigningSecret` trimmed;
   empty/absent = skip and proceed (fail-open by design). When set,
   `verifyOnshapeSignature` (line 74) requires `x-onshape-webhook-timestamp`,
   rejects a non-finite one, rejects `|now - timestamp| > 5 min`
   (`SIGNATURE_MAX_AGE_MS`, line 62), computes
   `Base64(HMAC-SHA256(secret, "<timestamp>.<rawBody>"))`, and accepts EITHER
   `x-onshape-webhook-signature-primary` OR `-secondary` — Onshape rotates keys and
   sends both, so accepting either is what makes rotation zero-downtime. Failure
   is a `401`. `signaturesMatch` (line 64) length-checks before
   `crypto.timingSafeEqual`, which THROWS on a length mismatch — the same guard
   `webhook.xero.ts:75` still lacks.
6. `JSON.parse(rawBody)` — 400 on failure (line 206).
7. `onshapeWebhookEnvelope.safeParse` — 400 on failure (line 215). The envelope
   (lines 34-56) is `.passthrough()` on purpose so a new Onshape field never
   rejects a real event. `releaseId`, `releaseName` and `revision` were added to it
   and to the destructure (lines 52-54, 224-236); they already arrived and already
   survived passthrough — they were simply dropped at the destructure.
8. `switch (event)`:
   - `onshape.revision.created` (line 252): requires
     `integration.data.updatedBy` (the acting user — the webhook itself is
     unauthenticated) plus `messageId`, `partNumber`, `documentId`, `versionId`,
     `elementId` and a numeric `elementType`, else warn and break (lines 260-274).
     Then `trigger("onshape-revision-sync", …)` when `assetSyncEnabled` (line 276),
     and `trigger("onshape-release-import", …)` when `releaseImportEnabled`
     (line 313) — release import additionally SKIPS when `releaseId` is missing
     (line 296) and SKIPS `elementType === 2` (drawings, line 300).
   - `onshape.workflow.transition` (line 331): deliberately nothing. The wrapper
     event is thin (a release-package objectId + a transition name); the
     per-element `revision.created` events are what Carbon acts on.
   - default (line 336): ack, logged only — covers `webhook.register`, pings, and
     anything unhandled.
9. Always `{ success: true }` for a well-formed authorized event so Onshape does
   not retry-storm (line 343).

## The three Onshape jobs

Registered at `packages/jobs/src/inngest/functions/integrations/index.ts:8-10`
and in the functions array at `packages/jobs/src/inngest/index.ts:153-155`.
Events are declared in `packages/lib/src/events.ts:523-574`, task keys in
`packages/lib/src/trigger.ts:23-25`. All three run on the service role
(`getCarbonServiceRole()`), so every query must carry `companyId` by hand.

### `onshape-backfill` (`onshape-backfill.ts:431`)

- `retries: 10`, `concurrency: { key: "event.data.companyId", limit: 1 }`. No
  idempotency key.
- Gate: `isOnshapeAssetSyncEnabled` (line 112) — `active && assetSyncEnabled === true`
  — checked OUTSIDE any step so flipping the toggle off kills an in-flight retry
  (line 452). The route `integrations.onshape.backfill.ts` re-checks the same flag
  before triggering.
- Onshape-driven and call-light: page the company's revisions, match locally, and
  spend export calls only on matches. Omit `after` for a full backfill; pass it for
  an incremental reconcile.
- Pagination follows Onshape's own `next` cursor, never an incremented offset —
  Onshape caps `offset` at 100 (`client.ts:309`, used at `onshape-backfill.ts:209`).
  `page.next` is authoritative for "more pages exist".
- `isObsolete` revisions are dropped (line 224).
- Resolution: models by one `.in("readableIdWithRevision", modelKeys)` query per
  page (line 256); drawings per row by shared-number ILIKE (line 287). Already-synced
  work is skipped without an Onshape call — models on `item.modelUploadId`, drawings
  on `itemHasPdfDocument` (line 170).
- Step granularity: one fast memoized step per page match, then ONE step per matched
  export+attach (`sync-page-N-item-M`). An `OnshapeAssetTooLargeError` returns
  `skippedTooLarge` instead of throwing (line 407). Five consecutive step failures
  abort the run (`MAX_CONSECUTIVE_FAILURES`, line 79).
- Fires `carbon/model-optimize` for every attached model and `carbon/model-thumbnail`
  only when the Onshape-rendered thumbnail did not stick.

### `onshape-revision-sync` (`onshape-revision-sync.ts:265`)

- `retries: 3`, `idempotency: "event.data.messageId"`,
  `concurrency: { key: "event.data.elementId", limit: 1 }`.
- Same `isOnshapeAssetSyncEnabled` gate, outside the step (line 281).
- LINK-ONLY: attaches to an item that already exists, never creates one.
- Resolution: the webhook gives a `revisionId`, not the revision LETTER, so the
  letter is re-resolved from `getRevisions(onshapeCompanyId, partNumber, elementType)`
  preferring the entry matching this event's `versionId` AND `elementId`, falling
  back to `versionId` alone (lines 92-108). Then
  `item.readableIdWithRevision === releaseKey(partNumber, revision)`
  (`.maybeSingle()`, line 188).
- Skip reasons: `unknown-element`, `no-matching-item`, `ambiguous-item`,
  `revision-not-found`, `asset-too-large` (permanent — a retry cannot shrink an
  export).
- The whole body is wrapped in `withRateLimitRetry`, which converts a 429 into an
  Inngest `RetryAfterError` honoring `Retry-After` (default 60 s, clamped to 300 s)
  — Inngest suspends the run instead of blocking the step
  (`onshape-backfill.ts:87`).
- The payload schema (line 252) does NOT include `releaseId`/`revision`, so zod
  strips the two extra fields the receiver sends.
- Export/download/attach live in `onshape-sync-element.ts` (translate → poll to
  DONE → download) and `onshape-attach.ts` (storage + `document`/`modelUpload`
  rows, "replace rather than append" by storage path). Raw model bytes are streamed
  to disk, never buffered.

### `onshape-release-import` (`onshape-release-import.ts:846`)

- `retries: 3`, `idempotency: "event.data.messageId"`,
  `concurrency: { key: "event.data.releaseId", limit: 1 }`.
- Gate: `getOnshapeReleaseImportSettings` (line 124) — `active && releaseImportEnabled === true`;
  mode is `"revision"` only on that exact string, anything else falls back to
  `changeNotice` (line 143).
- Skip reasons (line 47): `disabled`, `drawing-element`, `revision-not-found`,
  `no-matching-item`, `revision-already-imported`, `no-dispatcher`.
- Resolution (`resolveReleaseTarget`, line 206): all `item` siblings of the same
  `readableId` in this company, then
  - already-imported test spans **every** sibling, active or not (line 241) — an
    inactive draft revision still occupies `item_unique (readableId, revision,
    companyId, type)`, so ignoring it turns a re-release into a 23505 that rolls
    back the affected row and leaves an empty notice;
  - the SOURCE must be ACTIVE (line 250) — an inactive sibling is a draft revision
    owned by an open notice, and the affected-item picker filters inactive items out
    entirely, so a human could not build on one either;
  - ordering prefers NAMED revisions over the initial `''`/`'0'`, newest
    `createdAt` first (lines 253-260) — the same preference as the `latest_items`
    CTE and the BOM route's fallback.
- The revision LETTER and the Onshape-side NAME come from `getRevisions`
  (`resolveReleasedRevision`, line 277); on any non-rate-limit failure it falls
  back to the letter from the webhook and imports without the name. A
  `RetryAfterError` is rethrown so a rate limit stays a rate limit.
- A part number Carbon has never seen is SKIPPED as `no-matching-item`, not minted
  (line 443). Minting would land it with Carbon defaults (Inventory / Make) and
  poison MRP for purchased leaf parts. The BOM import wizard is the supported path
  for new parts.

**`revision` mode** (line 480): one `items_createRevision` with the Onshape letter,
`active: true`, no change notice. Additive, writes no supersession, reversible by
deactivating the item — which is why it, and not an auto-applied change notice, is
the "no review" option (`applyChangeNotice` drives four transitions to a terminal
`Done`, is not one transaction, and `itemSupersession`'s PK is `("itemId")` alone,
so a second release on the same predecessor would overwrite the first's successor
pointer — line 27-32).

**`changeNotice` mode** (line 529): one Draft change notice per Onshape release, one
affected item per released element, change type `Revision`, carrying Onshape's
letter. A human drives the normal Draft → Start → Engineering Complete →
Implementation → Done flow. The notice gets `assignee = payload.userId` (the
installer) because a Draft notifies nobody — only Start/Implementation/Done have
notification events (`changeNoticeStageEvent`, `items.server.ts:328`).
`NotificationEvent.IntegrationSync` is deliberately unused: it renders as
"Accounting sync needs attention" (`notifications/content.ts:1199`).
`reasonForChange` carries release provenance as tiptap JSON (`onshapeProvenance`,
line 708) — it is a rich-text column, so a plain string would not render.

**Grouping.** There is NO release-level Onshape event: a 9-element release arrives
as 9 separate `onshape.revision.created` deliveries in nondeterministic order with
no "release complete" signal. So `releaseId` is the grouping key and a marker row
in `externalIntegrationMapping` is the CLAIM: the first element to insert it creates
the notice; every sibling reads it and appends to the notice it names. Serialization
comes from the `releaseId` concurrency key. **No new table, no schema change.** The
claim is inserted IMMEDIATELY after the notice, before any affected item, so a
mid-run death retries into the existing notice (line 582); a `23505` on the claim
means a sibling won, and the loser re-reads and adopts that notice (line 604-623).

**Two error layers.** `unwrapDispatch` (line 106): `result.success` only says the
dispatch worked; the Supabase envelope inside carries its own error. Treating a
failed write as success would poison the release's marker so it could never be
retried.

**Same-part parallel notices are PERMITTED**, matching the UI — the one-open-CO-per-part
guard was dropped (`apps/erp/app/modules/items/AGENTS.md:89`). The UI also WARNS via
`ItemOpenChangeNoticeAlert`, so the job records prior open notices in
`metadata.openNoticeCollisions` (`findOpenNoticesForItem`, line 155;
`recordMarkerProgress`, line 763). That lookup queries notice STATUS, not
`item.active + changeOrderId` — `changeOrderId` survives release permanently and
cancelling a notice is a bare status flip, so the item-row shape would report
cancelled and released notices as in-flight forever.

### elementType — the numeric one

The webhook and the revisions API use a NUMERIC `elementType`
(`client.ts:60-62`); `OnshapeElementType` in `element.type.ts` is a separate STRING
enum used only as a `getElements` filter.

| Value | Element | Asset sync | Release import |
|---|---|---|---|
| 0 | Part Studio | GLTF → `modelUpload` on the matched item | affected item / revision |
| 1 | Assembly | GLTF → `modelUpload` on the matched item | affected item / revision |
| 2 | Drawing | PDF → a `document` on the MODEL item | **excluded** |

**Drawing rule.** A released drawing is its own `DRW-xxxx` element sharing the
number of the model it documents. Its PDF attaches to the MODEL item
(`PRT-xxxx`/`ASM-xxxx`) at the same revision and a `DRW-xxxx` item is NEVER created.
Matching strips the leading letter prefix to a shared suffix
(`sharedNumberSuffix`, `onshape-matching.ts:25`) and ILIKEs `%<suffix>`; the
suffix must start with a non-alphanumeric separator or it is unusable as an anchor
(`-002033` would otherwise match `PRT-1002033`), and LIKE wildcards are escaped
(`escapeLikePattern`, line 35). Exactly one match attaches; zero is
`no-matching-item`, more than one is `ambiguous-item`. Pure helpers, unit-tested in
`onshape-matching.test.ts`.

That same collision is why release import excludes `elementType 2`: a drawing
resolves to the SAME Carbon item as its model, so importing it would be a second
affected item violating `UNIQUE(changeOrderId, itemId)` on the first import of a
normal release — and deriving its change type from the `DRW-` readableId instead
would mint a junk part. The receiver filters it (line 300) and the job re-checks it
as a backstop (line 419).

## BOM import path

User-driven, separate from the webhook, and the only path that CREATES items.

- UI: `apps/erp/app/components/OnshapeSync.tsx`, rendered from the item's BoM
  explorer when `integrations.has("onshape")`
  (`modules/items/ui/Item/BoMExplorer.tsx:158`). Cascading document → version →
  assembly combobox (`onShapeDocuments` / `onShapeVersions` / `onShapeElements`),
  then Load BOM, then Save.
- `integrations.onshape.d.$did.v.$vid.elements.ts` filters to
  `OnshapeElementType.ASSEMBLY` at a VERSION (`wvm: "v"`), so only assemblies are
  offered.
- `integrations.onshape.d.$did.v.$vid.e.$eid.bom.ts` — the loader. Flattens
  Onshape's `headers`/`rows` into named columns, unwrapping object-valued columns
  via `displayName` (line 76), then resolves each row to a Carbon item by
  `readableIdWithRevision` in one `.in()` query (line 106). Rows with no match
  fall back to `Purchasing Level === "Purchased" ? Buy : Make` (line 210).
- **Phase 1 revision-aware fallback** (commit `20faf4496`, `bom.ts:126-206`):
  Onshape stamps revisions only on RELEASED versions, so a row from an unreleased
  version carries an empty `Revision` and can only exact-match a revision-`0`
  item. Before the fix the sync built a complete parallel item tree at revision
  `''` and repointed the parent's make method at it, orphaning the real revision's
  children silently. Now a bare-revision row with no exact match falls back to the
  LATEST existing revision of the same `readableId` (named revisions before the
  initial one, newest wins the tie), resolved with one `.in()` for all bare ids.
- `integrations.onshape.sync.ts` — the action. Validates rows with
  `onShapeDataValidator`, invokes the `sync` edge function with `type: "onshape"`,
  then replaces the item's `entityType: item / integration: onshape` mapping row
  (delete via service role, insert via the user client — the RLS note below).
- `packages/database/supabase/functions/sync/index.ts` `case "onshape"` (line 175)
  — the writer, inside one Kysely transaction. Finds or creates a Draft
  `makeMethod` for the top level, deletes and rebuilds `methodMaterial`, and walks
  the BOM tree. The same commit made three fixes here: revision `''` normalizes to
  `'0'` (line 405); a MATCHED item gets the Onshape-owned fields written
  (`name`, `description`) while Carbon-owned fields (tracking type, replenishment
  system, UoM) are left alone; a NEW item whose `readableId` already has siblings
  is created as a faithful copy of the latest sibling — `createRevision`'s field
  set, conditional spreads so a NOT NULL column never receives an explicit null —
  and the sibling's `methodOperation` rows are copied onto the trigger-created make
  method. The type-table (`part`) row is shared by the revision family, so it is
  inserted only for Parts.

## `externalIntegrationMapping` usage

Two integration values and three shapes, all on the one table
(`20260128140000_external-integration-mapping.sql`):

| `entityType` | `integration` | `entityId` | `externalId` | `metadata` | Written by |
|---|---|---|---|---|---|
| `item` | `onshape` | Carbon item id | null | `{ documentId, versionId, elementId }` | `integrations.onshape.sync.ts:75`; read by `OnshapeSync.tsx:74` to restore the picker + `lastSyncedAt` |
| `item` | `onshapeData` | Carbon item id | `readableIdWithRevision` | the raw Onshape BOM row | the `sync` edge function (lines 446, 601); read by `BoMExplorer.tsx:521` for the Onshape State badge |
| `onshapeRelease` | `onshape` | `releaseId` | `releaseId` (same value) | `{ changeNoticeId, claimedByMessageId, documentId, versionId, releaseName, importedAt, items[], openNoticeCollisions? }` | `onshape-release-import.ts:582` |

`UNIQUE (entityType, entityId, integration, companyId)` is what makes the release
marker a claim. The partial `UNIQUE (integration, externalId, entityType, companyId)
WHERE allowDuplicateExternalId = false` is what the `onshapeData` upserts conflict on.

**RLS: SELECT and INSERT policies only, no UPDATE and no DELETE**
(`20260204001831_external-integration-mapping-rls.sql`). A PostgREST UPDATE from a
user-scoped client matches zero rows and returns `{ data: [], error: null }` — no
error, no signal. Every marker mutation in the release import therefore runs on the
service role, and the BOM sync route deletes the old mapping through
`getCarbonServiceRole()`.

## Gotchas

- **Revision `0` / `''` / NULL all collapse to "no revision."**
  `item.readableIdWithRevision` is `GENERATED ALWAYS AS (COALESCE(readableId || CASE
  WHEN revision = '0' THEN '' WHEN revision = '' THEN '' ELSE '.' || revision END,
  readableId)) STORED` (`20250519122022_revisions.sql:2`), and
  `releaseKey`/`getReadableIdWithRevision` mirror it. A numeric Onshape revision
  scheme is therefore ambiguous at revision `0`: it produces the same match key as
  an unrevised item while remaining a DISTINCT value in `item.revision` and in
  `item_unique`. That is why `resolveReleaseTarget` compares the RAW `revision`
  column, not the generated one (`onshape-release-import.ts:241`).
- **`getNextRevision` does not converge on every Onshape label.** It only advances
  pure digits or 1–2 uppercase letters; anything else is returned UNCHANGED
  (`items.service.ts:263-280`). An Onshape label like `A2` would be handed straight
  back and collide on `item_unique`, so the Onshape letter is passed EXPLICITLY into
  `items_addChangeNoticeAffectedItem` / `items_createRevision` instead of letting
  Carbon derive it.
- **These jobs run on the service role — RLS gives no tenancy backstop.** Every
  `.from(...)` in the three job files must carry `.eq("companyId", …)` by hand, and
  the mapping/marker helpers all do.
- **`getOnshapeClient` does a read-modify-write of the whole `metadata` column on
  token refresh** (`client.ts:633-649`): it reads `metadata`, spreads it, and writes
  the merged object back. Two concurrent Onshape functions for one company each read
  the pre-refresh metadata and each write their own tokens — last write wins, and
  the loser's refresh token has already been consumed. A concurrent settings save
  can also lose whatever the refresh wrote. There is no locking; the per-job
  concurrency keys (`companyId` for the backfill, `elementId`/`releaseId` for the
  others) do not serialize ACROSS jobs.
- **`createdBy` must be passed explicitly to `items_createRevision`.** Its service
  parameter is literally named `args`, and the MCP direct executor's
  `paramName === "args"` branch pushes the payload through WITHOUT
  `enrichWithAuthContext` (`direct-executor.ts:225-229`), so the declared
  `injectAuth` is silently skipped and the item insert fails on `createdBy`'s NOT
  NULL constraint. The same is true of any other service whose param is named
  `args` (a separately-logged defect affecting many tools). `injectAuth` also never
  includes `userId`, which is why `addChangeNoticeAffectedItem` gets an explicit
  one.
- **`items_addChangeNoticeAffectedItem` does not return `newItemId`.** It writes
  `newItemId` onto the `changeOrderAffectedItem` row but returns only
  `{ id, draftMakeMethodId }` (`items.service.ts:6299-6304`). The release import
  therefore READS IT BACK off `changeOrderAffectedItem` by the returned affected-item
  id before writing Onshape's attributes; without that read-back
  `applyOnshapeAttributes` silently never runs on the change-notice path and the
  draft revision stays a byte-for-byte copy of its base, which renders as the
  literal "No changes yet." empty diff.
- **`applyOnshapeAttributes` is a narrow two-column `item` update, not
  `items_updateItem`** (`onshape-release-import.ts:733`): that service runs the
  payload through `sanitize()`, which turns a present-but-undefined key into null,
  and its schema requires `name` + `replenishmentSystem`.
- **The job's `CHANGE_NOTICE_OPEN_STATUSES` is a deliberate duplicate** of
  `changeNoticeOpenStatuses` in `apps/erp/app/modules/items/items.models.ts`
  (`onshape-release-import.ts:75`) — `packages/jobs` cannot import `~/modules`. Keep
  them in sync.
- **`no-dispatcher` is a real runtime state.** `getWorkflowDispatch()` is filled
  lazily by the ERP on the first request to `/api/inngest`
  (`setWorkflowDispatch`, `packages/jobs/src/workflows/actions/dispatcher.ts:30`);
  before that the release import throws rather than half-importing.
- **A forged webhook matters more now.** Asset sync could not inject content (the
  job re-resolves everything against the Onshape API), but release import creates
  Draft change notices and the callback path is enumerable. Fail-open on an absent
  secret is what keeps existing customers byte-identical; a company that cares sets
  `webhookSigningSecret`.
- **`state` on the OAuth callback is checked for presence only** (`oauth.ts:94`) —
  it is not compared against anything stored.
</content>
</invoke>
