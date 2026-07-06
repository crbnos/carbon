# Onshape Asset Sync

Last tested: 2026-07-03
Routes:
- `/x/settings/integrations/onshape` (settings UI: toggle + backfill action)
- `POST /api/integrations/onshape/backfill` (admin trigger, gated)
- `POST /api/webhook/onshape/:companyId` (inbound receiver, public)

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
 '{"baseUrl":"https://cad.onshape.com","credentials":{"type":"oauth","accessToken":"FIXTURE_FAKE_TOKEN","refreshToken":"FIXTURE_FAKE_REFRESH","expiresAt":"2030-01-01T00:00:00.000Z"},"assetSyncEnabled":false}'::json,
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

### 5. Webhook (public, curl over localhost) — `POST /api/webhook/onshape/<companyId>`:
- active row + `{"event":"onshape.workflow.transition",...}` → `200 {"success":true}`
- missing `event` → `400` zod error
- unknown companyId → `400 "Integration not configured"`

## Cleanup

```sql
delete from "companyIntegration" where id='onshape'
  and metadata->'credentials'->>'accessToken'='FIXTURE_FAKE_TOKEN';
```

## Selector Notes
- Save button reads **"Update"** (not "Save").
- The switch is `[switch] "Sync released assets"`; action button is `[button] "Run"`.

## Common Failures
- All `.dev` URLs return HTTP 000 / `chrome-error://` → portless routes not
  registered (root-owned `~/.portless`). Use `--no-portless` or
  `sudo chown -R $USER ~/.portless` + restart proxy & `crbn up`.
- Webhook / settings loader "Integration query failed" → node server can't reach
  `SUPABASE_URL` (again portless `.dev` unresolved). localhost mode fixes it.
- Row insert "metadata does not match jsonschema" → metadata missing
  `baseUrl`/`credentials` required by the onshape schema.
