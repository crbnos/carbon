# Make Method — New Version, Version change notice, Get Method

Last tested: 2026-10-22
Routes: /x/part/{itemId}/details?methodId={makeMethodId} · /x/change-notice/new · /x/items/change-notice/{id}/details

## Prerequisites
- The satellite demo dataset (`pnpm db:seed:dev --dataset satellite`). Useful parts:
  - a Make part whose only version is a Draft with BoM + BoP (COMMS-001 had v1 Draft, 3 materials, 2 operations);
  - a Make part with an Active v1 (EPS-001, ADCS-001).

## Steps
### 1. New Version from the only (Draft) version
- Open the part's details page. The version button reads `V1 Draft`; click it → menu item **New Version**.
- The modal warns "This will set the current version of the make method to Active". Hidden inputs: `copyFromId` = `activeVersionId` = the current method id, `version` = max + 1.
- `requestSubmit` the form whose button reads "Create Version" (NOT a click).
- Verify: the URL gets `?methodId=<new id>`, the button reads `V2 Draft`. In the DB the source is Active and the new Draft has the same material, operation and step counts.

### 2. New Version from an Active version
- Open `?methodId=<v1 id>` (button `V1 Active`) → **New Version**. `activeVersionId` is empty (only sent when the item has one method).
- Verify: v1 stays Active, the new Draft has v1's counts.

### 3. Version change notice
- `/x/change-notice/new` → fill the first textbox (Name) → `requestSubmit` "Save" → redirects to `/x/items/change-notice/{id}/details`.
- **Add Affected Item** → Change Type stays `Version` → open the second combobox, type the part number, click the option → `requestSubmit` "Add".
- Verify: lands on `/{id}/{affectedId}/details` with the Bill of Process and Bill of Material of the draft. In the DB the draft is `max(version)+1`, `changeOrderId` = the notice, counts match the Active base.

### 4. Get Method into a Draft version (regression)
- On a Draft version click **Get Method** → first combobox: type the source part, pick it → second combobox: pick its version → `requestSubmit` "Confirm".
- Verify: the Draft's lines are replaced by the source's.

### 5. A failed copy leaves nothing (the atomicity check)
- Make the copy fail with a temporary trigger (drop it afterwards; check `pg_trigger` is clean):
  `CREATE FUNCTION test_fail_op_copy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'operation copy refused (test)'; END $$;`
  `CREATE TRIGGER test_fail_op_copy BEFORE INSERT ON "methodOperation" FOR EACH ROW WHEN (NEW."companyId" = '<companyId>') EXECUTE FUNCTION test_fail_op_copy();`
  (`methodOperationStepSlide` only fires when the source has steps; the satellite methods have none.)
- New Version on a part whose only version is a Draft → `requestSubmit` "Create Version".
- Verify: toast "Failed to create new version", the URL keeps no `methodId` of a new version, the DB has no new row and the source is still Draft. Drop the trigger; New Version then succeeds with the SAME version number (nothing held it).

## Selector Notes
- The version button is `button "V<n> <Status>"`; its menu has "Version N …", "New Version", "New Change Notice".
- Item pickers: click the combobox, `agent-browser keyboard type "<part number>"`, then click the `option`.
- Read hidden form values with `[...document.querySelectorAll('[role=dialog] form input')]`.

## DB verification
```sql
select m.version, m.status, m."changeOrderId",
  (select count(*) from "methodMaterial" x where x."makeMethodId" = m.id) as bom,
  (select count(*) from "methodOperation" x where x."makeMethodId" = m.id) as ops
from "makeMethod" m where m."itemId" = '<itemId>' order by m.version;
```

## Common Failures
- `agent-browser screenshot .context/x.png` with a relative path saves nowhere useful: pass an absolute path.
- No `psql` on the host: query with `pg` from `packages/database` (`node -e` / a small script) and `SUPABASE_DB_URL` from `.env.local` (the shell exports another stack's).
- Portless URLs need `NODE_EXTRA_CA_CERTS=~/.portless/ca.pem` for scripts; the browser works as is.
- `crbn up --no-portless` pins port 54321 and fails when another worktree's localhost stack holds it; use portless mode.
