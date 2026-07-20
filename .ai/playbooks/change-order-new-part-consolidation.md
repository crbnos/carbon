# Change Order — New Part / Replacement Part / Consolidation

Last tested: 2026-07-19
Routes: /x/change-order/new · /x/items/change-order/{coId}/details

## Prerequisites
- A Draft change order (create via `/x/change-order/new` — fill Name, Save).
- For consolidation: an active Make part with an **Active** (non-CO-owned) make method
  and ≥2 BOM components. (M000000001 works locally; parts with only Draft/CO-owned
  methods can't be added as **Version** — the draft-create needs an Active method.)

## Steps

### 1. Create the CO
Navigate `/x/change-order/new` → fill the first textbox (Name) → `requestSubmit` the
form (button "Save"). Redirects to `/x/items/change-order/{coId}/details`.

### 2. Add a net-new New Part (§C)
- Click **Add Affected Item** (explorer bottom button).
- Modal: first control is a **Change type** Select (Version / Revision / Replacement
  Part / New Part). Selecting **New Part** swaps the body to a mini-form: Part Number,
  Name, Type (Part/Tool), Replenishment System.
- **KNOWN BUG:** the Part Number does NOT auto-populate — type one manually
  (e.g. `PBRKT001`). Fill Name; open the Type combobox → pick Part; open Replenishment
  combobox → pick Make.
- `requestSubmit` the modal form (button "Add"). Navigates to the new affected item.
- Verify detail: badge **NEW**; Properties + Bill of Material + Bill of Process (empty);
  **NO** cutover/Part Supersession card.

### 3. Add an assembly as Version (§D)
- Add Affected Item → keep **Version** → open the item picker (2nd combobox) → pick a
  Make part with an Active method. `requestSubmit` "Add".
- Open the assembly's affected-item detail → **Add Item** (BOM) → the item picker
  (`includeInactive`) lists the inactive New Part draft too (it may be past the
  dropdown's first virtualized page — filter/scroll to it).

### 4. Release (§E)
- Advance the CO: click **Advance to Start** → **Advance to Engineering Complete** →
  **Advance to Implementation** → **Release**.
- (Browser refs drift on the release dialog; a reliable fallback is to POST the status
  route directly — see Selector Notes.)

## Selector Notes
- **Submit** Carbon forms with `requestSubmit(button)`, never a click.
- The Add-item modal has **two** ValidatedForms (existing-item vs new-part) toggled by
  the change-type Select; `requestSubmit` the form of the mode you're in.
- **Reliable release** (bypasses the drifty dialog): POST the status route with `id`,
  `fromStatus`, `status`:
  ```js
  fetch(`/x/items/change-order/${coId}/status`, {method:'POST',
    body:(()=>{const f=new FormData();f.append('id',coId);f.append('fromStatus','Implementation');f.append('status','Done');return f})(), redirect:'manual'})
  ```
  (302/opaqueredirect = applied; a 422 means a missing field — `id` is required.)
- **Reliable add** (bypasses the picker): POST `/x/items/change-order/${coId}/affected`
  with `changeOrderId`, `itemId`, `changeType` (existing) or `changeType=New Part` +
  `readableId,name,itemType,replenishmentSystem` (net-new).

## DB verification (the real proof)
```sql
-- Net-new New Part after release: active, and ZERO supersession as successor
SELECT active FROM item WHERE "readableId"='PBRKT001';                 -- t
SELECT count(*) FROM "itemSupersession" s JOIN item i ON i.id=s."successorItemId"
  WHERE i."readableId"='PBRKT001';                                     -- 0
-- Minted New Part is inactive + CO-owned Draft method before release
SELECT active,"revisionStatus","changeOrderId" FROM item WHERE "readableId"='PBRKT001';
```

## Common Failures
- **Version add "silently fails"** — usually the picked part has no **Active** make
  method (only Draft / CO-owned drafts). `createChangeOrderDraftMethod` Version branch
  needs an Active method to version; otherwise it rolls the affected item back.
- **Part Number empty** in the New Part mini-form — `useNextItemId` isn't auto-minting
  in this modal (bug); type a number manually.
- Release dialog confirm button hard to hit via agent-browser — use the direct POST.
