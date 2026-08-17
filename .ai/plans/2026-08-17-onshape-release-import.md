# Onshape release import → change notice

Supersedes the Phase 2 section of `.ai/plans/2026-08-13-onshape-import-revisions.md`. That file's
Phase 1 record stays valid (shipped as `20faf4496`); its Phase 2 design position — a second
function fanning out on the same event, grouped by `releaseKey` — is replaced here.

Branch `feat/onshape-import-revisions`, rebased onto `74925f3b4`.

## Goal

An Onshape release becomes a pre-populated **Draft change notice** in Carbon, with one affected
item per released element and a change type derived from what Carbon already knows. The human
then drives it through the existing `Draft → Start → Engineering Complete → Implementation → Done`
flow. Carbon's change-notice module already models this; nothing new is invented.

## Hard constraints

1. **No database schema change.** Release provenance is a marker row in the existing
   `externalIntegrationMapping`.
2. **A customer who does not opt in sees zero change** — including no extra Inngest runs.
3. Ships as an additive declared setting on the existing `onshape` integration. Not a second
   integration, not a bespoke tab.
4. Minimise conflict with open PR #1337 (`feat/onshape-cad-sync-v2`).

## Decisions, and the evidence that forced them

### D1 — A separate event, not fan-out on `carbon/onshape-revision-sync`

The receiver dispatches a **new** `carbon/onshape-release-import` event, only when the flag is on.

Fan-out was the earlier plan and it violates constraint 2. Subscribing a second function to
`carbon/onshape-revision-sync` doubles the Inngest run count for **every existing asset-sync
customer** — each released element would produce two runs, the second doing a
`companyIntegration` read before returning `{ skipped: true }`. A 9-item release goes from 9 runs
to 18 for someone who never opted in. Gating in the receiver instead means non-adopters dispatch
nothing.

Secondary benefit: no in-repo precedent exists for two subscribers on one event (fan-out is
documented at `.claude/skills/inngest/SKILL.md:86-87` but never used here), so this also avoids
being the first instance of an untested platform behaviour.

### D2 — SUPERSEDED by D6. Both modes ship.

Original reasoning kept for the record: it concluded change-notice-only because

`applyChangeNotice` **cannot be reached** from a job. It lives at
`apps/erp/app/modules/items/items.server.ts:419`, is not re-exported from `items.service.ts`, the
MCP direct-executor imports only `items.service` (`direct-executor.ts:11`), and
`items_applyChangeNotice` is **absent** from `tool-metadata.json` (verified against all 1442
tools; the other three change-notice functions are present).

Driving status with `items_updateChangeNoticeStatus` instead is not equivalent: the route also
notifies on Start / Implementation / Done, so a job advancing status directly would diverge from
the UI in observable behaviour.

Shipping a two-option control whose second option silently no-ops is worse than shipping one
checkbox. Direct apply is deferred to its own change with its own reach problem to solve.

### D3 — One notice per release, claimed by the first element to arrive

There is no release-level event: `hooks.server.ts:130-134` subscribes to
`onshape.revision.created` only, so a 9-element release is 9 events with no "release complete"
signal. Observed 2026-08-17 against RD-410: 9 events in ~1.7s, and **arrival order is
nondeterministic between releases** — the top assembly arrived last in one release and first in
the next.

Therefore: the marker row is keyed on `releaseId` alone and acts as the claim. The first event to
insert it creates the notice; every sibling finds the claim and appends its affected item to the
notice the marker names. No aggregation window, no debounce.

### D4 — Owner-scoped client for the dispatch, service role only for the marker

`packages/jobs/AGENTS.md`'s Never list forbids giving a dispatched action anything but the
owner-scoped client — a privileged write escapes the owner's permissions. So the change-notice
writes go through `getUserScopedClient` for the integration installer.

The marker row is the exception and must use the service role:
`externalIntegrationMapping` has **SELECT and INSERT policies only, no UPDATE**
(`20260204001831_external-integration-mapping-rls.sql`). A PostgREST UPDATE from a user-scoped
client matches zero rows and returns `{ data: [], error: null }` — no error, no signal. Every
marker mutation is service-role or it silently does nothing.

### D5 — Optional HMAC signature verification ships in v1 (agreed 2026-08-17)

Verify when a per-company signing secret is configured; skip when it is not.

The existing justification for verifying nothing — a forged event cannot inject content because
the job re-resolves against the Onshape API — remains true for release import, since the job must
re-resolve anyway to get the revision letter. But two residual harms are new: a forged release
creates Draft notices, and an open notice **blocks manual revision and version creation** on those
items until someone cancels it; and the endpoint is enumerable (its GET loader answers
`{ success: true }` for any `companyId`), so forged POSTs burn Inngest runs and shared Onshape API
quota. Carbon also sells into A&D — this repo carries ITAR certification code — where "an
unauthenticated public endpoint creates change notices in your ERP" does not survive a security
questionnaire.

Fail-open-when-absent is what makes this compatible with constraint 2. It also closes the question
#1092's body raised and nobody answered.

Implementation is task 4.

## Tasks

Ordered so each is provable before the next. Tasks 1–5 are the slice that can be verified with a
`curl` against the running local stack, before any change-notice logic exists.

### 1. Capture `releaseId` and `revision` on the event

- `apps/erp/app/routes/api+/webhook.onshape.$companyId.ts` — add `releaseId` to the zod envelope
  and the destructure. It already arrives and survives `.passthrough()`; it is dropped at the
  destructure (`:122-131`).
- `packages/lib/src/events.ts:535-547` — add `releaseId` and optional `revision` to the
  `carbon/onshape-revision-sync` payload type, and declare the new
  `carbon/onshape-release-import` payload. `trigger()` is typed off this map
  (`packages/lib/src/trigger.ts:49-53`), so without the edit the new dispatch will not typecheck.
- Carrying `revision` matters for testability: the revision **letter** is otherwise only
  obtainable from a live Onshape HTTP call (`onshape-revision-sync.ts:90-109`), which would leave
  every downstream task with no synthetic test path.

**Verify:** `curl` a synthetic envelope at the receiver, confirm `releaseId` appears in the
"Onshape webhook received" log line.

### 2. Two new declared settings

`packages/ee/src/onshape/config.tsx`, alongside `assetSyncEnabled`:

```
{ name: "releaseImportEnabled", label: "Import releases as change notices",
  type: "switch", required: false, value: false }

{ name: "webhookSigningSecret", label: "Webhook signing secret",
  type: "text", required: false, value: "" }        // D5 / task 4
```

Add both keys to `integration.schema` — the switch with the same `z.preprocess` string→boolean
shim the existing one uses (`config.tsx:30-37`), the secret as an optional string.
**The schema is the gate on what persists**: it is a plain `z.object`, so zod's default STRIP
silently discards any posted key not declared there.

`required: false` on the secret is what makes verification opt-in per company. Note the
declared-settings merge is shallow, so leaving the field blank on a later save writes an empty
string rather than removing the key — the task-4 read must treat empty as absent.

Per D2 no mode control ships. Note for later: enums *are* supported —
`type: "options"` or `"cards"` with `listOptions`, and `visibleWhen: { field, equals }` gives
conditional visibility (real precedent `packages/ee/src/email/config.tsx:67`), and ≤5 options
render as choice cards (`IntegrationForm.tsx:256-267`, `CHOICE_CARD_MAX_OPTIONS = 5`).

**Verify:** the switch renders unchecked; toggling on and saving stores
`metadata.releaseImportEnabled === true`; existing `metadata.credentials` survives the save
(the merge at `integrations.$id.tsx:1395` is `{ ...existingMetadata, ...d }`, shallow, so
top-level keys persist).

### 3. Make the gates "either flag"

Every read of `assetSyncEnabled` becomes an OR with `releaseImportEnabled`:

- `webhook.onshape.$companyId.ts:95` — the drop-and-ack gate. This gate sits **before**
  `request.json()` (`:104`), so both reads stay strict `!== true` and a non-adopter's path is
  byte-identical.
- `integrations.$id.tsx:1504-1510` — the single call site of `ensureOnshapeReleaseWebhook`. It
  sits in the declared-settings fall-through **after** every intent branch returns early. Because
  our flag is a *declared setting*, it reaches this call naturally — this is the concrete payoff
  of the checkbox decision over a bespoke tab, which would have needed its own intent and
  silently never registered the webhook.
- Extend `onshapeActivatingWithoutWrite` (`:1400-1411`) to the new flag: release import needs the
  same OAuth2Write scope.

Deregistration must happen only when **both** flags are off. Note
`registerOnshapeWebhook` short-circuits on `alreadyRegistered` by callback **path**
(`hooks.server.ts:112-118`), so an existing customer's subscription is untouched.

**Verify:** with only `releaseImportEnabled` on, the webhook registers; turning it off with
`assetSyncEnabled` still on leaves the subscription in place.

### 4. Optional HMAC signature verification on the receiver

Independent of the release-import logic, so it gates nothing — but it ships in v1 (D5).

`apps/erp/app/routes/api+/webhook.onshape.$companyId.ts`:

- New optional settings entry `webhookSigningSecret` in `packages/ee/src/onshape/config.tsx`
  (task 2), declared `type: "text"` with the key added to `integration.schema`. Precedent:
  `packages/ee/src/paperless-parts/config.tsx:29-32`, "Webhook Signing Secret".
- Read the secret from `companyIntegration.metadata` — the integration row is already loaded at
  the top of the action, so this costs no extra query.
- **When the secret is absent, skip verification and proceed.** This is the xero shape
  (`webhook.xero.ts:65-67`, `if (!SECRET) return payload;`) and it is what keeps constraint 2
  true: no existing Onshape customer has a key configured.
- When present, compute `Base64(HMAC-SHA256(secret, "<timestamp>.<rawBody>"))` and accept if it
  matches **either** `X-onshape-webhook-signature-primary` or `-secondary`. Accepting either is
  what makes Onshape's dual-key rotation zero-downtime. Compare with
  `crypto.timingSafeEqual` — precedent `webhook.xero.ts:75`.
- Reject when `X-onshape-webhook-timestamp` is more than 5 minutes old (replay protection).
- The verification needs the **raw body text**, so read `await request.text()` once and
  `JSON.parse` it, rather than `request.json()` as the route does today (`:104`).

Closest overall template is `webhook.paperless-parts.$companyId.ts`: per-company secret out of
integration metadata (`:61-62`), `createHmac("sha256", …)` (`:17-27`), compare to header (`:92-94`).

Two things to state in the field's description text: Onshape's signing keys are **company-level,
not per-webhook**, so rotating affects every consumer of that Onshape company; and the secret is
stored as plaintext JSON in `companyIntegration.metadata`, consistent with how the OAuth access
and refresh tokens are already held there but not encrypted at rest.

**Verify:** with no secret set, a plain `curl` still works. With a secret set, an unsigned `curl`
is rejected and a correctly-signed one is accepted. A signature over a stale timestamp is
rejected.

### 5. Dispatch the new event, and the new function skeleton

- Receiver: when `releaseImportEnabled` is on, `trigger("onshape-release-import", …)` in addition
  to the existing dispatch. When it is off, nothing extra is dispatched — constraint 2.
- New `packages/jobs/src/inngest/functions/integrations/onshape-release-import.ts`.
  Template: `functions/tasks/reschedule-job.ts` (73 lines, keyed concurrency).
  Config: `id: "onshape-release-import"`, `retries: 3`,
  `idempotency: "event.data.messageId"`, `concurrency: { key: "event.data.releaseId", limit: 1 }`.
  Serialising per release is what makes the claim-then-append pattern in task 5 safe.
- Two barrel edits: `functions/integrations/index.ts` and the `functions` array in
  `packages/jobs/src/inngest/index.ts:94-162`.

**Verify:** the function appears in the local Inngest dev UI and runs to a logged no-op.

### 6. The marker row — claim, then append

Service role only (D4). `entityType='onshapeRelease'`, `entityId=externalId=<releaseId>`,
`integration='onshape'`, `metadata={ documentId, versionId, releaseName, changeNoticeId,
items:[…], importedAt }`.

Idempotency is the existing `UNIQUE (entityType, entityId, integration, companyId)`
(`20260128140000_external-integration-mapping.sql:37`). There is no CHECK on `entityType` and no
FK on `entityId`, so the tuple is free to use, and every item view filters `entityType = 'item'`
so a marker cannot leak into them.

**Retry trap:** the function is `retries: 3`, and a 429 raises `RetryAfterError`. Treating a
`23505` as "another delivery already claimed this" would make a *retry of the same run* skip its
own work. The claim must be idempotent for the same event — read the existing row, and only skip
if it was claimed by a different `messageId`.

Confirmed safe from cleanup: every `DELETE` on this table is scoped to a different
`entityType`/`integration` pair, and the table has no triggers.

### 7. Create the Draft notice through the dispatch seam

The seam is real: `packages/jobs/src/workflows/actions/dispatcher.ts:19-36` defines a module-level
`WorkflowDispatch` slot, filled by the ERP at `api+/inngest.ts:34` with the MCP
`executeFunction`. Four shipped workflow actions already dispatch app services by name.

Call, in order:
1. `items_insertChangeNotice` → `{ name, openDate, type: "Engineering", assignee }`
2. `items_addChangeNoticeAffectedItem` per released element
3. `items_createChangeNoticeDraftMethod` where a method is needed

All three are in `tool-metadata.json` with `serviceParams: ['client','input']` and
`injectAuth: ['companyId','createdBy','updatedBy']`.

Three traps, each verified:

- **`injectAuth` does not include `userId`.** Any function needing `input.userId` must receive it
  explicitly in `args`. Nothing validates args against the tool schema on either path.
- **Error handling is two-layer.** `result.success === true` does not mean the write succeeded —
  the Supabase envelope carries its own error. A naive success check would write the marker as
  imported and poison the idempotency key so the release can never be retried. Check both layers
  and only write the marker after the notice exists.
- **A function absent from `tool-metadata.json` is called with ZERO arguments** rather than
  erroring. If this work ever needs a new service function, `pnpm run generate:mcp` must run
  first.

`openDate` is required. Compute it as the two existing callers do:
`datetime.today(await getCompanyTimeZone(client, companyId))`.

### 8. Derive the change type per element

`changeNoticeChangeTypes` = `Version | Revision | Replacement Part | New Part`
(`items.models.ts:1060`).

| Onshape situation | Change type |
|---|---|
| `readableId` matches an item, revision letter advanced | **Revision** |
| No item with that `readableId` in the company | **New Part** |
| `readableIdWithRevision` matches, structure differs | **Version** |
| Part number replaced | not derivable — leave to the human |

Reuse the sibling-selection logic already written for Phase 1 in this branch (latest revision of
a `readableId`, named revisions before the initial, newest wins the tie) rather than a new
variant. Watch `releaseKey`'s `revision !== "0"` special case — Carbon treats revision `"0"` as
"no revision", which a numeric Onshape revision scheme would collide with.

### 9. Make the notice visible

An auto-created Draft notifies nobody: `changeNoticeBroadcastStages` is
`["Start","Implementation","Done"]` only. So set `assignee` on creation, and emit
`NotificationEvent.IntegrationSync` (`packages/notifications/src/index.ts:22`; precedent
`accounting-outbound-sweep.ts:338-357`). Without this the feature runs correctly and nobody
notices.

Record provenance on the notice itself so a reader can see which release produced CN-x. Note
`changeOrder.sourceType`/`sourceId` exist and are **dead columns** — nothing in the repo writes or
reads them — so using them is a new code path, not an established pattern.

### 10. Tests, docs, rules

- `apps/erp/app/routes/api+/webhook.onshape.$companyId.test.ts` — modelled on
  `webhook.quickbooks.$companyId.test.ts`. Cases: both flags off acks and dispatches nothing;
  either flag on dispatches with `releaseId`; `releaseId` absent still dispatches.
- Unit test for the new function's gate and marker claim, including the 23505 retry path.
- `.claude/rules/onshape-integration.md` — **does not exist**, while jira, linear and xero all
  have one. Largest integration surface in the repo with no rule file. Model on
  `jira-integration.md`, which documents its own `externalIntegrationMapping` usage.
- Update `docs/content/docs/integrations/cad.mdx` (its Settings table documents only
  "Connection"; `assetSyncEnabled` is already missing).
- Update `.ai/playbooks/onshape-asset-sync.md` — currently stamped "Last tested: 2026-07-03",
  before the feature it covers merged, and it only exercises the no-op `workflow.transition`.

**i18n:** `packages/ee/src` is **not** in `lingui.config.js` catalogs, and `IntegrationForm`
renders `setting.label`/`description` raw. So the new switch label is untranslatable where it
sits. This is pre-existing (`assetSyncEnabled` has the same problem) but the gap widens. Decide
before task 2 whether to accept it or add `packages/ee/src` to the catalogs.

## Open decisions

1. **A release touches an item already on an open notice.** The single-open-CO-per-part guard
   (`findOtherOpenChangeNoticesForItem`, `items.service.ts:6669`) permits one. Merge into the
   existing notice, queue, or fail visibly? Note the guard's helper currently has **zero
   callers** — enforcement lives in the routes, so a job bypasses it unless it calls the check
   itself. An open notice also blocks manual revision creation on the item
   (`UsedIn.tsx:276`, `MakeMethodTools.tsx:117`), so an auto-created notice takes that ability
   away until someone works it.
2. ~~Webhook authentication~~ — **CLOSED 2026-08-17**, see D5 and task 4.
3. ~~#1337 coordination~~ — **out of scope** per Raul, 2026-08-17. Recorded for the record: 6 of the 9 files this plan touches are also in #1337:
   `packages/ee/src/onshape/config.tsx`, `packages/ee/src/types.ts`, `packages/lib/src/events.ts`,
   both jobs barrels, and `items.service.ts`. Most are additive one-liners; `config.tsx` is the
   one real conflict, and `types.ts` and `items.service.ts` are avoidable if we add no new setting
   type and no new service function.
4. **Marker retention.** One row per release, forever, with no UPDATE policy so a stuck row is
   unclearable from user-role code. #1337 prunes its own run table to the newest 50 per company.
5. **Doubled Onshape API load** if both subscribers ever coexist — `withRateLimitRetry`
   (`onshape-backfill.ts:87-107`) turns a 429 into a per-function `RetryAfterError` and the two
   would compete for one quota with no shared cache. D1 avoids this for now.

## Test plan

Local stack on this branch, migrations applied, `CARBON_EDITION="enterprise"`.

1. **Synthetic, no Onshape.** `curl` an envelope carrying `releaseId` and `revision` at
   `/api/webhook/onshape/{companyId}`; assert one `carbon/onshape-release-import` run in the
   Inngest dev UI, one marker row, one Draft notice with the expected affected items and change
   types. Repeat the same `messageId` to prove idempotency; repeat with a sibling `messageId` and
   the same `releaseId` to prove append-not-duplicate.
2. **Gate matrix.** Both flags off → ack, no dispatch. Asset sync only → old behaviour only.
   Release import only → new dispatch only, webhook still registered.
3. **Live.** Tunnel with `ERP_URL` pinned via crbn's `#force` hatch
   (`onshape-integration/scripts/onshape-tunnel.sh`), then release RD-410 in Onshape. Expect
   revision D across 9 items, one notice, 9 affected items. The nondeterministic arrival order is
   the thing under test.
4. **Unhappy paths.** A part number Carbon has never seen → New Part line, not a skip. A release
   whose items are already on an open notice → whatever decision 1 lands on.

## Not in scope

Direct apply (D2), `onshape.workflow.transition` and approver provenance, configuration-aware
export, multi-part Part Studios, and the drawing/`elementType: 2` path — all tracked separately.


---

# SHIPPED 2026-08-17

Built and verified end-to-end against the local stack. Not pushed, no PR.

## Decisions added during implementation

### D6 — The nested toggle ships, both halves real (supersedes D2)

Raul's original design was a parent switch plus a nested "revisions/versions directly
vs change notices" choice. D2 killed the direct half because `applyChangeNotice` is
unreachable from a job. That was the wrong function to reach for.

"Create the revision directly" is `items_createRevision`, not `applyChangeNotice`.
It IS in `tool-metadata.json` (`serviceParams: ["client","args"]`,
`injectAuth: ["companyId","createdBy","updatedBy"]`, requires `{ item, revision }`),
so both halves are real and neither no-ops.

Auto-applying a change notice is still deliberately NOT built, and the reason is
safety rather than reach: `applyChangeNotice` drives four CAS transitions into a
terminal `Done` with no undo, is not one transaction, and `itemSupersession`'s primary
key is `("itemId")` alone — so a second release on the same predecessor silently
overwrites the first's successor pointer. `createRevision` has none of those
properties: additive, writes no supersession, reversible by deactivating the item, and
it is exactly what the manual "New Revision" button does.

Settings as shipped (`packages/ee/src/onshape/config.tsx`):
- `assetSyncEnabled` — untouched, so an existing customer is byte-identical.
- `releaseImportEnabled` — new switch, default false, INDEPENDENT of asset sync.
- `releaseImportMode` — `changeNotice` (default) | `revision`, two choice cards,
  nested via `visibleWhen: { field: "releaseImportEnabled", equals: "true" }` in the
  `Release import` group.
- `webhookSigningSecret` — optional, `Security` group.

Task 3 ("make the gates either flag") therefore STANDS: a company wanting only release
import must still receive webhooks, so the receiver gate, the
`ensureOnshapeReleaseWebhook` call and `onshapeActivatingWithoutWrite` all became
`assetSyncEnabled || releaseImportEnabled`.

### D7 — In-flight targeting: target the live item, record the collision

Open decision 1, closed. When a prior release's notice is still open, the importer
targets the ACTIVE item anyway. That is exactly what the UI permits — the
one-open-CO-per-part guard was dropped (`items/AGENTS.md:89`) and the affected-item
picker filters inactive items out entirely, so chaining onto an in-flight draft is a
capability a human does not have. But the UI also WARNS
(`ItemOpenChangeNoticeAlert`), so prior open notices are recorded in the marker's
`metadata.openNoticeCollisions`. Verified live: two parallel notices on `RD-410.A`
(CN-000004 rev B, CN-000005 rev C) with the collision recorded on the second.

Source selection is ACTIVE-only; the already-imported test spans ALL siblings,
including inactive drafts, because a draft still occupies `item_unique`.

### D8 — Re-release is a skip, not a failure

A revision Carbon already holds returns `revision-already-imported` and creates
nothing. Without this it is a 23505 inside `createRevision` that rolls back the
affected row and leaves an EMPTY notice behind a marker claiming success.

### D9 — Drawings are excluded from release import

`elementType 2` is filtered at the receiver and re-checked in the job. A released
drawing resolves to the SAME Carbon item as its model, so it would violate
`UNIQUE(changeOrderId, itemId)` on the FIRST import of a normal release; deriving its
change type from the `DRW-` readableId instead would mint a junk part. The PDF still
reaches the item through asset sync. **Consequence to state to customers: the notice
is not a complete manifest of the release.** Documented in `cad.mdx`.

### D10 — An unknown part number is skipped, not minted

`no-matching-item`. Minting would land the part with Carbon's defaults (Inventory /
Make), which poisons MRP for purchased leaf parts — the same defect the BOM import
path already has. The BOM import is the supported path for new parts.

## Files

- `packages/ee/src/onshape/config.tsx` — 3 new settings, 2 setting groups, schema.
- `packages/lib/src/events.ts` + `src/trigger.ts` — new event + `taskToEvent` entry
  (the plan missed the `taskToEvent` half; `trigger()` does not typecheck without it).
- `apps/erp/app/routes/api+/webhook.onshape.$companyId.ts` — either-flag gate, raw-body
  read, optional HMAC, `releaseId`/`releaseName`/`revision` captured, second dispatch.
- `apps/erp/app/routes/api+/webhook.onshape.$companyId.test.ts` — NEW, 22 tests.
- `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` — webhook + scope gates.
- `packages/jobs/src/inngest/functions/integrations/onshape-release-import.ts` — NEW.
- `packages/jobs/src/inngest/functions/integrations/onshape-matching.ts` (+ test) —
  `selectReleaseTarget` / `isInitialRevision`, unit-pinned.
- both jobs barrels; `20260817155435_onshape-release-import-jsonschema.sql`.
- `.claude/rules/onshape-integration.md` NEW; `AGENTS.md` router row;
  `docs/content/docs/integrations/cad.mdx`; `.ai/playbooks/onshape-asset-sync.md`.

## Verified locally

Synthetic POSTs against the running stack, company `d9ucrlp5c0h02e3d2bpg`:

- 3-element release sharing one `releaseId` → ONE notice (CN-000004), 3 affected items
  at Onshape's letter B, 3 inactive draft revisions, one marker naming the notice and
  claimed by the first arrival.
- Same `messageId` replayed → deduped, no second notice, no duplicate affected item.
- New `messageId` + same `releaseId` → appended (4th affected item, marker list grew).
- Re-release of rev B → `revision-already-imported`, no notice, no marker.
- `elementType 2` → no dispatch, no marker, no `DRW-` item created.
- No `releaseId` → skipped and logged.
- Parallel notice on the same part → targeted the ACTIVE `RD-410.A`, not the draft B,
  with `openNoticeCollisions` recorded.
- `revision` mode → active `MC-101.D`, no notice, no marker.
- Gate matrix: both off dispatches NEITHER event; each flag dispatches only its own.
- HMAC matrix (7 cases): unsigned rejected 401, valid primary 200, valid SECONDARY
  only 200 (rotation), stale timestamp 401, tampered body 401, wrong-length signature
  401 (not 500), secret removed → unsigned 200 (fail-open).
- UI: nested group shows/hides with the parent switch, choice cards render, save
  persists and `credentials` survive the shallow merge.
- `pnpm --filter @carbon/jobs test` 486 pass; the new receiver suite 22 pass; ERP
  typecheck clean; jobs/ee typecheck adds zero errors over the 4 pre-existing
  `packages/ee/src/accounting` Kysely ones; biome clean on every touched file.

## NOT verified — needs the live Onshape test

The Onshape-side NAME on the draft revision. It comes from `getRevisions`, and this
stack's OAuth token expired 2026-08-13, so every synthetic run took the
payload-revision fallback and wrote no name. The read-back that makes the write
reachable IS verified (`newItemId` now appears in the run output). Also still
unproven: that a company-scoped subscription really delivers for ALL documents.

## Defects found and NOT fixed here (logged separately)

1. `direct-executor.ts` `paramName === "args"` branch skips
   `enrichWithAuthContext`, so declared `injectAuth` is silently dropped — 224 tools,
   65 of them WRITE. Worked around by passing `createdBy` explicitly.
2. `getNextRevision` returns its input unchanged for anything not pure digits or 1-2
   uppercase letters, so `A2` collides on `item_unique`. Avoided by always passing
   Onshape's letter explicitly. Still bites the manual New Revision modal.
3. The `sync` edge function selects the highest-version Draft make method with NO
   `changeOrderId` filter and deletes its materials — a later Onshape BOM sync can
   wipe a change notice's authored BOM. Pre-existing; this feature raises exposure.
4. `NotificationEvent.IntegrationSync` renders as "Accounting sync needs attention",
   so it is unusable for a CAD event. Used `assignee` for visibility instead.
5. Masked integration setting types (`password`, `secret`) render a `<Password>` input
   with no `autoComplete`, so a browser password manager autofills them. Observed a
   saved password written into `webhookSigningSecret` on save, which would reject
   every genuine webhook. Switched this field to `text`; rillet's two `secret` fields
   still have the exposure.
6. `webhook.xero.ts:75` calls `crypto.timingSafeEqual` without a length check — a
   wrong-length signature throws 500 instead of 401.
