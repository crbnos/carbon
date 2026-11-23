# Receipt Void — Tracked Entities

Last tested: 2026-10-16
Route: /x/receipt/<id>/details → More options → Void

## Prerequisites
- A Batch part and a Serial part. Create at /x/part/new: Part ID (1st textbox),
  Revision (2nd, keep "0"), Name (3rd), "Tracking Type" combobox (the one
  showing "Inventory") → Batch / Serial, requestSubmit Save.
- A finalized PO for them (see create-purchase-order.md). The supplier picker
  hides a just-created Pending supplier; pick a seeded one (satellite:
  "AstroMill Machining").
- For the On Hold case: the part's Quality tab → Inspection Plans "New"
  (drawing number only) → Inspection Plan Assignments, Receipt slot → the
  new plan → requestSubmit the form holding `inspectionDocumentId`.

## Steps
### 1. Receive
- PO → "Receive" (or "Receipts" menu → "New Receipt" once one exists).
- "Batch number" textbox, "Serial N" textboxes; click the "Receipt Lines"
  heading to blur after each (blur saves). Draft entities are On Hold.
### 2. Post
- "Post" → "Post Receipt" → satellite rules raise "Rule Violation" →
  "Acknowledge & continue". Entities: Available (On Hold when inspected).
### 3. Void
- "More options" (header) → menuitem "Void" → "Void Receipt".
### 4. Verify
- Inventory → Tracked Entities (`/x/inventory/tracked-entities?search=...`):
  every entity of the receipt is quantity 0, Consumed (Rejected/Scrapped kept).
- Read-only DB check:
  `select "readableId", status, quantity from "trackedEntity" where attributes->>'Receipt' = '<receipt id>'`
- Picker RPC returns nothing:
  `select count(*) from get_available_tracked_entities(p_item_id=>'<item>', p_company_id=>'<co>', p_location_id=>'<loc>')`

## Edge cases (expected behaviour)
- Partial receipt (2 of 3) void: PO line back to 0, entities Consumed/0.
- The inspection of a voided receipt shows a "Receipt voided" badge and every
  action is off; a direct POST is refused "The receipt of this inspection was voided".
- An untracked lot rejected (written off) before the void: the void is refused
  in the modal, naming the inspection.
- A serial or batch moved to another bin (stock transfer), picked, shipped or
  adjusted out before the void: the void is refused in the modal ("moved, picked
  or shipped"). Every refusal shows its own reason, never "Failed to void receipt".
- A serial from a voided receipt can be entered on a new receipt: on the draft
  it is On Hold/1 again, and after posting it is the same tracked entity, Available/1.

## Common Failures
- Session lands on /login with "User record not found": the stack's kong/gotrue
  containers died. `docker start <project>-kong-1 <project>-gotrue-1`, log in again.
- `agent-browser screenshot` with a relative path does not land in the repo;
  pass an absolute path.
