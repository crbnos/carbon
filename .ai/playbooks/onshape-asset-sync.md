# Onshape Asset Sync

Last tested: 2026-07-03
Routes:
- `/x/settings/integrations/onshape` (settings UI: toggle + backfill action + the
  "View sync dashboard" link action)
- `/x/settings/integrations/onshape/sync` (sync dashboard: run card + Items /
  Runs / Release exceptions tabs; `path.to.integrationOnshapeSync(itemId?)`)
- `POST /api/integrations/onshape/backfill` (admin trigger, gated)
- `POST /api/integrations/onshape/backfill/cancel` (records the cancellation)
- `POST /api/integrations/onshape/item-sync/:itemId` (per-part re-pull)
- `POST /api/webhook/onshape/:companyId` (inbound receiver, public)
- `/x/items/engineering` (engineering data table; `path.to.engineeringData`)

Surfaces:
- Part sidebar **Onshape block** (`/x/part/:itemId/details`, properties panel):
  revision + release chip, per-asset Model/Drawing chips, "Pull from Onshape",
  and a "Sync details" link into the dashboard filtered to that part.
- **Sync dashboard** — reachable from the Onshape drawer's Actions section
  ("View sync dashboard" → Open) and from the block's "Sync details".
- **Engineering Data page** — "Engineering Data" in the Items sidebar group
  (`/x/items/engineering`), reading the `onshapeEngineeringData` view.

## Prerequisites

- Dev stack up. **Use `crbn up --no-portless`** (plain localhost) — the portless
  `.dev` URLs did not resolve for the node server / curl / automation browser on
  this machine (root-owned `~/.portless` → no routes registered). localhost mode
  sidesteps it entirely. ERP at `http://localhost:3000`, API at `:54321`.
- Onshape is NOT connected on a fresh seed (`ONSHAPE_CLIENT_ID` unset, no
  `companyIntegration` row). The toggle/backfill only render when an ACTIVE
  `companyIntegration` row exists, so inject a fixture (fake OAuth creds):

```sql
-- companyId: get with: select id from company limit 1;
insert into "companyIntegration" (id,"companyId",active,metadata,"updatedAt","updatedBy")
values ('onshape','<companyId>',true,
 '{"baseUrl":"https://cad.onshape.com","credentials":{"type":"oauth","accessToken":"FIXTURE_FAKE_TOKEN","refreshToken":"FIXTURE_FAKE_REFRESH","expiresAt":"2030-01-01T00:00:00.000Z"},"assetSyncEnabled":true}'::json,
 now(),'<userId>')
on conflict (id,"companyId") do update set active=excluded.active, metadata=excluded.metadata, "updatedAt"=now();
```

The metadata MUST match the onshape `integration.jsonschema` (requires
`baseUrl` + `credentials{type,accessToken,refreshToken,expiresAt}`) or the
`sync_verify_integration` trigger rejects the row when `active=true`.

## Steps

### 1. Login — `http://localhost:3000/login`, fill "Email Address" = `test@carbon.ms`, click "Sign in with Email". The button enables only after a valid email; redirects to `/x`.

### 2. Settings — navigate `/x/settings/integrations/onshape`. Expect a "Sync released assets" **switch** (off) and a "Backfill released assets" action with a **"Run"** button.

### 3. Toggle persistence — flip the switch on, click **"Update"** (the save button; NOT a click-to-submit on the switch). Redirects to `/x/settings/integrations`. Verify the DB merge preserved credentials:

```sql
select jsonb_pretty(metadata::jsonb) from "companyIntegration" where id='onshape';
-- expect: assetSyncEnabled=true AND baseUrl + credentials still present
```

### 4. Backfill gating — POST the endpoint from the authenticated session:
- `assetSyncEnabled=true`  → `200 {"success":true,"message":"Onshape asset backfill started"}`
- `assetSyncEnabled=false` → `400 "...asset sync is disabled..."`

### 5. Sync dashboard — from the Onshape drawer's **Actions** section click **Open** on "View sync dashboard" (or navigate `/x/settings/integrations/onshape/sync`). Verify:
- With no runs: the card reads "No syncs have run yet" and both it and the header
  offer **Start sync**.
- **Start sync** posts the backfill route; the card flips to a status chip +
  progress bar + elapsed clock + the five counters (Scanned / Matched / Synced /
  Skipped / Failed; hover Skipped for the breakdown). The page revalidates every
  2s while the run is queued or running, and the header **Start sync** is disabled
  with a tooltip for as long as it is.
- **Cancel sync** opens the confirm modal ("Cancel this sync? Items already synced
  are kept. This action is recorded."); confirming writes `cancelled` +
  `cancelledBy`, the card shows "Cancelled by {name} · {relative time}" and yields
  **Start new sync**.
- **Items** tab: one row per part × asset with status chip, source, reason and
  last-synced; filter by Status/Asset; a failed row expands to the full error; the
  ⋮ menu offers **Sync again** on failed/skipped model rows (needs `parts_update`).
- **Runs** tab: history with status chips (plus a red "N failed" chip), initiator,
  started/finished, duration, counters summary, cancelledBy.
- **Release exceptions** tab: the latest run's unmatched + ambiguous releases in
  one table with a Reason column, plus "and N more" lines when the stored lists
  were capped.
- Deep links: `?status=failed` (the red chip on a completed run) narrows the Items
  tab; `?filter=itemId:eq:<itemId>` (the block's "Sync details") narrows it to one
  part.

### 6. Engineering Data page — click **Engineering Data** in the Items sidebar group (or navigate `/x/items/engineering`). Verify:
- With no BOM ever synced: the table's empty state reads "Run a BOM sync from a
  part's BoM Explorer to populate this table" and links to `/x/items/parts`.
- With synced rows: one row per part whose BOM came from Onshape — part (links to
  the part's details page), revision, release state chip, mass, material, vendor,
  and the TWO separate freshness columns **Data synced** and **State synced**
  (both relative times, both present in the CSV download; "—" wherever the value
  is null).
- Search narrows on part number and name; the default sort is part number ascending.

Rows only appear once a BOM has been synced from a part's BoM Explorer (they come
from `externalIntegrationMapping` rows with `integration='onshapeData'`). To probe
the page without Onshape, insert a mapping row against an existing item:

```sql
insert into "externalIntegrationMapping"
  ("entityType","entityId","integration","externalId","metadata","companyId")
values ('item','<itemId>','onshapeData','<partNumber>',
  '{"State":"Released","Mass":1.234,"Material":"6061-T6","Vendor":"Acme Metals",
    "engineering":{"state":"Released","mass":"1.234","material":"6061-T6","vendor":"Acme Metals"}}'::jsonb,
  '<companyId>');
```

### 7. Webhook (public, curl over localhost) — `POST /api/webhook/onshape/<companyId>`:
- active row + `{"event":"onshape.workflow.transition",...}` → `200 {"success":true}`
- missing `event` → `400` zod error
- unknown companyId → `400 "Integration not configured"`

## Fixture SQL — sync-state rows (verified 2026-07-31 against 20260730150444)

The Pull from Onshape button 400s (silent no-op in the UI) unless the
integration metadata has `assetSyncEnabled:true` — the fixture above now seeds
it true. Resolve ids first:
`SELECT id FROM "user" WHERE email='test@carbon.ms'` and
`SELECT id FROM company LIMIT 1`.

```sql
-- One synced model row for a part (unique on itemId+assetKind+companyId)
INSERT INTO "onshapeItemSyncState"
  ("companyId","itemId","assetKind","status","source","observedOnly",
   "partNumber","revision","releaseState","documentId","versionId","elementId","createdBy")
VALUES
  ('<companyId>','<itemId>','model','synced','backfill',false,
   'TEST-ONSHAPE-001','A','Released','doc-fixture','ver-fixture','el-fixture','<userId>');

-- A live run for the dashboard card (cast JSON columns explicitly)
INSERT INTO "onshapeSyncRun"
  ("companyId","status","startedAt","revisionsScanned","matched","synced","failed",
   "unmatchedReleases","createdBy")
VALUES
  ('<companyId>','running',NOW(),40,10,6,1,
   '[{"partNumber":"PRT-999","revision":"A","state":"Released"}]'::jsonb,'<userId>');
```

Notes: the Release exceptions tab reads ONLY the latest run by `createdAt` —
seed the exceptions-bearing run last (or verify the tab before inserting the
next run). `onshapeData` engineering rows for the Engineering Data page:
`metadata` must carry an `engineering` object
(`{"state":"Released","mass":"1.2 kg","material":"AL 6061","vendor":"Acme"}`).

## Cleanup

```sql
delete from "companyIntegration" where id='onshape'
  and metadata->'credentials'->>'accessToken'='FIXTURE_FAKE_TOKEN';
```

## Selector Notes
- Save button reads **"Update"** (not "Save").
- The switch is `[switch] "Sync released assets"`; the backfill action button is
  `[button] "Run"` (it reads "Started" and navigates to the dashboard once the run
  is queued); the dashboard link action button is `[button] "Open"`.
- Both action rows only render when "Sync released assets" is on (live form value).
- On the dashboard the tabs are `[tab] "Items" | "Runs" | "Release exceptions"`;
  the cancel dialog's confirm button reads **"Cancel sync"** and its dismiss button
  **"Keep syncing"**.

## Common Failures
- All `.dev` URLs return HTTP 000 / `chrome-error://` → portless routes not
  registered (root-owned `~/.portless`). Use `--no-portless` or
  `sudo chown -R $USER ~/.portless` + restart proxy & `crbn up`.
- Webhook / settings loader "Integration query failed" → node server can't reach
  `SUPABASE_URL` (again portless `.dev` unresolved). localhost mode fixes it.
- Row insert "metadata does not match jsonschema" → metadata missing
  `baseUrl`/`credentials` required by the onshape schema.
