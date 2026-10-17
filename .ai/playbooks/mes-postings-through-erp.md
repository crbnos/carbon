# MES postings through the ERP

Last tested: 2026-10-17
Routes (MES): `/x/picking/<pickingListId>`, `/x/operation/<jobOperationId>`, `/x/dispatch/<dispatchId>`

MES runs its postings in the ERP over signed calls (`apps/mes/app/services/erp.ts` →
ERP `api+/internal.postings.$name.ts`). Each flow below is one MES action that makes
one or two internal calls. The ERP dev log shows each as
`POST 200 /api/internal/postings/<name>`, right before the MES action's own line.

## Prerequisites
- `crbn up` with ERP and MES running. The seeded company has jobs, picking lists and
  maintenance dispatches.
- The browser pane blocks every subresource of `*.service-functions.dev`
  (`ERR_BLOCKED_BY_CLIENT`), so the page never hydrates there. Use `agent-browser`.
- The session cookie is set for `DOMAIN` (`service-functions.dev`), so sign in on
  the `.dev` ERP URL, not on `127.0.0.1`.

## Steps

### 1. Sign in
- `agent-browser open <ERP_URL>/login`, fill "Email Address" with `test@carbon.ms`,
  click "Continue". Expect a redirect to `/x`.

### 2. Pick and unpick a picking list line (`post-picking`, as the system)
- Open `<MES_URL>/x/picking/<id>` of an In Progress list with an Inventory line.
- Click the line's **Pick** button (find it by the item's readable id just above it).
- Verify: `pickingListLine.quantityPicked` = `quantityToPick`; two `Transfer`
  ledger rows (−q, +q); the button reads **Unpick**.
- Click **Unpick**: `quantityPicked` back to 0, a reversing Transfer pair.

### 3. Issue material to an operation (`issue` partToOperation, as the system)
- Open `<MES_URL>/x/operation/<id>` of an In Progress operation. Pick one whose job item
  is not serial-tracked (MES first asks for a serial number) and that is not in a batch
  (MES shows the batch view).
- In the materials table, click the row's **Issue Material**. The dialog defaults
  the quantity to the remainder.
- Fill the Quantity textbox, then press Tab so the hidden `quantity` input commits.
  **Increase** steps by 0.00001 here, so it changes the value.
- Submit with `requestSubmit` on the dialog's **Issue** button.
- Verify: `jobMaterial.quantityIssued` up by the quantity; a `Consumption` ledger row.

### 4. Log a completed unit (`issue` jobOperation, as the system)
- On the same page, click **Log completed**, click **Increase** once (quantity 1).
- Submit with `requestSubmit` on **Log Completed**.
- Verify: `jobOperation.quantityComplete` 1; a `Production` `productionQuantity` row;
  each Pull from Inventory material issued by one unit's quantity (backflush).

### 5. Finish the operation (`post-picking` returnOperationRemainders + `post-production-event`)
- **More actions** → **Mark as Done** → submit **Mark as Done Anyways**.
- Verify: operation `Done`; its production events ended with `postedToGL` true; new
  job journal lines. MES `/x/finish` makes both internal calls.

### 6. Complete a maintenance dispatch (`post-maintenance-event`)
- Open `<MES_URL>/x/dispatch/<id>` of an In Progress dispatch with an open event.
- Click **Complete**.
- Verify: dispatch `Completed`; its event ended; a balanced pair of journal lines
  (Maintenance Labor / Labor Absorption) on the dispatch.

## Selector Notes
- `agent-browser snapshot` renumbers refs. Click a ref from the same snapshot you read
  it from.
- In the operation's materials table, each row's text holds the item's readable id,
  and its **Issue Material** button sits in the same row.

## Common Failures
- MES shows "Could not reach the ERP": the ERP dev server is down, or the call
  reached something that is not the ERP (a 502 inside `erpPosting`).
- MES shows "MES is not configured to post to the ERP": `erpPosting` could not
  build the call. The MES log says why ("ERP posting is not configured"). Outside
  local dev, MES posts only to `ERP_URL` and refuses when it is not set. An empty
  `SESSION_SECRET` gives the same message.
- A 404 "MES does not call … with this input": the posting or its `type` is not in
  `MES_POSTINGS` (`packages/api/src/postings.ts`). MES's typecheck should have
  caught it (`ErpPostingInput`).
- A 401: MES and the ERP read different `SESSION_SECRET` values. In local dev it
  is in `.env`, not `.env.local`.
