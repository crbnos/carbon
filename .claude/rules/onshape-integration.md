---
paths:
  - packages/ee/src/onshape/**
  - packages/jobs/src/inngest/functions/integrations/onshape-*.ts
  - apps/erp/app/routes/api+/integrations.onshape.*.ts
  - apps/erp/app/routes/api+/webhook.onshape.$companyId.ts
  - apps/erp/app/components/Onshape*.tsx
  - apps/erp/app/hooks/useOnshape.ts
  - apps/erp/app/hooks/useItemSources.ts
  - apps/erp/app/hooks/useOnshapeImportStatus.tsx
  - apps/erp/app/modules/items/ui/Parts/onshapePartSource.ts
---

# Onshape Integration

One-way ingest from Onshape (CAD/PLM) into Carbon: released CAD models and
drawing PDFs onto items, released revisions into engineering data, and BOM
import. Nothing is ever pushed back to Onshape except translation (export) jobs
and webhook management.

**ONE integration, one pipeline.** The older part-number-matching pipeline is
gone — its jobs, routes, settings, UI panel and the `pipeline` key that selected
it were all deleted. Anything you find describing "legacy vs v2", an
`onshape-v2` record, or `metadata.pipeline` is stale.

Two facts define everything else:

- **Carbon items are joined to Onshape by ID**, in hidden
  `externalIntegrationMapping` rows — never by matching a part-number string
  against `readableIdWithRevision`. A renamed part, a lowercase number, or two
  parts sharing a number cannot silently merge or mismatch.
- **Released revisions only.** Onshape stamps a revision on release and only on
  release, and everything downstream is keyed on it. An unreleased version is
  refused at the BOM preview, at the import route, and again in the job. There
  is no setting for this.

## The identity model

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
  geometry on revision C's item (`onshape-assets.ts:3-8`).
- The inverse is equally a bug: treating two revisions of one part as a
  COLLISION. `EL-402.A` and `EL-402.C` both claiming one element is correct, not
  a conflict — the link route only refuses a competing claim at the SAME revision
  (`integrations.onshape.link.ts:132-181`), and the create route distinguishes
  "this exact revision is already here" from "a different revision of this part
  is already here" (`integrations.onshape.create.ts:137-178`).

Both mistakes were made repeatedly during the rebuild. Any new code path that
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
  marker is written by the dispatching ROUTE — `create`'s import branch and
  `import` — and closed by the job, which is safe because the job only ever
  rewrites element mappings for rows it ADOPTS or MINTS, never for the top-level
  item.
- Every WRITE takes the SERVICE ROLE, and the parameter is named `serviceRole` to
  make a wrong client obvious at the call site (see the RLS note below).

## Package (`@carbon/ee/onshape`)

One export subpath, `./onshape` → `src/onshape/lib/index.ts`
(`packages/ee/package.json:17`); it re-exports `bom`, `client`, `data`,
`document.type`, `element.type`, `mapping`, `reconcile`, `replenishment`, `resolve`, `token`,
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
- `lib/settings.ts` — the settings resolver plus `onshapeWebhookWanted`. Pure
  half (`parseOnshapeSettings`) is unit-tested without a database.
- `lib/mapping.ts` — the identity contract above. Pure half kept free of heavy
  imports (no auth/inngest/env at module load) so it stays testable.
- `lib/bom.ts` — Onshape BOM response → rows with their CAD identity intact, the
  tree builder, and `resolveBomRow`. Verified against a live response (RD-410,
  8 rows, 26 headers).
- `lib/reconcile.ts` — plans the change to one make method's material list.
- `lib/resolve.ts` — re-resolves a client-supplied selection against Onshape.
- `lib/replenishment.ts` — Buy vs Make. Its own subpath; see that section.
- `lib/token.ts` — `onshapeTokenExpiresAt`. Env-free so it is testable, which
  `client.ts` is not.
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
the element's NAME.

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
  reconnect wiped every saved setting the company had. The
  settings save merges the same way (`{ ...existingMetadata, ...formData }`,
  `integrations.$id.tsx:1399`); that merge is SHALLOW, which is why clearing the
  signing-secret field stores `""` rather than removing the key.
- No webhook is registered on connect (`oauth.ts:176-181`) — every consumer is
  off by default, so there is nothing to subscribe for.
- `expiresAt` is `onshapeTokenExpiresAt(expires_in)` at BOTH write sites — what
  Onshape returned, minus a 120 s margin, falling back to an hour only when the
  field is genuinely absent. Both sites used to hardcode now + 3600 s and discard
  `expires_in`, so a shorter-lived token was believed valid long after Onshape
  had stopped accepting it and no refresh was ever attempted. The margin is
  separate and also load-bearing: expiry is checked at the START of a call, so a
  token with four seconds left passes the check and dies in flight.
- A connection authorized before `OAuth2Write` was requested holds a read-only
  token, and a refresh cannot widen it (the refresh grant sends no scope) — only a
  reconnect can. `onshapeConnectionHasWriteScope` reads the captured `scope` and
  treats a missing field (installs predating it) as read-only. The settings save
  forces the asset toggle back off and tells the user to reconnect.

## Settings — four keys

Declared in `config.tsx`, validated by `onshapeSettingsSchema`
(`lib/settings.ts`). `SwitchField` posts the literal strings `"true"`/`"false"`,
so every switch uses an explicit `z.preprocess` — `z.coerce.boolean()` would
make `"false"` truthy.

Flat: no groups, no `visibleWhen`, nothing conditional. There is one
implementation, so there is one list.

| Setting | Type / default | Gates |
|---|---|---|
| `attachAssetsOnRelease` | switch, `true` | whether `onshape-release` pulls the model on a release. It does NOT gate the BOM import or the create/link flows — those always pull, which is what the setting's own description promises |
| `releaseImportMode` | options, `"changeNotice"` | `off` / `changeNotice` / `revision` — what Carbon does with the engineering data in a release |
| `createItemsOnRelease` | switch, `false` | whether a released element with NO linked Carbon item is created rather than refused. Read strictly `=== true` — copying `attachAssetsOnRelease`'s "absent means on" reading would start minting parts for every existing install on deploy |
| `webhookSigningSecret` | text, `""` | opt-in HMAC verification in the receiver; empty = verification skipped. VAULTED, so it never reaches the metadata column |

- Every key is `.optional()`, never `.default()`. The save merges the parsed
  result over the stored metadata, so a default would rewrite a stored setting on
  any save that did not render the field. Absent means "leave it alone"; the
  parser supplies defaults on read, which is the only place they belong. Pinned
  by `lib/settings.test.ts`.
- `webhookSigningSecret` is declared `text`, NOT `password`/`secret`, matching the
  paperless-parts precedent. Both masked types render a `<Password>` input and
  nothing in `IntegrationForm` sets `autoComplete`, so a browser password manager
  silently autofills them — observed writing a saved password into this field on
  save, which would then make the receiver reject every genuine Onshape delivery.
  Masking buys nothing now that the value is vaulted and never sent to the
  browser; a silently wrong value costs webhook ingestion. Onshape's signing keys
  are company-level, not per-webhook.
- `parseOnshapeSettings` accepts booleans AND the form's `"true"`/`"false"`
  strings, and falls back to the DEFAULT for anything else — an unrecognised
  value must never silently enable a behaviour.
- `readFailed` is the third state, distinct from "absent" and "inactive": a QUERY
  ERROR. Every writer treats it as retryable — a transient database error must
  never masquerade as an opt-out and turn a real import into a silent no-op. Jobs
  throw on it; routes answer "try again", never "Onshape is not connected".
- Every job re-reads the gate on EVERY execution, outside its step, so
  disconnecting Onshape kills an in-flight retry.
- `x+/_layout.tsx` projects the integrations list to `{ id, active, companyId,
  updatedAt, updatedBy }` — no `metadata` at all. The raw view returns metadata
  verbatim, which holds provider configuration; returning it serialised that into
  the HTML of every authenticated page. `useOnshape` reads `active` and nothing
  else.

**There is no `allowUnreleasedSync`, and there never should be again.** Onshape
stamps a revision only on release; an unreleased version has no revision to key
on, no released asset to pull, and nothing stable to re-resolve against when it
moves. `selectReleaseTarget` matches the revision letter against `item.revision`,
`releaseKey` maps Onshape's number/revision 1:1 onto `readableIdWithRevision`,
and `item_unique` is on the raw revision column. The refusal is unconditional in
three places: the BOM preview route, the import route, and the job.

Migration `20260824120000_onshape-element-id-join.sql` rewrites the `onshape`
row's `integration.jsonschema` to these four keys, which
`sync_verify_integration()` validates `companyIntegration.metadata` against when
`active = TRUE`. `credentials.required` stays `["type"]` — the tokens live in
Supabase Vault and are stripped from the column, so requiring them here would
reject every write to an active row. Data-only, and no onshape jsonschema has
ever set `additionalProperties`, so a row still carrying a retired key
(`assetSyncEnabled`, `releaseImportEnabled`, `pipeline`, `allowUnreleasedSync`)
continues to validate. Those keys are inert; nothing reads them.


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
- `ensureOnshapeReleaseWebhook(companyId, wanted)` is register-or-deregister,
  called ONLY from the integration settings save. `wanted` is
  `onshapeWebhookWanted(settings)` — `attachAssetsOnRelease ||
  releaseImportMode !== "off" || createItemsOnRelease`. All three, because ONE
  subscription feeds every consumer: omitting `createItemsOnRelease` deletes the
  subscription of a company that turned auto-create on and everything else off,
  while flashing success. It exists while ANY consumer is on and is deleted only
  when all are off. A failed registration while `wanted` is a hard, flashed
  error; the settings are already saved by then.
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
3. **Consumer gate** — `onshapeWebhookWanted(parseOnshapeSettings(metadata))`,
   BEFORE the body is read, so a company that has opted into nothing pays almost
   nothing per delivery. Defense in depth: if a deregister failed when the
   consumers were turned off, the subscription can linger, and dropping is the
   right answer rather than dispatching. None enabled → log and ack `200`.
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
     Then ONE `trigger("onshape-release", …)` carrying
     `groupKey: releaseId ?? elementId`. One job for the whole event because a
     separate asset job would race the import that creates the item it needs to
     attach to; the job owns the policy (which consumers are on, what to do with
     a drawing) so the receiver stays a router. The `groupKey` falls back to the
     element so a releaseId-less delivery gets its own bucket rather than sharing
     one with every other company's.
   - `onshape.workflow.transition` (line 390): deliberately nothing. The wrapper
     event is thin (a release-package objectId + a transition name); the
     per-element `revision.created` events are what Carbon acts on.
   - default (line 395): ack, logged only — covers `webhook.register`, pings, and
     anything unhandled.
10. Always `{ success: true }` for a well-formed authorized event so Onshape does
    not retry-storm (line 402).

Routing, gating and signature behaviour are pinned by
`webhook.onshape.$companyId.test.ts`.

The signing secret is VAULTED, so the receiver resolves it through
`resolveIntegrationSecrets` rather than reading `metadata`. A vault read that
FAILS is not the same as "no secret configured" — we cannot tell whether this
company requires a signature, so it answers `503` (Onshape retries) rather than
processing unverified or dropping the event with a `200`.

## The Onshape jobs

Registered at `packages/jobs/src/inngest/functions/integrations/index.ts:9-13`
and in the functions array at `packages/jobs/src/inngest/index.ts:156-160`.
Events are declared in `packages/lib/src/events.ts:523-621`, task keys in
`packages/lib/src/trigger.ts:23-28`. All of them run on the service role
(`getCarbonServiceRole()`), so every query must carry `companyId` by hand.
| Job | Retries | Idempotency | Concurrency key |
|---|---|---|---|
| `onshape-release` | 10 | `event.data.messageId` | `event.data.groupKey` |
| `onshape-bom-import` | 10 | — | `event.data.companyId` |
| `onshape-item-assets` | 10 | — | `event.data.itemId` |

Three jobs, and the older `onshape-backfill`, `onshape-revision-sync` and
`onshape-release-import` are gone with the part-number join they were built on.

### `onshape-release`

The whole `onshape.revision.created` event: attach the released
geometry, and bring the release into engineering data when configured to. Doing
both here, in order, is the point — for a NEW revision the target item does not
exist until the import creates it, so a parallel asset job resolves
`revision-missing` and the model never lands.

- Gate: `getOnshapeSettings`; `readFailed` throws, `!active` returns
  `{ pipelineSkipped: true, reason: "integration-not-installed" }`.
- `elementType === 2` returns `drawing-element` (line 105). v1 attaches a
  drawing's PDF by stripping the number to a shared suffix, which is disproved on
  real data — RD-410, DRW-410 and PK-410 all reduce to `-410`, matching five items
  across two parts. Until a mapping-based mechanism exists, it refuses rather than
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
- No target and `releaseImportMode !== "off"` → delegate to
  `runOnshapeReleaseImport` with `gate: { enabled: true, mode }` (lines 245-279).
  The family's `readableId` is derived from the mapped items and must be
  unanimous; two different numbers behind one element is reported as ambiguous
  rather than resolved by whichever row came back first.
- After an import, the created item is RE-RESOLVED and then LINKED —
  `writeElementMapping` plus `writeRevisionMapping` (lines 290-325). Without the
  re-resolve the attach never runs, and `items_createRevision` copies the source
  revision's `modelUploadId` and `thumbnailPath`, so the new revision would not
  merely lack geometry: it would silently display the PREVIOUS revision's,
  presented as the released one. Without the link, Carbon stays blind to what it just
  created.
- A part is minted from a release ONLY when `createItemsOnRelease` is on.
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

### `onshape-release-import` (`onshape-release-import.ts`) — the change notice path

Not an Inngest function. A library called by `onshape-release` once the release
target is resolved, so it inherits that job's retries and its
`groupKey`/`limit: 1` concurrency rather than racing itself.

`releaseImportMode` picks between three behaviours:

- `off` — nothing beyond the asset attach.
- `changeNotice` (the default) — one Draft change notice per release PACKAGE,
  one affected item per released element.
- `revision` — `items_createRevision` immediately, the same call the manual
  "New Revision" button makes. `createdBy` is passed EXPLICITLY: when a
  service's parameter is literally named `args` (as `createRevision`'s is), the
  MCP direct executor skips `enrichWithAuthContext`, so the declared
  `injectAuth` never runs and the insert fails on `createdBy`'s NOT NULL. The
  Onshape letter is passed explicitly too — `getNextRevision` returns its input
  unchanged for anything that is not pure digits or one-to-two uppercase
  letters, so a label like `A2` would be handed straight back and collide on
  `item_unique`.

**Nothing is auto-applied, on purpose.** `applyChangeNotice` drives four status
transitions into a terminal `Done`, is not one transaction, and
`itemSupersession`'s primary key is `("itemId")` alone — a second release
against the same predecessor silently overwrites the first's successor pointer.
Direct revision creation is additive, writes no supersession, and is reversible
by deactivating the item.

**Grouping: there is no release-level Onshape event.** A nine-element release
arrives as nine separate `onshape.revision.created` deliveries, in
nondeterministic order, with no completion signal. `releaseId` is the grouping
key, and a marker row in `externalIntegrationMapping`
(`entityType: "onshapeRelease"`, `externalId: releaseId`) is the claim:

- The first element to insert the marker creates the notice; every sibling reads
  the marker and appends to the notice it names.
- The claim is written BEFORE the first affected item, so a run that dies
  mid-way retries into its own notice instead of opening a second.
- A `23505` on the claim means a sibling won — re-read the marker and adopt its
  notice. A marker that names no notice is a hard error, not a fallback.
- `recordMarkerProgress` appends each element's outcome, including any open
  notices that already touched the item. Carbon permits parallel notices on one
  part, and the UI warns via `ItemOpenChangeNoticeAlert`; a headless import has
  no such surface, so the collisions go on the marker.

What the notice carries:

| Field | Value |
| --- | --- |
| `name` | `Onshape release {package name}` — read off the package, which is authoritative; the webhook's `releaseName` is a fallback, then `releaseId` |
| `type` | `Engineering` |
| `assignee` | `payload.userId`, i.e. `companyIntegration.updatedBy`. An auto-created Draft notifies NOBODY — `changeNoticeNotifyStages` (`items.models.ts`) is Start/Implementation/Done only — so the assignee is the only thing that puts it in a human's queue. `NotificationEvent.IntegrationSync` is deliberately not used; its fallback title reads "Accounting sync needs attention" |
| `reasonForChange` | the release notes written in Onshape, as tiptap JSON. Falls back to the generated provenance sentences when the release has none: an empty reason is a regression against v1, not a neutral change |
| `sourceType` / `sourceId` | `onshape` / the release id. Both columns have existed since the change-order migration and were never written by anything; this is the first caller, and using them is what frees `reasonForChange` for the releaser's own words |

Affected items use `changeType: "Revision"` — `Version` would mean "same part
number, structure differs", which needs a BOM comparison this does not do.

**Two live-run defects the code now works around** (both reproduced 2026-08-21,
both invisible in synthetic testing):

- `addChangeNoticeAffectedItem` returns only `{ id, draftMakeMethodId }`; it
  WRITES `newItemId` onto the affected-item row but does not return it. Read it
  back, or `applyOnshapeAttributes` never runs and the draft revision stays a
  byte-for-byte copy of its base — which is exactly the "No changes yet." empty
  diff.
- The affected item copies the base revision's method and nothing re-read
  Onshape's BOM, so a release that changed a quantity produced a notice showing
  the OLD quantities while the geometry on the same item updated correctly.
  RD-410 C→D with PK-410 and MC-101 both bumped 1→2 yielded a draft D whose BOM
  still read 1 and 1. The importer now dispatches `onshape-bom-import` into
  `draftMakeMethodId` with `allowChangeNoticeDraft: true` — the ONLY caller
  permitted to write into a method a change notice owns, which is why that
  permission is an explicit flag and not a resolver heuristic. Assemblies only
  (`elementType === 1`); a Part Studio body has no BOM. Dispatched rather than
  awaited: losing the structure refresh is worse than losing the whole notice to
  a 429.

Skips, all idempotent by construction:

- `no-matching-item` — a release naming a part Carbon has never seen is a
  CREATION, not a change, and never becomes a notice. Minting here would land it
  with blanket Inventory/Make defaults and poison MRP for purchased leaf parts;
  `createItemsOnRelease` handles that case in `onshape-release` instead.
- `revision-already-imported` — a redelivery, a retry, or a genuine re-release.
  Skipping beats a `23505` on `item_unique`, which would roll back the affected
  row and leave an EMPTY notice behind a marker claiming success.
- `drawing-element`, `revision-not-found`, `disabled`, `no-dispatcher`.

`unwrapDispatch` exists because a dispatched service call has TWO error layers:
`result.success` only says the dispatch worked, and the Supabase envelope inside
carries its own error. Treating a failed write as success poisons the release's
idempotency marker so it can never be retried.

Which revision letter a delivery is about lives in `onshape-release-revision.ts`
— **the webhook does not carry the letter**, which was assumed for most of this
integration's life. `revisionId` is carried and identifies the revision on its
own (`GET /api/v10/revisions/{revisionId}`). Resolution is event first, API
second, so a caller that already knows the letter pays for no call.

### `onshape-bom-import` (`onshape-bom-import.ts:383`)

User-initiated from a specific make method. Replaces the older `sync` edge
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
  `methodMaterialStep` children survive because they are never named. A writer
  that deletes every row and re-inserts — as the older one did — makes "keep the
  BOP" impossible.
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
  item. Resolving a child method whenever the item is Make — as the older writer
  did — empties a hand-built BOM on a part Onshape reports as a leaf.
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

### `onshape-item-assets` (`onshape-item-assets.ts:33`)

Pulls the model for ONE already-linked item. The create and link routes queue it;
without it an item created from a released revision arrives with no geometry while
the same part imported through a BOM arrives with it — same pipeline, two results,
decided by which button was pressed. A job rather than inline work because an
export is a translate-poll-download round trip: minutes in the worst case, and
rate-limitable.

### Shared asset machinery

`onshape-assets.ts` never answers "which Carbon item is this" — callers resolve
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
  exporter, taking `partIds` and `configuration`. Omitting `configuration` exports the element's
  DEFAULT, which for a configured part is a different shape from the one the BOM
  line names.
- `attachOnshapeAssetsToItem` (`onshape-attach.ts:184`) now writes
  `item.modelUploadId` as a COMPARE-AND-SET on the `priorModelId` this run read
  (`:388-409`), and throws when it matches zero rows. An unconditional update let a
  concurrent attach lose its model to an orphaned row. `eq(column, "")` does NOT
  match SQL NULL, so the no-prior-model case uses `.is(…, null)`.

## The routes

All under `apps/erp/app/routes/api+/integrations.onshape.*.ts`, paths in
`utils/path.ts`. Shared shape:

- Permission is on **parts**, not settings (`view` for loaders, `create`/`update`
  for writes). The Onshape connection and its settings are then read with the
  SERVICE ROLE — reading them with the user's client silently requires
  `settings_view` on top, and the token refresh it triggers silently fails
  without `settings_update`.
- `settings.readFailed` → "Could not read the Onshape settings just now. Try
  again." Wording a transient error as a configuration state sends the user to
  change a setting that was never wrong — and re-saving it re-registers the
  webhook.
- `!settings.active` → refused.
- `getOnshapeClient` is narrowed on `.client`, never on `.error`: the union is
  `{client, error: null} | {client: null, error: string}` and `""` is a valid
  falsy error string.

| Route | Verb | Does |
|---|---|---|
| `revisions` | loader | every released revision in the Onshape company, drawings and obsoletes excluded, each with its `externalId` and a `linked` flag. Pages on Onshape's `next` cursor, `MAX_PAGES = 20`, and REPORTS `truncated` |
| `replenishment` | loader | Buy or Make for ONE released element, from its Onshape "Purchasing Level" — see the Buy vs Make section. Answers the structural guess on any failure rather than erroring |
| `bom` | loader | the BOM preview: per row, `update` / `create-revision` / `create` / `ambiguous`, plus `skipped`/`orphaned` counts and a summary |
| `create` | action | create a Carbon part from a released revision, from the whole New Part payload, and queue its BOM import when the element is an assembly |
| `link` | action | link an EXISTING Carbon item to a released revision |
| `import` | action | validate, link the target item, and queue `onshape-bom-import` |

There is no `documents` / `versions` / `elements` drill-down any more. Those
three routes existed only to feed the unreleased-version picker; releasing is now
the only way in, and the released picker reads the company revision catalog
instead.

Note for anyone re-adding an element listing: an Onshape element's **NAME** and
its **PART NUMBER** are different fields and diverge freely — an assembly named
"RD-410 Wandleser RFID" can carry part number TB-900. `getElements` returns only
the name. The part number is what becomes the Carbon item, so it is what the user
has to be choosing; read it from `getElementMetadata`, preferring Onshape's stock
property id `57f3fb8efa3416c06701d60f` over the localised name `"Part number"`.
Metadata is one request per element, so cap the fan-out and report it.

### `create` and `link` refusals

- The Onshape half of the payload is IDENTITY ONLY. Nothing the client sends about
  the part itself is persisted: `resolveOnshapeRevision` (`lib/resolve.ts:57`)
  re-fetches the revision from Onshape and requires `revision`, `documentId`,
  `versionId`, `elementId` and `partId` to ALL agree, then the route writes
  Onshape's own values. Matching on revision alone would accept a selection whose
  document/element had been swapped for another part's. Refusals:
  `drawing-element`, `revision-not-found`, `obsolete`, `lookup-failed`; a 429 is
  rethrown untouched.
- `create` refuses BEFORE creating anything if the CAD thing already has a
  Carbon item, and distinguishes "this exact revision is already in Carbon" (via
  the revision mapping) from "another revision of this part is already here" (via
  the element mapping). Conflating them produces a message that is simply wrong: a
  company that has released A, B and C has three picker entries per part sharing
  one elementId.
- `create` takes the WHOLE New Part payload from the form —
  `partBaseValidator` minus `id`/`revision`/`name`/`readableId`/`modelUploadId`,
  with the storage and shelf-life refines still applied. Those identity fields
  are OFF the schema entirely rather than accepted and ignored, so a hand-posted
  number cannot be persisted. `customFields: setCustomFields(formData)` comes
  along, as on the ordinary new-part action. There is NO `importBom` on the
  schema — see below.
- `create` RE-READS the created item by `(readableId, revision, companyId,
  type)` instead of trusting what `upsertPart` returned. That function's insert
  branch finishes with a lookup against the `parts` VIEW, which is
  `DISTINCT ON (readableId, companyId)` ordered so a NAMED revision sorts first —
  so creating `ABC` rev `0` beside an existing unlinked `ABC` rev `A` succeeds
  and hands back rev A's id, and both mappings plus the asset pull would land on
  the wrong item. When the re-read finds nothing the route refuses the LINK and
  says so, rather than mapping a row it cannot identify.
- **Whether to import the BOM is decided by the ROUTE**, from the element type
  Onshape's own response carried — an assembly has a bill of materials, a Part
  Studio body does not, and there is no third answer. The client does not send a
  flag, so a hand-posted request can neither queue an import whose first act is
  to fail nor skip a real assembly's structure. Permission is soft-checked with
  `getUserClaims` for `update` + `delete` on parts; NOT a second
  `requirePermissions`, which THROWS a redirect on denial and would bounce a
  create-only user off the page without the part they asked for. That refusal
  comes back on its own `notice` field, because the caller cannot otherwise tell
  "refused" from "this element never had one" — both report
  `importQueued: false`.
- **Exactly one asset path runs per creation.** When the BOM is imported the
  route queues `onshape-bom-import` against the item's auto-created Draft
  `makeMethod` and SKIPS `onshape-item-assets` — the import job pulls the
  top-level item's own model itself, and running both double-exports one element
  against a rate-limited API while `attachOnshapeAssetsToItem`'s compare-and-set
  files the loser's model away as a document. Whichever path runs, the route
  opens the PROGRESS MARKER before dispatching, so the create modal has something
  to wait on.
- `link` requires `confirmOverwrite` and is destructive by consent on the fields
  Onshape owns — currently the NAME only, written as a narrow two-column update
  rather than `items_updateItem` (which sanitises undefined keys to null and
  requires fields this caller has no business supplying). The part NUMBER is never
  touched: once the mapping exists the number is a label, and rewriting
  `readableId` would break every document, PO and job that renders it. A
  `numberMismatch` is returned so the UI can say so.
- `link` reports a HALF-MADE link: if the element mapping is written and
  `writeRevisionMapping` then fails, the user is told, because otherwise they are
  told the link is complete when its provenance half is missing.
- `import` requires `update` + `create` + `delete` on parts — the job mints
  parts and deletes material lines, so asking only for `update` let the route do
  more than the permission it checked. It re-checks the same four refusals the job
  makes (not Draft, CO-owned, unreleased-into-a-named-revision, PLM lock) so the
  user sees them immediately: the job's refusal throws inside a step on a function
  declared `retries: 10`, so a deterministic refusal the route did not catch is
  retried eleven times and then dies in the job log while the user was told
  "Import started".
- `import` writes the target item's element mapping ITSELF, for every import,
  not only when a part number came along — an assembly with no Onshape part number
  is still importable, and gating the link on it left the top-level item the one
  thing in the tree joined by nothing. When a revision IS named it is verified
  through `resolveOnshapeRevision` first; a named revision with no part number is
  refused, since there is nothing to check the claim against.

## The UI

- `useItemSources` — the registry the source picker renders. One row per system
  a part can be created FROM (`{ id, name, Wordmark }`), filtered by
  `useIntegrations().has(id)`. Onshape is the only row today; a second CAD/PDM
  integration joins the New Part form by adding one, not by branching the form.
  The filter is presentation only — every create route re-reads the connection
  server-side and refuses a company that never connected, so an empty list is
  never what keeps a source off a company.
- `PartsTable` — one wordmark button per connected source, each a LINK to
  `${path.to.newPart}?source=<id>`, not a modal. The `OnshapeCreatePart` modal it
  used to open was deleted: it re-implemented three fields the New Part form
  already has and could not reach the other twelve, and the two surfaces had
  already diverged on how they seeded replenishment.
- `PartForm` — owns the create-from-a-source flow, behind an explicit
  `withItemSources` prop (never inferred from `type`: the three inline-create
  callers in `components/Form/{Part,Item,Items}.tsx` read a PostgrestResponse
  back and would break if this form could redirect them). `defaultSourceId` opens
  one on mount and is what `?source=` feeds. `source === null` is the blank part,
  and clicking the picked wordmark a second time returns to it. Picking Onshape
  renders `OnshapeRevisionSearch` INLINE, in the modal the user is already
  filling in — the old nested picker-modal hid the form behind a dialog opened to
  choose one value.
- **Exactly two fields are frozen under a selection: Part ID and Revision.** Both
  as `InputControlled … isReadOnly` — `isReadOnly`, because a DISABLED input
  submits nothing and the client-side `partValidator` would fail on them first;
  and WITHOUT `isUppercase`, which would re-create the lowercase-part-number
  defect the id join exists to fix. Everything else is the user's: Short
  Description is SEEDED from Onshape and then editable (nothing resolves on
  `item.name` and no job writes it back), and Replenishment / Method Type are
  read-only ONLY while a bill of materials is being imported, with the reason on
  screen. The dropzone stays hidden — the Onshape pull compare-and-sets
  `modelUploadId`, so a hand-uploaded model loses the race and is filed away as a
  document. The action switches to `create`.
- `PartForm` seeds Buy/Make optimistically from `seedFromElementType`
  (`ui/Parts/onshapePartSource.ts`, unit-pinned), then asks the `replenishment`
  route and applies its answer — the two agree whenever the company has no
  Purchasing Level column, which is most of them. The field names which source
  decided, and a deliberate edit clears that claim.
- **The create modal BLOCKS** on `OnshapeImportProgress` rather than navigating.
  The route answers as soon as the ITEM exists; the BOM, models and drawings land
  in a job, so opening the part on that response shows something unfinished. The
  panel replaces the form (there is nothing left to edit), names the stage, and
  opens the part when the run closes — with an escape offered throughout, an
  explicit failure state, and an 8-second grace period for a marker that never
  appears at all.
- `PartHeader` — "Link to Onshape" menu item → `OnshapeLinkPart`, plus
  importing / imported / did-not-finish badges driven by
  `useOnshapeImportStatus`. For everyone who reaches the part some other way.
- `Item/BoMExplorer` — renders `OnshapeBomImport`.
- `OnshapeRevisionSearch` — the released-revision list: search box, grouped by
  part number with the newest revision first and flagged `Latest`. Loads when the
  caller says it is active, not on mount: the sweep costs real Onshape calls.
- `OnshapeRevisionPicker` — a thin modal around that search, with a confirm step
  and the already-linked refusal. Used by link and BOM import; the New Part form
  embeds the search directly instead.
- `OnshapeBomImport` — preview-then-confirm; the preview says what will HAPPEN per
  row rather than just listing rows, and surfaces `skipped + orphaned` as dropped
  rows so a partial BOM is never presented as the whole one. Still the surface for
  an item that already exists; the New Part form deliberately shows no preview,
  since the part does not exist yet and every row would preview against nothing.
- `useOnshapeImportStatus` (`apps/erp/app/hooks/`) — reads `metadata.progress`
  off the item's `onshapeElement` mapping and polls every 3 s while it is
  running. POLL ONLY: `externalIntegrationMapping` is not in the
  `supabase_realtime` publication, so a push affordance would need a migration.
  Its pure half is `onshapeImportStatus.ts`, separate so it can be unit-tested —
  the hook pulls `@carbon/auth` and the glossary's Lingui macros, and what the
  marker MEANS is now what a blocking dialog turns on.

## Buy vs Make — one rule, three sources

`packages/ee/src/onshape/lib/replenishment.ts`, reached through its OWN subpath
`@carbon/ee/onshape/replenishment`. Every path that creates or seeds a part uses
it — the BOM import, the release mint, and the New Part form's `replenishment`
route — so the same part cannot classify two ways depending on which button was
pressed.

The subpath is load-bearing: the `@carbon/ee/onshape` barrel pulls in
`client.ts`, which boots `@carbon/env` and throws "INNGEST_SIGNING_KEY is not
set" in a unit test. Importing it through the barrel breaks the jobs' tests.

`readPurchasingLevelFromMetadata` flattens Onshape's `properties` array (what an
ELEMENT or PART metadata read returns) before applying the column rule;
`readOnshapePurchasingLevel` takes the flat column map a BOM row already carries.

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

**Absent falls to STRUCTURE, never to a blanket answer.** The older
implementation's `else` branch called every part Make when the column was absent
— which is every company that has not defined one — and that poisons MRP for
purchased leaf parts.

Per the spec's field-ownership rule this is **seeded once on create and Carbon's
thereafter**: replenishment is a business decision, not a CAD fact, so no later
sync overwrites it. `describeOnshapeReplenishment` names WHICH source decided,
because "Onshape told us" and "we inferred it from the shape of the tree" earn
very different trust from whoever reads the notification.

## elementType — the numeric one

The webhook and the revisions API use a NUMERIC `elementType`
(`client.ts:60-66`); `OnshapeElementType` in `element.type.ts` is a separate STRING
enum used only as a `getElements` filter.

| Value | Element | What Carbon does |
|---|---|---|
| 0 | Part Studio | per-BODY items, exported with `partIds` |
| 1 | Assembly | one item |
| 2 | Drawing | PDF → the model item, joined by element id |

**Drawing rule (historical, kept for the reasoning).** A released drawing is its
own `DRW-xxxx` element sharing
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

**Drawings resolve by ID** (shipped 2026-08-21). The suffix
heuristic is disproved on real data — RD-410, DRW-410 and PK-410 all reduce to
`-410`, matching five items across two parts — so it is never used. Carbon refuses
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
  `onshape-assets.ts` was written to prevent.

Refusal reasons: `drawing-references-no-model`, `drawing-references-many`,
`drawing-model-unmapped`, `drawing-model-revision-missing`,
`drawing-model-ambiguous`. The last is one element whose family has several
members at one revision — a different problem from two target ELEMENTS, and it
has its own reason so the message does not misdescribe it.

**Three paths carry the drawing pass**, all through
`pullOnshapeDrawingsForDocument` (`onshape-drawings.ts`):

| Path | Direction | Where |
|---|---|---|
| `onshape-release`, `elementType === 2` | drawing-first | its own `handle-drawing` step; never reaches `runOnshapeReleaseImport` |
| `onshape-release`, model release | model-first | after the asset attach, gated on `attachAssetsOnRelease` |
| `onshape-item-assets` (create + link) | model-first | after the model pull; this job also GAINED a notification, having previously returned refusals nobody read |
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
`webhook.onshape.$companyId.test.ts`. The receiver never filters on
elementType, so a drawing dispatches `onshape-release` carrying
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

## `externalIntegrationMapping` usage

Four `integration` values and five shapes, all on the one table
(`20260128140000_external-integration-mapping.sql`):

| `entityType` | `integration` | `entityId` | `externalId` | dup? | Written by |
|---|---|---|---|---|---|
| `onshapeRelease` | `onshape` | `releaseId` | `releaseId` | — | the release-import claim; metadata carries `changeNoticeId`, `claimedByMessageId`, `documentId`, `versionId`, `releaseName`, `importedAt`, `items[]`, `openNoticeCollisions?` |
| `item` | `onshapeElement` | Carbon item id | `did:eid[:partId]` | **true** | (`mapping.ts`); metadata carries `elementType`, `versionId`, `versionName`, `partNumber`, `fromUnreleasedVersion`, `lastSyncedAt`, `progress`, `replenishment` |
| `item` | `onshapeRevision` | Carbon item id | Onshape `revisionId` | **false** | (`mapping.ts`); metadata carries `revision`, `releaseId`, `releaseName`, `documentId`, `versionId`, `elementId`, `importedAt` |

`UNIQUE (entityType, entityId, integration, companyId)` is what makes the release
marker a claim and what makes the element link delete-then-insert. The partial
`UNIQUE (integration, externalId, entityType, companyId) WHERE
allowDuplicateExternalId = false` is what enforces the 1:1 revision link.

The mapping metadata is where the VOLATILE Onshape state lives, and keeping it
there is what lets `item.revision` stay clean — a revision string invented in
Carbon leaks into documents, POs, accounting sync and CSV exports.
`fromUnreleasedVersion` survives on rows written before releases-only; nothing
sets it now.

**RLS: SELECT and INSERT policies only, no UPDATE and no DELETE**
(`20260204001831_external-integration-mapping-rls.sql`). A PostgREST UPDATE from a
user-scoped client matches zero rows and returns `{ data: [], error: null }` — no
error, no signal. Every marker and mapping MUTATION therefore runs on the service
role.

## Gotchas

- **Revision `0` / `''` / NULL all collapse to "no revision."**
  `item.readableIdWithRevision` is `GENERATED ALWAYS AS (COALESCE(readableId || CASE
  WHEN revision = '0' THEN '' WHEN revision = '' THEN '' ELSE '.' || revision END,
  readableId)) STORED` (`20250519122022_revisions.sql:2`), and
  `releaseKey`/`getReadableIdWithRevision`/`isInitialRevisionLabel` mirror it. A
  numeric Onshape revision scheme is therefore ambiguous at revision `0`: it
  produces the same match key as an unrevised item while remaining a DISTINCT value
  in `item.revision` and in `item_unique`. Every comparison uses the RAW
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
- **`getOnshapeClient` does a read-modify-write on token refresh**: it reads the
  resolved credentials, spreads them, and hands the merged object to
  `persistIntegrationSecrets`, which splits the tokens into the vault and the
  rest into `metadata`. Two concurrent Onshape functions for one company each
  read the pre-refresh state and each write their own tokens — last write wins,
  and the loser's refresh token has already been consumed. There is no locking;
  the per-job concurrency keys do not serialize ACROSS jobs. `onshape-bom-import`'s
  company-level key is partly there to serialize this within one import.
- **`upsert_integration_secret` MERGES the vault bag rather than replacing it.**
  It did not, and the settings save does not resolve vaulted secrets before
  writing — so saving a webhook signing secret replaced the whole bag and wiped
  the OAuth tokens. The same latent bug still exists for other providers that
  vault more than one key.
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
  and its schema requires `name` + `replenishmentSystem`. `link` writes the name
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
- **`state` on the OAuth callback is checked for presence only** — it is not
  compared against anything stored. A CSRF gap, still open.
- **The connect popup closes itself.** The callback returns an HTML document that
  posts `app_oauth_completed` to the opener on success, or navigates the OPENER
  to the error URL on failure (the toast copy lives on that page, and rendering
  it inside a popup puts it where nobody is looking). With no opener at all — the
  popup was blocked and `onClientInstall` fell back to a top-level navigation —
  it redirects.
