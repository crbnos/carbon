# Onshape Asset Sync + Release Import

Last tested: 2026-08-17 (branch `feat/onshape-import-revisions`, local stack, company
`Carbon Development`).
Exercised in that pass: the receiver gate matrix, the full HMAC matrix (unsigned / valid
primary / valid secondary / stale timestamp / tampered body / wrong-length signature /
missing timestamp), synthetic release import in change-notice mode (one Draft notice per
`releaseId`, four affected items at revision `B`, plus a second single-item release at `C`),
replay-by-messageId idempotency, sibling append, drawing exclusion, missing `releaseId`,
and the direct-Inngest-event loop read back through the dev server's run API.
NOT re-run in that pass: loop 3 (real Onshape delivery over a tunnel).

Routes:
- `/x/settings/integrations/onshape` (settings UI: two switches, mode cards, signing secret, backfill action)
- `POST /api/integrations/onshape/backfill` (admin trigger, gated on `assetSyncEnabled`)
- `POST /api/webhook/onshape/:companyId` (inbound receiver, public, optional HMAC)
- `GET /api/webhook/onshape/:companyId` (loader; answers `{"success":true}` for ANY id, touches nothing)

Subsystem reference: `.claude/rules/onshape-integration.md`.

## The two consumers

One OAuth connection, one Onshape webhook subscription, two independent switches.
`ensureOnshapeReleaseWebhook` is called with `assetSyncEnabled || releaseImportEnabled`
(`integrations.$id.tsx:1512-1519`), so the subscription exists while EITHER is on and is
deregistered only when both are off.

- **`assetSyncEnabled`** (pre-existing) — attaches the released CAD model / drawing PDF to
  the matching Carbon item. Dispatches `carbon/onshape-revision-sync`. Creates and revises
  nothing.
- **`releaseImportEnabled`** (new, default false) — brings the release into Carbon
  ENGINEERING data. Dispatches `carbon/onshape-release-import`
  (`webhook.onshape.$companyId.ts:291-328`). Two modes via `releaseImportMode`
  (`packages/ee/src/onshape/config.tsx:48-74`, nested under the switch by
  `visibleWhen { field: "releaseImportEnabled", equals: "true" }`):
  - `changeNotice` (default) — one Draft change notice per `releaseId`, one affected item
    per released element, change type `Revision`, carrying Onshape's revision LETTER. A
    human drives Draft → Start → Engineering Complete → Implementation → Done.
  - `revision` — creates the new revision immediately via `items_createRevision`, active,
    no notice (`onshape-release-import.ts:480-527`).
- **`webhookSigningSecret`** (new, optional, `type: "password"`) — opt-in HMAC verification.
  Absent or empty = verification skipped, request proceeds (fail-open by design,
  `webhook.onshape.$companyId.ts:189-202`).

There is no release-level Onshape event: a 9-element release arrives as 9 separate
`onshape.revision.created` deliveries in nondeterministic order with no "release complete"
signal. `releaseId` is the grouping key; a marker row in `externalIntegrationMapping`
(`entityType 'onshapeRelease'`, `entityId = externalId = releaseId`) is the claim. First
element in creates the notice, siblings append to it. No new table, no schema change.

## Prerequisites

- **Branch** `feat/onshape-import-revisions`, migrations applied
  (`pnpm db:migrate`). The one that matters is
  `20260817155435_onshape-release-import-jsonschema.sql` — it declares
  `releaseImportEnabled`, `releaseImportMode` and `webhookSigningSecret` in the `onshape`
  `integration.jsonschema`. Confirm it landed:

  ```sql
  select jsonschema::text from "integration" where id='onshape';
  -- expect all three new keys under properties
  ```

  Without it, an `active=true` write whose metadata carries a new key is still accepted
  (`additionalProperties` defaults to true) — but the declaration is what keeps it accepted
  after a future tightening. `sync_verify_integration` (`20260410031811`) is the validator,
  and it only runs when `active = true`.
- **Dev stack up.** `crbn up --no-portless` (plain localhost). ERP `http://localhost:3000`,
  Supabase API `:54321`, Postgres `:64267`, Inngest dev server `:64271` (`PORT_DB` /
  `PORT_INNGEST` / `PORT_ERP` in the crbn-generated `.env.local`; substitute your own).
  Portless `.dev` URLs did not resolve for the node server / curl / automation browser on
  this machine (root-owned `~/.portless`); localhost mode sidesteps it.
- **Inngest**: the release-import function must appear in the dev server's app list. It is
  registered in `packages/jobs/src/inngest/functions/integrations/index.ts` and the
  `functions` array in `packages/jobs/src/inngest/index.ts`; the event is declared in
  `packages/lib/src/events.ts` and needs its `taskToEvent` entry in
  `packages/lib/src/trigger.ts` (without that, `trigger("onshape-release-import", …)` does
  not typecheck).
- **Edition**: this is `@carbon/ee` code. The `INTEGRATIONS` plan gate is a no-op unless
  `CARBON_EDITION="cloud"` (`plan.server.ts` `companyHasPlan` returns true off Cloud), so
  `community`, `enterprise` and `test` all work. This worktree's `.env` is `community`.
- **The integration row must exist and be ACTIVE.** `ONSHAPE_CLIENT_ID` is unset in this
  worktree's `.env`, so a fresh seed has no `companyIntegration` row and no OAuth path.
  Inject a fixture (fake creds) — direct navigation to
  `/x/settings/integrations/onshape` renders even though the config's
  `active: !!ONSHAPE_CLIENT_ID` is false:

  ```sql
  insert into "companyIntegration" (id,"companyId",active,metadata,"updatedAt","updatedBy") values ('onshape','<companyId>',true,'{"baseUrl":"https://cad.onshape.com","credentials":{"type":"oauth","accessToken":"FIXTURE_FAKE_TOKEN","refreshToken":"FIXTURE_FAKE_REFRESH","expiresAt":"2030-01-01T00:00:00.000Z"},"scope":"OAuth2Read OAuth2Write","assetSyncEnabled":false,"releaseImportEnabled":true,"releaseImportMode":"changeNotice"}'::json,now(),'<userId>') on conflict (id,"companyId") do update set active=excluded.active, metadata=excluded.metadata, "updatedAt"=now();
  ```

  `baseUrl` + `credentials{type,accessToken,refreshToken,expiresAt}` are required by the
  jsonschema. `scope` must contain `OAuth2Write` or the settings action forces both switches
  back off on save (`onshapeActivatingWithoutWrite`, `integrations.$id.tsx:1407-1416`) —
  irrelevant when you set metadata in SQL, mandatory when you toggle in the UI.
- **The two ids that matter:**
  - `companyId` — the path segment of the webhook URL. It resolves the integration row.
    Locally: `select id from company limit 1;` → `d9ucrlp5c0h02e3d2bpg`.
  - `companyIntegration.updatedBy` — the **acting user** for every dispatch. The webhook is
    unauthenticated, so the installer is the actor (`webhook.onshape.$companyId.ts:259`):
    it becomes the job's `userId`, the notice's `assignee`, and `createdBy` on the new
    revision. Locally: `1e3ebeae-c371-4c35-b9d3-3ac937213edd` (`test@carbon.ms`). If it is
    NULL, `revision.created` is dropped before either dispatch.
- **Items must already exist.** A part number Carbon has never seen is SKIPPED
  (`no-matching-item`), not minted — deliberately, because minting would land it with
  Carbon defaults and poison MRP. The BOM import wizard is the supported path for new
  parts. Locally `RD-410`, `EL-703`, `SA-800`, `PK-410` exist (revision `A` active).

Set these once per shell; every command below uses them:

```bash
export CID=d9ucrlp5c0h02e3d2bpg INSTALLER=1e3ebeae-c371-4c35-b9d3-3ac937213edd BASE=http://localhost:3000 PGPORT_LOCAL=64267
```

---

## Loop 1 — synthetic POST at the receiver (cheapest)

No Onshape, no tunnel, no signature (with no `webhookSigningSecret` configured the receiver
skips verification and proceeds). The `revision` field in the payload is what makes this
work offline: `resolveReleasedRevision` tries the Onshape revisions API first and falls back
to the payload letter on any non-rate-limit failure (`onshape-release-import.ts:277-341`).

**Pick a revision letter no sibling of that part already holds.** The already-imported test
spans ALL siblings including inactive drafts, because an inactive draft still occupies
`item_unique` (`onshape-release-import.ts:241-243`). Locally `RD-410` already has `A`
(active), `B` and `C` (inactive drafts) — use `D` or later.

Reachability first (proves the route without touching the integration):

```bash
curl -sS -o /dev/null -w '%{http_code}\n' $BASE/api/webhook/onshape/smoke-test
```

### 1a. A release of several parts sharing one releaseId

Three deliveries, one `releaseId`, distinct `messageId` per element. Order does not matter —
the first to arrive claims the notice, the rest append.

```bash
curl -sS -X POST $BASE/api/webhook/onshape/$CID -H 'Content-Type: application/json' -d '{"event":"onshape.revision.created","messageId":"msg-relD-RD-410","releaseId":"rel-D","releaseName":"REL-D","partNumber":"RD-410","revision":"D","documentId":"doc-rd410","versionId":"ver-d","elementId":"el-rd410","elementType":1}'
```

```bash
curl -sS -X POST $BASE/api/webhook/onshape/$CID -H 'Content-Type: application/json' -d '{"event":"onshape.revision.created","messageId":"msg-relD-EL-703","releaseId":"rel-D","releaseName":"REL-D","partNumber":"EL-703","revision":"D","documentId":"doc-rd410","versionId":"ver-d","elementId":"el-el703","elementType":0}'
```

```bash
curl -sS -X POST $BASE/api/webhook/onshape/$CID -H 'Content-Type: application/json' -d '{"event":"onshape.revision.created","messageId":"msg-relD-SA-800","releaseId":"rel-D","releaseName":"REL-D","partNumber":"SA-800","revision":"D","documentId":"doc-rd410","versionId":"ver-d","elementId":"el-sa800","elementType":1}'
```

Expect `200 {"success":true}` each. Then: ONE marker row for `rel-D`, ONE Draft change
notice named `Onshape release REL-D`, THREE `changeOrderAffectedItem` rows with
`changeType='Revision'`, each `newItemId` pointing at an inactive `revision='D'` item.
See Verification queries.

### 1b. Replay the same messageId — idempotency

Re-run the FIRST command byte-for-byte. Expect `200`, and NO second Inngest run: the
function declares `idempotency: "event.data.messageId"`
(`onshape-release-import.ts:846-854`). Nothing changes in the DB.

If the same element is redelivered with a NEW `messageId`, the second layer catches it:
`resolveReleaseTarget` returns `already-imported` because revision `D` now exists on that
readableId, so the run completes with `skippedReason: "revision-already-imported"` instead
of a `23505` on `item_unique`.

### 1c. A sibling with a new messageId and the same releaseId — append, not duplicate

Command 1a-two/three already prove this (same `releaseId`, new `messageId`, different
part). Assert AFTER them: `changeOrder` count for `rel-D` is still 1, the marker's
`metadata.items` has grown, and `metadata.claimedByMessageId` still names the FIRST
element's messageId.

### 1d. A drawing (elementType 2) — excluded

```bash
curl -sS -X POST $BASE/api/webhook/onshape/$CID -H 'Content-Type: application/json' -d '{"event":"onshape.revision.created","messageId":"msg-relD-DRW","releaseId":"rel-D","releaseName":"REL-D","partNumber":"RD-410","revision":"D","documentId":"doc-rd410","versionId":"ver-d","elementId":"el-drw","elementType":2}'
```

Expect `200` and the ERP console line `Onshape webhook: drawing element; skipping release
import`. No release-import dispatch at all (`webhook.onshape.$companyId.ts:300-311`). Asset
sync IS still dispatched for it when `assetSyncEnabled` — the drawing PDF reaches the item
that way. A released drawing is its own `DRW-xxxx` element that resolves to the SAME Carbon
item as the model it documents, so importing it would violate
`UNIQUE(changeOrderId, itemId)`. The job carries the same check as a backstop
(`onshape-release-import.ts:419-421`, skip reason `drawing-element`).

### 1e. No releaseId — skipped loudly

```bash
curl -sS -X POST $BASE/api/webhook/onshape/$CID -H 'Content-Type: application/json' -d '{"event":"onshape.revision.created","messageId":"msg-norel-RD-410","partNumber":"RD-410","revision":"D","documentId":"doc-rd410","versionId":"ver-d","elementId":"el-rd410","elementType":1}'
```

Expect `200` and `Onshape webhook: revision.created without releaseId; skipping release
import`. Without the grouping key the siblings of a release cannot be grouped, so importing
would mint one notice per element. Asset sync is unaffected — it never needed `releaseId`.

### Reading the outcome

The HTTP response cannot distinguish "accepted and dispatched" from "accepted and dropped"
— both are `200 {"success":true}`. The signals are:

- ERP dev-server console: `Onshape webhook received` (envelope parsed, logs `releaseId` and
  `revision`), then the specific skip line if any.
- Inngest run output, read from the CLI rather than the UI. The event POST returns its id;
  feed it back:

  ```bash
  curl -sS "http://localhost:64271/v1/events/<eventId>/runs" | python3 -m json.tool
  ```

  A skip looks like `"output": {"imported": false, "skippedReason": "drawing-element"}`.
  Skip reasons: `disabled`, `drawing-element`, `revision-not-found`, `no-matching-item`,
  `revision-already-imported` (`onshape-release-import.ts:47-53`). `no-dispatcher` is
  declared in that union but never returned — a missing dispatcher THROWS so the run retries
  (`:464-470`), and the ERP wires the dispatcher on its first request to `/api/inngest`, so
  in practice it is always present.

---

## Loop 2 — direct Inngest event (skips the receiver)

Bypasses the route, the gate and the HMAC entirely — it exercises the job only. In dev any
event key works; `/e/dev` is the shortest.

```bash
curl -sS -X POST http://localhost:64271/e/dev -H 'Content-Type: application/json' -d '{"name":"carbon/onshape-release-import","data":{"companyId":"d9ucrlp5c0h02e3d2bpg","userId":"1e3ebeae-c371-4c35-b9d3-3ac937213edd","messageId":"inngest-relE-RD-410","releaseId":"rel-E","releaseName":"REL-E","partNumber":"RD-410","revision":"E","documentId":"doc-rd410","versionId":"ver-e","elementId":"el-rd410","elementType":1}}'
```

Returns `{"ids":["<eventId>"],"status":200}`. The payload is re-validated inside the
function by `OnshapeReleaseImportPayloadSchema` (`onshape-release-import.ts:830-844`), so a
field the receiver would have supplied cannot be omitted here.

The asset-sync equivalent is `"name":"carbon/onshape-revision-sync"` with the same fields;
there `releaseId`, `revision` and `revisionId` are all optional
(`packages/lib/src/events.ts`).

Note the job re-reads the flags itself (`getOnshapeReleaseImportSettings`,
`onshape-release-import.ts:124-145`) — a direct event against a company with release import
off completes with `skippedReason: "disabled"`. That gate is duplicated on purpose; the
receiver's copy is what prevents the dispatch.

---

## Loop 3 — real Onshape delivery over a tunnel

Only one leg needs a public URL: Onshape POSTing to the receiver. `getAppUrl()` returns
`ERP_URL` in dev and `registerOnshapeWebhook` registers
`${getAppUrl()}/api/webhook/onshape/{companyId}`, so pinning `ERP_URL` to a tunnel host is
the whole mechanism. The supported way to pin it is crbn's `#force` hatch
(`packages/dev/src/env.ts`): a key in `.env` ending `#force` is omitted from the generated
`.env.local`, so the `.env` value wins and survives `crbn up`.

The catch: crbn only omits the key when it REGENERATES `.env.local`. If the stack is already
up, `.env.local` still holds its own `ERP_URL` and beats the pin — that line has to be
masked too.

Raul's helper scripts live OUTSIDE this repo, in the project directory
(`/Users/raul/Desktop/carbon/onshape-integration/`), alongside a fuller runbook
(`local-webhook-testing.md`):

- `scripts/onshape-tunnel.sh` — starts a cloudflared quick tunnel to `PORT_ERP`, writes
  `ERP_URL=https://<host> #force` into the worktree `.env`, masks `ERP_URL` in `.env.local`,
  blocks until Ctrl-C, then restores both. `--clear` removes the pin.
- `scripts/onshape-webhook-smoke.sh` — GET reachability, then an optional synthetic POST.

Doing it by hand is three steps: `cloudflared tunnel --url http://localhost:3000`, append
`ERP_URL=https://<assigned-host> #force` to `.env` and comment out `ERP_URL` in
`.env.local`, then restart the ERP dev server.

Order matters, and each step has a reason:

1. Tunnel + pin BEFORE the dev server starts. Env is read at process start.
2. In Carbon: Settings → Integrations → Onshape, turn the switch OFF, save, then ON, save.
   Do not skip the OFF. `registerOnshapeWebhook` dedupes on the callback **path**, not the
   full URL, so a subscription still pointing at localhost or yesterday's tunnel counts as
   "already registered" and no new one is created. Turning it off deregisters every webhook
   on that path first. Either switch drives the same registration.
3. Confirm the toast says the settings saved with no webhook error. "Saved Onshape settings,
   but couldn't register the release webhook" means the settings persisted and registration
   failed.
4. Release a package in Onshape. Only a release package reaching **Released** fires
   `onshape.revision.created` — versions, release candidates and obsoletion do not.

One-time Onshape-side setup: the OAuth app must grant BOTH `OAuth2Read` and `OAuth2Write`
(write creates the webhook subscription and the export jobs); the account needs a **company**
(release management is a company feature, and registration is company-scoped via
`getCompanies()`); and managed workflows must be enabled in the Onshape company's release
settings.

A cloudflared quick tunnel gets a random hostname per run, so every restart means re-pinning
and re-toggling.

Backfill needs no tunnel at all: `onshape-backfill.ts` runs the same per-element sync code,
Carbon-initiated, against real release data. It covers asset sync only — it does not drive
release import.

---

## Gate matrix

Both reads are strict `!== true`, and the gate sits BEFORE the body is read
(`webhook.onshape.$companyId.ts:157-174`), so a company opted into neither takes a
byte-identical path to before release import existed. Flip the flags in SQL and re-run
command 1a-one after each:

```sql
update "companyIntegration" set metadata = (metadata::jsonb || '{"assetSyncEnabled":false,"releaseImportEnabled":false}'::jsonb)::json where id='onshape' and "companyId"='<companyId>';
```

| assetSyncEnabled | releaseImportEnabled | HTTP | Dispatches | Console |
|---|---|---|---|---|
| false | false | 200 | **nothing** | `Onshape webhook: no consumer enabled; ignoring event` — and no `Onshape webhook received` line, because the body is never parsed |
| true | false | 200 | `carbon/onshape-revision-sync` only | `Onshape webhook received` |
| false | true | 200 | `carbon/onshape-release-import` only | `Onshape webhook received` |
| true | true | 200 | both | `Onshape webhook received` |

Assert the dispatch count in the Inngest dev server, not the response — all four rows return
`200`. The both-off row is the constraint that matters: a non-adopter must produce zero extra
Inngest runs.

Two other 4xx paths on the same route: unknown `companyId` → `400 "Integration not
configured"`; `active = false` → `400 "Integration not active"`.

---

## HMAC matrix

Onshape signs each delivery as `Base64(HMAC-SHA256(secret, "<timestamp>.<rawBody>"))` and
sends it in BOTH an `x-onshape-webhook-signature-primary` and a `-secondary` header so a key
rotation is zero-downtime. The receiver accepts EITHER
(`webhook.onshape.$companyId.ts:99-107`). The timestamp header is epoch **milliseconds** and
must be within `SIGNATURE_MAX_AGE_MS` (5 minutes) of now.

Set a secret:

```sql
update "companyIntegration" set metadata = (metadata::jsonb || '{"webhookSigningSecret":"local-test-secret"}'::jsonb)::json where id='onshape' and "companyId"='<companyId>';
```

Then, in one shell (the body must be signed byte-for-byte as sent, so `printf '%s.%s'` with
no trailing newline is load-bearing; `base64` is macOS — use `base64 -w0` on Linux):

```bash
export SECRET=local-test-secret BODY='{"event":"onshape.revision.created","messageId":"hmac-1","releaseId":"rel-hmac","partNumber":"RD-410","revision":"D","documentId":"doc-rd410","versionId":"ver-d","elementId":"el-drw","elementType":2}'
```

```bash
export TS=$(($(date +%s)*1000)) && export SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64) && echo "$TS $SIG"
```

`elementType:2` keeps every row below side-effect-free: the signature is verified, then the
drawing filter drops the event. Swap to `1` once you want a signed request to actually
import.

Eight cases, in order. Each command is one line.

**1. No secret configured, unsigned → `200 {"success":true}` (fail-open).** Remove the key
first (see Cleanup), then:

```bash
curl -sS -X POST $BASE/api/webhook/onshape/$CID -H 'Content-Type: application/json' -d "$BODY"
```

**2. Secret set, unsigned → `401 {"success":false,"error":"Invalid signature"}`.** Same
command as case 1, with the secret in place.

**3. Valid primary → `200`.**

```bash
curl -sS -X POST $BASE/api/webhook/onshape/$CID -H 'Content-Type: application/json' -H "x-onshape-webhook-timestamp: $TS" -H "x-onshape-webhook-signature-primary: $SIG" -d "$BODY"
```

**4. Valid SECONDARY only, no primary header → `200`.** This is the key-rotation case:
accepting either header is what makes a rotation zero-downtime.

```bash
curl -sS -X POST $BASE/api/webhook/onshape/$CID -H 'Content-Type: application/json' -H "x-onshape-webhook-timestamp: $TS" -H "x-onshape-webhook-signature-secondary: $SIG" -d "$BODY"
```

**5. Stale timestamp (10 minutes old, correctly signed FOR that timestamp) → `401`.**

```bash
export STALE=$((($(date +%s)-600)*1000)) && export SSIG=$(printf '%s.%s' "$STALE" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64) && curl -sS -X POST $BASE/api/webhook/onshape/$CID -H 'Content-Type: application/json' -H "x-onshape-webhook-timestamp: $STALE" -H "x-onshape-webhook-signature-primary: $SSIG" -d "$BODY"
```

**6. Tampered body, valid signature for the original → `401`.**

```bash
curl -sS -X POST $BASE/api/webhook/onshape/$CID -H 'Content-Type: application/json' -H "x-onshape-webhook-timestamp: $TS" -H "x-onshape-webhook-signature-primary: $SIG" -d "${BODY/RD-410/EL-703}"
```

**7. Wrong-length signature → `401`, NOT a 500.**

```bash
curl -sS -X POST $BASE/api/webhook/onshape/$CID -H 'Content-Type: application/json' -H "x-onshape-webhook-timestamp: $TS" -H 'x-onshape-webhook-signature-primary: abc' -d "$BODY"
```

**8. Missing timestamp header → `401`.**

```bash
curl -sS -X POST $BASE/api/webhook/onshape/$CID -H 'Content-Type: application/json' -H "x-onshape-webhook-signature-primary: $SIG" -d "$BODY"
```

Case 7 is the one worth keeping: `crypto.timingSafeEqual` THROWS on a length
mismatch, so `signaturesMatch` length-checks first
(`webhook.onshape.$companyId.ts:64-72`). `webhook.xero.ts` has that latent bug — a
short signature there is a 500, not a 401.

Every rejection logs `Onshape webhook: signature verification failed` with a `reason`
(`missing timestamp header`, `unparseable timestamp header`, `timestamp outside the accepted
window`, `signature mismatch`); the HTTP body says only `Invalid signature`.

An empty string counts as absent. The declared-settings merge is shallow
(`integrations.$id.tsx:1396`), so clearing the field in the UI writes `""` rather than
removing the key, and `""` skips verification.

---

## Verification queries

`psql` against the worktree's local Postgres. Port is `PORT_DB` in `.env.local` — `64267`
here; substitute yours.

```bash
psql "postgresql://postgres:postgres@localhost:${PGPORT_LOCAL:-64267}/postgres"
```

### The marker row — the claim and the release's progress

```sql
select "entityId" as "releaseId",
       "externalId",
       "lastSyncedAt",
       jsonb_pretty(metadata) as metadata
from "externalIntegrationMapping"
where "entityType" = 'onshapeRelease'
  and "integration" = 'onshape'
  and "companyId" = '<companyId>'
order by "createdAt" desc;
```

Assert: exactly ONE row per `releaseId`; `entityId = externalId = releaseId`;
`metadata.changeNoticeId` names the notice; `metadata.claimedByMessageId` is the FIRST
element's messageId and never changes; `metadata.items` is the deduped list of part numbers
appended so far; `metadata.importedAt` is set once at claim, `metadata.lastImportedAt` moves
with each sibling. `metadata.openNoticeCollisions` appears ONLY when the item already had a
prior open notice — same-part parallel notices are permitted (matching the UI, which allows
them and warns via `ItemOpenChangeNoticeAlert`), so the job records the collision instead of
refusing.

Real shape after a four-element release:

```
"items": ["RD-410","EL-703","SA-800","PK-410"], "changeNoticeId": "co_SfqLBh5fbexTtSSnEA8Aau",
"claimedByMessageId": "msg-rel-test-1786982192-RD-410", "releaseName": "REL-TEST-B"
```

Marker writes run on the SERVICE ROLE. `externalIntegrationMapping` has SELECT and INSERT
policies only, no UPDATE (`20260204001831`) — a PostgREST UPDATE from a user-scoped client
matches zero rows and returns `{ data: [], error: null }`, i.e. no error and no signal.

### The change notice

```sql
select id, "changeOrderId", name, status, type, assignee, "openDate",
       "reasonForChange"::text
from "changeOrder"
where "companyId" = '<companyId>'
order by "createdAt" desc limit 5;
```

Assert: `name = 'Onshape release <releaseName or releaseId>'`, `status = 'Draft'`,
`type = 'Engineering'`, `assignee = companyIntegration.updatedBy` (an auto-created Draft
notifies nobody — `changeNoticeNotifyStages` is Start/Implementation/Done only
(`items.models.ts:1103-1108`), so the assignee is what puts it in a human's queue),
`openDate` = today in the COMPANY timezone
(`getCompanyTimeZone`), and `reasonForChange` is tiptap JSON with the release provenance
(release name, part + revision, document / version / element). It is a rich-text column, so
a plain string would not render.

`NotificationEvent.IntegrationSync` is deliberately NOT used — it renders as "Accounting
sync needs attention".

Careful with the column names: `changeOrderAffectedItem."changeOrderId"` is the FK to
`changeOrder."id"`, while `changeOrder."changeOrderId"` is the human-readable number
(`CN-000004`). Same name, different meaning.

### The affected items and their draft revisions

```sql
select co."changeOrderId" as notice,
       i."readableId",
       i.revision as "sourceRevision",
       ai."changeType",
       ai."newItemId",
       ni.revision as "newRevision",
       ni.active as "newActive",
       ai."sortOrder"
from "changeOrderAffectedItem" ai
join "changeOrder" co on co.id = ai."changeOrderId"
join "item" i on i.id = ai."itemId"
left join "item" ni on ni.id = ai."newItemId"
where co."companyId" = '<companyId>'
  and co.name like 'Onshape release%'
order by co."createdAt" desc, ai."sortOrder";
```

Assert: one row per non-drawing released element, `changeType = 'Revision'` on every row,
`newItemId` NOT NULL, and the new item carrying `revision = <Onshape letter>` with
`active = false` (a draft revision stays inactive until the notice is released). Observed:

```
   notice   | readableId | sourceRevision | changeType |  newRevision | newActive
 CN-000004  | RD-410     | A              | Revision   |  B           | f
 CN-000004  | EL-703     | A              | Revision   |  B           | f
```

`Revision` is the honest change type when Onshape advanced the letter; `Version` would mean
"same part number, structure differs", which needs a BOM comparison v1 does not do.

The Onshape letter is passed EXPLICITLY into `addChangeNoticeAffectedItem`
(`onshape-release-import.ts:629-640`), which bypasses `getNextRevision` — that helper
returns its input unchanged for anything that is not pure digits or one-to-two uppercase
letters, so an Onshape label like `A2` would be handed straight back and collide on
`item_unique`.

### Which sibling was targeted

```sql
select id, "readableId", revision, active, type, "createdAt"
from "item"
where "companyId" = '<companyId>' and "readableId" = 'RD-410'
order by "createdAt";
```

The source is the latest **ACTIVE** sibling, named revisions preferred over the initial
`'0'`/empty one, newest first (`onshape-release-import.ts:250-264`). An inactive sibling is a
draft revision owned by an open notice, and the affected-item picker filters inactive items
out entirely, so a human could not build on one either. The already-imported test, by
contrast, spans ALL siblings — active or not.

### `revision` mode

Same release, `releaseImportMode = 'revision'`. No `changeOrder` and no marker row are
written; the only artifact is a new **active** item:

```sql
select id, "readableId", revision, active, name, "createdBy"
from "item"
where "companyId" = '<companyId>' and "readableId" = 'RD-410' and revision = 'D';
```

Assert `active = true` and `createdBy = companyIntegration.updatedBy`. `createdBy` is passed
explicitly (`onshape-release-import.ts:494-502`): when a service's parameter is literally
named `args` — as `createRevision`'s is — the MCP direct executor skips
`enrichWithAuthContext`, so the declared `injectAuth` never runs and the insert would fail
on `createdBy`'s NOT NULL.

### Errors are two-layered

`result.success` from the dispatch only says the dispatch worked; the Supabase envelope
inside carries its own error (`unwrapDispatch`, `onshape-release-import.ts:106-121`). A
failed write recorded as success would poison the release's marker so it could never be
retried. If a notice exists with zero affected items, that is the shape to suspect.

---

## Traps

- **Omitting `revision` from a synthetic payload throws instead of skipping.** With no
  reachable Onshape API and no payload letter, `resolveReleasedRevision` rethrows the lookup
  error (`onshape-release-import.ts:328`) and the run retries three times. Always include
  `revision` offline.
- **`concurrency: { key: "event.data.releaseId", limit: 1 }`** serialises siblings of one
  release. Two elements cannot both create a notice. Firing the three commands in 1a as fast
  as possible is the test, not a problem.
- **`revision` mode is not reversible by re-running.** It creates an active item
  immediately. Re-delivering the same letter then skips `revision-already-imported`.
- **`addChangeNoticeAffectedItem` does not return `newItemId`** — only
  `{ id, draftMakeMethodId }`. It writes `newItemId` directly onto the
  `changeOrderAffectedItem` row, which is why the query above works. The job reads it
  back off that row before applying Onshape's attributes; a `newItemId` in the run
  output is the signal the read-back worked. Without it `applyOnshapeAttributes` would
  silently never run on the change-notice path and the draft revision would stay a
  byte-for-byte copy of its base ("No changes yet.").
- **The name refresh itself needs a live Onshape connection.** The Onshape-side name
  comes from `getRevisions`, so a synthetic POST on a stack with an expired token
  imports structurally but writes no name. Loop 3 is what exercises it.
- **Idempotency keys expire.** Inngest's `messageId` dedupe is a 24h window; a replay the
  next day produces a new run, which then lands on `revision-already-imported`.

---

## Cleanup

```sql
-- Remove a temporary signing secret (restores fail-open)
update "companyIntegration" set metadata = (metadata::jsonb - 'webhookSigningSecret')::json where id='onshape' and "companyId"='<companyId>';

-- Drop synthetic release markers
delete from "externalIntegrationMapping" where "entityType"='onshapeRelease' and "entityId" like 'rel-%' and "companyId"='<companyId>';

-- Drop the synthetic notices (affected items cascade) — check the ids first
delete from "changeOrder" where name like 'Onshape release rel-%' and "companyId"='<companyId>';

-- Drop the draft/created revision items the runs minted
delete from "item" where "companyId"='<companyId>' and "readableId" in ('RD-410','EL-703','SA-800','PK-410') and revision in ('D','E');

-- Remove the fixture integration row entirely
delete from "companyIntegration" where id='onshape' and metadata->'credentials'->>'accessToken'='FIXTURE_FAKE_TOKEN';
```

Deleting a `changeOrder` whose affected items own draft revision items may be blocked by FKs
— delete the affected items and then their `newItemId` items if so. Locally the cheaper
route is to leave the notices and let the next release use a fresh letter.

After a tunnel session: `onshape-tunnel.sh --clear` (or remove the `#force` line and
un-comment `ERP_URL` in `.env.local`), restart the ERP dev server, and toggle the switch off
then on so the stale tunnel webhook is deregistered.

## Selector Notes

- Save button reads **"Update"** (not "Save"); the switch itself does not submit.
- `[switch] "Sync released assets"` = `assetSyncEnabled`;
  `[switch] "Import released revisions"` = `releaseImportEnabled`;
  `[button] "Run"` = the backfill action (hidden unless `assetSyncEnabled` — read from the
  LIVE form value, so it appears the moment the switch flips, before save).
- `releaseImportMode` renders as two **Choice cards** ("Create a change notice" / "Create
  the revision directly"), because `type: "options"` with a small static `listOptions` list
  takes the card affordance (`IntegrationForm.tsx`). The cards are UNMOUNTED while
  `releaseImportEnabled` is off, and an unmounted field posts NOTHING — hence the zod
  `.default("changeNotice")` rather than a bare enum.
- `webhookSigningSecret` is a `Password` field under a **Security** group heading; the
  release-import fields sit under a **Release import** heading (`settingGroups`,
  `config.tsx:16-27`).
- `SwitchField` posts the literal strings `"true"`/`"false"`, which is why the schema
  preprocesses explicitly (`z.coerce.boolean()` would read `"false"` as true) and why
  `visibleWhen.equals` is the string `"true"`.

## Common Failures

- All `.dev` URLs return HTTP 000 / `chrome-error://` → portless routes not registered
  (root-owned `~/.portless`). Use `--no-portless`, or
  `sudo chown -R $USER ~/.portless` + restart the proxy and `crbn up`.
- Webhook / settings loader "Integration query failed" → the node server can't reach
  `SUPABASE_URL` (again portless `.dev` unresolved). localhost mode fixes it.
- Row insert "metadata does not match jsonschema" → metadata is missing
  `baseUrl`/`credentials`, or the release-import migration has not been applied and you are
  on a build with `additionalProperties: false`.
- Saving the switch bounces it back off with "Onshape is connected with read-only access" →
  `metadata.scope` lacks `OAuth2Write`. Only a reconnect widens the scope; a token refresh
  does not.
- "Saved Onshape settings, but couldn't register the release webhook" → settings persisted,
  registration failed. Usually no Onshape company resolved
  (`resolveAndStoreOnshapeCompanyId` returned null) or `ERP_URL` is not publicly reachable.
- A run stuck retrying with "no dispatcher registered" → the ERP has not served
  `/api/inngest` yet in this process. Hit the ERP once and let Inngest retry.
- Release import silently does nothing while asset sync works → check
  `releaseImportEnabled` in metadata, not the UI: a read-only-scope save forces BOTH
  switches off.
