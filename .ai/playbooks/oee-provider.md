# OEE Provider (Sense)

Last tested: 2026-10-13
Routes: /x/settings/integrations/sense, /x/production/machine-time, MES /x/operation/:id, MES /display/:workCenterId/work

## Prerequisites
- A seeded company (`crbn up` seeds one): at least one work center with open operations. "CNC Mill" in the satellite demo data has 4.
- The Sense staging API key from the user. Never write it to a file.
- The Inngest dev container must be running: the `oee-sweep` cron fires every 2 minutes.
- If a shell `SUPABASE_DB_URL` points at another worktree's port, export this worktree's URL from `crbn status` before running DB checks.

## Steps
### 1. Install
- Open `${ERP_URL}/x/settings/integrations/sense`.
- Fill the first textbox (the API key, a password field). Click the "Staging" radio.
- requestSubmit the form whose submit button text includes "Install".
- Verify in SQL: `companyIntegration` row `sense` is active, `metadata` has `environment: staging` and NO apiKey (it is in Vault, `secretRef` set).

### 2. Map a device
- Open `?tab=devices`. Expect 55 "Station NNNN" rows (staging company).
- Click the combobox of the "Station 0002" row (first row), pick "CNC Mill".
- requestSubmit the row's form: the forms with a hidden `intent=upsert-work-center-device`, index 0.
- Verify: a `workCenterDevice` row; a warning icon on the row (site timezone UTC vs location America/Chicago).

### 3. Refuse a second device
- Pick "CNC Mill" on row index 1 (Station 0006) and requestSubmit form index 1.
- Poll `[data-sonner-toast]` every 0.5 s right away (the revalidation re-reads Sense and can take 10 s+).
- Expected toast: "Failed to save device mapping: CNC Mill already has Station 0002 from Sense".

### 4. Sync and attribution (inject state changes)
Sense staging stations change state only every few hours, so inject `machineStateChange` rows. Insert ONE row per statement with explicit casts (`'Idle'::"machineState"`, `'…'::timestamptz`); a UNION drops the literal types.
- Wait for `workCenterDevice.lastSyncedAt` to pass a time (use an `until` loop; one sync every 2 minutes).
- First sync: `currentState` set, `currentStateAt` = the mapping time.
- MES: open the operation of an In Progress job at CNC Mill. The Machine toggle shows a state badge.
- Select the "Toggle machine" radio. Press "Pause" (stop) or "Start". Verify `workCenterDevice.lastManualChangeAt` = the press time; Start loads the operation (`workCenter.loadedJobOperationId`).
- Inject Idle at press+~1 min and Running a minute later. After the sync, the operator's event ends at the Idle time and a new Machine event (no employee, `createdBy = system`) opens on the loaded operation.
- Set that operation to Done in SQL (pick one that is not the job's last). The next sync opens an `unattributedMachineTime` row starting at the completion time.
- Inject Idle / Running / Idle to get closed rows.

### 5. Unattributed Machine Time
- `${ERP_URL}/x/production/machine-time` lists the rows; times show in the work center's location timezone.
- Open a row, open the Operation combobox, pick a candidate (Done operations are not offered), requestSubmit the form with hidden `intent=assign`. Verify the row is Assigned and a Machine `productionEvent` has the row's start and end, `employeeId` null, `postedToGL` false.
- Open another closed row, requestSubmit `intent=dismiss` with no reason → "Reason is required". Fill the reason textbox and submit → Dismissed.

### 6. Display
- MES `${MES_URL}/display/<workCenterId>/work` shows the device state badge; the "Loaded:" line appears only when an operation is loaded.

## Selector Notes
- Device rows: one `ValidatedForm` per device, find by `input[name=intent][value=upsert-work-center-device]`, index = row order.
- Machine time drawer: two forms, `intent=assign` and `intent=dismiss`.
- MES work type toggle: radios "Toggle setup" / "Toggle labor" / "Toggle machine"; the action button reads "Start" or "Pause".

## Common Failures
- "The operation was aborted due to timeout" on a device or the Devices tab: Sense staging latency spikes past 15 s. The next sync usually succeeds; the tab still lists mapped devices.
- Authz tests "must be owner of function sync_…": `crbn migrate` created the handler as `supabase_admin`. Run `ALTER FUNCTION … OWNER TO postgres` locally.
- No `psql` on the host: pipe SQL test files into `docker exec -i <postgres container> psql -U postgres -d postgres`.
