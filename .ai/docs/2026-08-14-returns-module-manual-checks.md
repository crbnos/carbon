# Returns Module — Step-by-Step Manual Test Script

A click-by-click script for verifying the Returns module (customer RMAs +
supplier returns) on the local dev stack. Every test says exactly what to
click, what to type, and what you must see. Tests marked ✅ were already
executed end-to-end during implementation (on the Northspoke Cycles demo
company, which now contains `RMA000001` Completed, `RMA000002` Confirmed, and
`RTS000001` Shipped from that run — your numbers will continue from there).

**Conventions used below**
- **Bold** = something you click or a screen region. `Monospace` = something
  you type or a value you must see.
- "Left rail" = the icon/button column on the far left (Accounting, Inventory,
  Sales, …). "Sidebar" = the second column that appears inside a module
  (Manage / Configure groups).
- Where a test needs data from an earlier test, it says so at the top.

---

## T0 — Setup and login

1. Make sure the stack is running (`crbn up` done; app on the `ERP_URL` from
   `.env.local`, normally `http://localhost:3000`).
2. Open the app. On the login page, type `test@carbon.ms` into **Email
   Address** and click **Sign in with Email**.
3. On **Choose a company**, click **Northspoke Cycles**.
4. **Expected:** the dashboard loads with the left rail visible.

> Known local-DB quirk (pre-existing, not from this branch): money values may
> render without trailing zeros (`$1899` instead of `$1,899.00`) because the
> local DB is missing `companySettings.showCurrencyTrailingZeros`. The
> Appendix has a one-shot fix.

---

## T1 — Navigation and empty states

1. Click **Sales** in the left rail.
2. **Expected:** the sidebar's **MANAGE** group contains **RMAs** (between
   Orders and Portals) and the **CONFIGURE** group contains **Return
   Reasons**.
3. Click **RMAs**. **Expected:** a table titled **RMAs** with columns RMA
   number, Customer, Status, Order Date, Received, Credited, Assignee,
   Created — plus an **Add RMA** button. (On a fresh company the table is
   empty with an Add RMA empty-state.)
4. Click **Purchasing** in the left rail. **Expected:** **Supplier Returns**
   appears in the MANAGE group. Click it — a mirror table with a **Shipped**
   column and a **Supplier RMA #** column.

---

## T2 — Return Reasons configuration screen

1. **Sales → Return Reasons** (CONFIGURE group).
2. **Expected:** six seeded rows: `Defective`, `Wrong Item Shipped`,
   `Damaged in Transit`, `No Longer Needed`, `Warranty`, `Other`. Each row
   has a **Zero Inventory Value** column showing `No`.
3. Click **New Return Reason** (top right). In the drawer, type
   `Customer Remorse` into **Name**, leave the **Zero inventory value**
   toggle off, click **Save**. **Expected:** the row appears; a success toast
   shows.
4. Click the `Damaged in Transit` row (or its Edit menu item). Turn ON
   **Zero inventory value** ("Returned goods re-enter inventory at zero
   value"). **Save**. **Expected:** its column now shows `Yes`. (T8 uses
   this.)
5. Open the row menu on `Customer Remorse` → **Delete** → confirm.
   **Expected:** row gone. (Deleting a reason that is used by an RMA line is
   refused with an "in use" error instead.)

---

## T3 — Create an RMA from a shipped order (the linked path) ✅

*Uses: a customer with a POSTED shipment. In the demo data, `Cascade Bike
Shop` received 4 × `BIKE-GX` (a serialized bicycle) on shipment `SHP000010`.*

1. **Sales → RMAs → Add RMA**.
2. **Expected form defaults:** **RMA ID** shows "Next Sequence" (leave it),
   **Order Date** is pre-filled with today's date on the company calendar,
   **Return Location** defaults to your location, **Currency** to `US
   Dollar`.
3. In **Customer**, select `Cascade Bike Shop`. **Expected:** currency/
   contact/location follow the customer where configured.
4. Optionally type the customer's claim number into **Customer Reference**
   (e.g. `CLAIM-123`).
5. Click **Save**.
6. **Expected:** you land on the RMA detail page. The header shows a new
   readable id (`RMA0000NN`), a gray **Draft** badge, a disabled **Confirm**
   button (no lines yet), and **Cancel**. The left explorer shows "Looks
   empty here" with **Add Line Item** and **Add lines from document**. The
   right rail shows Properties (customer, dates, currency).
7. Click **Add lines from document**.
8. **Expected:** a list of that customer's returnable shipment lines — for
   Cascade: `BIKE-GX — Gravel GX Complete Bicycle`, shipment `SHP000010`,
   order `SO000001`, **Returnable: 4**, unit price `1899`. **This list is
   your legitimacy check:** it contains ONLY items actually shipped to this
   customer, minus anything already authorized on other RMAs. If an item is
   not in this list, the system has no record of shipping it to them.
9. Tick the BIKE-GX row, change its quantity to `2` (try typing `9` first —
   the input clamps to the returnable 4; the hard stop is at Confirm), and
   click the modal's confirm/add button.
10. **Expected:** the explorer now shows the line (`0 / 2` received,
    disposition `Pending`). Click the line.
11. **Expected line form:** Item, Quantity `2`, Unit Price `1899` (copied
    from the sales order line — the credit basis), Restocking Fee `0`,
    Return Reason select, **linkage chips** showing `SO000001` /
    `SHP000010`, a Disposition select (disabled — nothing received yet), and
    an **Expected serials** section listing the serials shipped to this
    customer. Pick 2 of them.
12. Set **Return Reason** to `Defective`. Save the line.

---

## T4 — Create a blind RMA (no document links)

1. **Sales → RMAs → Add RMA**, pick any customer, **Save**.
2. Click **Add Line Item** (not "from document").
3. **Expected:** the **Item** selector offers the full item catalog — this is
   the deliberate *blind return* path for goods that arrive without matchable
   paperwork. Note what distinguishes a blind line everywhere downstream:
   **no linkage chips** on the line form, **no quantity cap** at Confirm, and
   receipt posting values it at **current cost** (not original cost). If you
   want to verify the claim first, close this and use **Add lines from
   document** — absence from that list means "never shipped to this
   customer".
4. Pick any item, Quantity `1`, Unit Price as agreed, Save.
5. This RMA can run the whole T6–T10 lifecycle identically; for tracked items
   the receipt will create a **new** serial/batch (On Hold) instead of
   reactivating one — visible in Traceability as an entity with no shipment
   lineage (another blind-return tell).
6. Clean up: delete this RMA (header **⋯ → Delete**) or keep it for T5.

---

## T5 — Over-authorization is rejected at Confirm ✅

*Uses: T3's shipment line (4 shipped, 2 already authorized on your T3 RMA).*

1. Create a second RMA for `Cascade Bike Shop` (as T3 steps 1–5).
2. **Add lines from document** → the same BIKE-GX line now shows
   **Returnable: 2**. Add it, then open the line and change **Quantity** to
   `3`, Save. (The form warns/clamps; if it clamps, set 3 via the modal's
   quantity before adding.)
3. Click **Confirm** in the header.
4. **Expected:** an error toast naming the line: cannot authorize `3` — only
   `2` of `4` remains returnable for the linked document line. The RMA stays
   **Draft**. ✅
5. Fix the quantity to `2`, Confirm again — now it succeeds. Keep this RMA
   **Confirmed** for T10 (void test) or Cancel it (header **Cancel**;
   allowed because nothing is received).

---

## T6 — Confirm: sequence id + PDF ✅

*Uses: the T3 RMA (Draft, one linked line with 2 expected serials).*

1. On the T3 RMA, click **Confirm**.
2. **Expected:** status badge flips to **Confirmed**; a success toast shows.
3. **Expected:** a **PDF** button/link appears in the header — click it. A
   PDF opens titled **Return Merchandise Authorization** with the RMA
   number, customer block, return-to address, and the line (item, qty 2,
   price, reason). ✅
4. On **Details**, the documents area lists the attached
   `RMA0000NN - <timestamp>.pdf`. ✅
5. Negative checks: **Confirm** is no longer offered; header edits are still
   allowed until Completed/Cancelled.

---

## T7 — Receive the return (same-serial re-entry) ✅

*Uses: the T6 Confirmed RMA.*

1. **Inventory** (left rail) → **Receipts** → **New Receipt**.
2. In the receipt form, set **Source Document** = `Sales Return Order`.
3. **Expected:** the **Source Document ID** combobox lists open RMAs
   (Confirmed / Partially Received only). Pick your RMA.
4. **Expected:** the receipt is created (`RE0000NN`) with one line,
   quantity `2` = the outstanding amount, unit price `0` (cost is resolved
   at posting, never the credit price).
5. On the receipt line, **Expected:** instead of the usual free-text serial
   inputs, you get **Returned serial numbers** — two dropdown slots offering
   ONLY the serials you picked on the RMA line (and only ones currently
   Consumed, i.e. actually out with the customer). Assign both slots. ✅
   - Negative check: there is no way to type an arbitrary serial here — a
     serial you never shipped cannot be booked back.
   - Partial receipt: you can lower the received quantity to `1` first; post;
     the RMA goes **Partially Received**; a second receipt takes the rest.
6. Click **Post** on the receipt header.
7. **Expected:** receipt goes **Posted**; navigate back to the RMA
   (breadcrumb or Sales → RMAs) — status is now **Received** (or Partially
   Received if you split), and the line shows `2 / 2` received. ✅

---

## T8 — Verify the money and the genealogy ✅

*Uses: the T7 posted receipt. Needs accounting enabled (it is on the demo
company).*

1. **Accounting → Journal Entries**. Open the newest entry.
2. **Expected:** source `Sales Return Receipt`, two balanced lines —
   **Dr Inventory / Cr Cost of Goods Sold** — at the **original outbound
   cost**, not the sale price and not necessarily current cost. For the demo
   BIKE-GX: the original shipment consumed 4 units for `3129.67`, so 2 units
   re-enter at `1564.84` (2 × 782.4183), while the sale price was 1899. ✅
3. **Items → Traceability** (or the item's tracking view): find one of the
   returned serials. **Expected:** the SAME entity id, status **On Hold**,
   with a `Return Receipt` activity linking back through its original
   shipment history. ✅
4. Zero-value path: repeat T3→T7 with a line whose **Return Reason** is
   `Damaged in Transit` (flagged in T2). **Expected:** receipt posts, stock
   quantity appears, but NO journal entry is created and the inventory layer
   is worth `0`.
5. Blind path: a blind line (T4) posts at the item's current cost instead.

---

## T9 — Dispositions ✅ (Use As Is) / Return to Customer / Scrap→Issue

*Uses: the T7 Received RMA.*

**A. Use As Is ✅**
1. Open the RMA line. **Disposition** is now enabled. Select `Use As Is`.
2. **Expected:** success toast. In tracked entities / on-hand views, both
   returned serials are now **Available** (sellable stock). ✅

**B. Return to Customer (claim rejected)**
1. On a received line, set **Disposition** = `Return to Customer`.
2. **Inventory → Shipments → New Shipment**, **Source Document** =
   `Sales Return Order`, pick the RMA (listed once Partially
   Received/Received).
3. **Expected:** a shipment is created with the received-not-yet-shipped-back
   quantity. For serials, the line tracking accepts the **On Hold** returned
   entities (normally only Available stock can ship — this source is the
   exception).
4. **Post** the shipment. **Expected:** stock leaves again at carried cost
   (journal Dr COGS / Cr Inventory), the serials go back to **Consumed**
   with a `Return Shipment` activity.

**C. Scrap / Rework → quality Issue**
1. On a received line, choose `Scrap` (or `Rework`) in the disposition
   select.
2. **Expected:** you are redirected to a NEW quality **Issue**, pre-filled:
   the item at the received quantity with disposition Scrap, the returned
   serials attached, and an **RMA Lines** association pointing back at your
   RMA line. The RMA line shows disposition `Scrap`.
3. The Issue owns it from here: work it and **Complete** it — the write-off
   posts through the Issue's close (check Journal Entries for the
   `Non-Conformance` entry). The RMA itself posts no GL for scrap.

---

## T10 — Void the receipt ✅

*Uses: the T5 second RMA (Confirmed), or any RMA you can receive fresh.*

1. Receive it fully (T7 steps; serial assignment optional for this test) and
   post.
2. **Expected:** RMA **Received**, quantities counted.
3. On the receipt, open the header menu → **Void** → confirm in the modal.
4. **Expected:** receipt **Voided**; the RMA drops back to **Confirmed**
   with `0` received ✅; assigned serials return to **Consumed**; on-hand
   for the item is back where it started (the ledger entries net to zero);
   and the voided return's stock cannot be consumed by later shipments
   (its cost layers are zeroed). ✅

---

## T11 — Issue credit with a restocking fee ✅

*Uses: the T7 Received RMA (2 received, Use As Is).*

1. Open the RMA line, set **Restocking Fee** to `0.1` (10%, entered as a
   0–1 fraction like discounts), Save.
2. On the RMA header, click **Issue Credit** (requires invoicing
   permission).
3. **Expected modal:** one row per creditable line — Received `2`, Credited
   `0`, an editable Quantity defaulting to `2`, a fee preview, and a total:
   `2 × 1899 × (1 − 10%) = 3,418.20` with `379.80` fee. ✅
4. Submit. **Expected:** you land on a **Draft credit memo**
   (`CR-YYYY-MM-0000NN`) for `3,418.20`, linked to the RMA (the RMA's
   **Credits** panel lists it). ✅
5. Click **Post** on the memo. **Expected:** memo **Posted**; its reason
   account is **4900 — Sales Returns** (the seeded contra-revenue account);
   back on the RMA, **Credited** now shows `2`. ✅
6. Partial + void behavior: credit 1 of 2 instead — a second credit later
   offers the remaining 1; **Void** a posted memo — the RMA's Credited drops
   back (the pool re-opens). Two drafts cannot double-credit the same
   quantity (the cap counts drafts).

---

## T12 — Replacement order ✅ (link) 

1. On the RMA header, click **Create Replacement Order**.
2. **Expected:** a new **Draft sales order** opens, pre-filled with the RMA's
   customer and lines, priced by the normal price resolution (edit to `0`
   for a warranty replacement). Its Customer Reference carries the RMA
   number.
3. Back on the RMA, the header now shows a link chip to that SO instead of
   the button (one replacement per RMA; clicking the action again just
   returns the existing one).

---

## T13 — Short-close and the Complete guard ✅

1. Take an RMA that is partially received (e.g. authorize 2, receive 1).
2. Click **Complete** on the header. **Expected:** blocked, with messages
   naming each problem: "Line 1 is short of authorized quantity (1 of 2)…"
   and/or "…has received quantity pending disposition". ✅
3. On the line, click **Stop Receiving** (short-close). Set the received
   quantity's **Disposition**.
4. **Complete** again. **Expected:** status **Completed**; the document
   locks (line edits disabled). ✅
5. Also check **Cancel** rules: allowed only while nothing is received and
   no receipt document exists (delete the draft receipt first if you made
   one).

---

## T14 — Supplier return end-to-end ✅

*Uses: a supplier with POSTED PO receipts. Demo: the steel-tube supplier has
20 × `4130-STEEL-DB-ROUNDTUBE-Ø28.6` received.*

1. **Purchasing → Supplier Returns → New**.
2. Pick the **Supplier**. Type the supplier's own authorization number into
   **Supplier RMA #** (e.g. `SUP-RMA-77`) — most suppliers require theirs on
   the paperwork. **Save**. **Expected:** `RTS0000NN`, **Draft**.
3. Click **Add from document**. **Expected:** ONLY receipt lines from this
   supplier with returnable remainders (received − already returned), each
   showing its receipt + PO numbers. Rows that can't be traced to a posted
   receipt are labeled **Blind** — same scrutiny rule as customer RMAs: use
   this list to verify you actually bought the part from them. Quantities
   and prices here are in the stocking (inventory) unit, converted once from
   the PO's purchase unit.
4. Add a line (e.g. qty `5`). For serial/batch items, the line's entity
   picker offers only **Available stock received from that supplier**.
5. **Confirm**. **Expected:** cap check (received − already returned),
   status **Confirmed**, PDF titled **Return to Supplier** showing
   `Supplier RMA #: SUP-RMA-77`. ✅
6. **Inventory → Shipments → New Shipment**, **Source** =
   `Purchase Return Order`, pick the RTS. **Expected:** lines pre-fill with
   the open quantities. **Post** it.
7. **Expected:** RTS status **Shipped** (or Partially Shipped), line shows
   `5` shipped ✅; **Accounting → Journal Entries** has a
   `Purchase Return Shipment` entry: **Cr Inventory (Raw Materials) / Dr
   GR/IR Clearing** at carried cost (demo: 5 × 24 = `120`) ✅; shipped
   tracked entities go **Consumed** with a `Return Shipment` activity.
   Voiding the shipment reverses all of it and reopens the quantities.
8. **Issue Credit** on the RTS header → quantities default to shipped −
   credited → submit → **Draft AP credit memo** (demo: 5 × 12 = `60`).
   **Post** it. **Expected:** reason account **GR/IR Clearing** (netting the
   shipment's GRNI debit), and the RTS **Credited** column shows `5`. ✅
9. **Create Replacement Order** → a draft **PO** priced from the linked PO
   line / supplier part, cross-linked.
10. **Complete** works once every non-short-closed line is fully shipped
    (no disposition step exists on this side — goods just leave).

---

## T15 — Quality bridge: Issue → supplier return

*Uses: a quality Issue whose disposition rows are `Return to Supplier` —
create one via **Quality → Issues → New** with a purchased item, set the
item row's disposition to `Return to Supplier`, and associate the supplier
(or a receipt line) under Associations.*

1. On the Issue's **Details** page, below the disposition list, **Expected:**
   a **Supplier Return** card with a supplier picker (optional) and a
   **Create Supplier Return** button (needs purchasing permission).
2. Click **Create Supplier Return** (leave the picker empty when the issue
   has exactly one associated supplier — it auto-resolves; with several, you
   must pick one).
3. **Expected:** you land on a new **Draft RTS** pre-filled with the item,
   the uncovered quantity, the issue's tracked entities, and — where the
   issue has receipt-line associations from that supplier — the receipt/PO
   links and price. The Issue's Associations tree now shows **Supplier
   Return Lines**.
4. Click **Create Supplier Return** again (from the Issue). **Expected:** no
   duplicate — you are redirected to the existing open draft (quantities are
   owned per association; only uncovered amounts would create anything).
5. Try to **Complete** the Issue. **Expected:** blocked with "Supplier return
   RTS0000NN is open — ship, short-close, or cancel it first".
6. Confirm + ship the RTS fully (T14 steps 5–7). Now **Complete** the Issue.
   **Expected:** it closes; the write-off journal covers ONLY any quantity
   NOT shipped via the return (fully shipped ⇒ no scrap write-off at all —
   the shipment already relieved inventory against GRNI); the shipped
   entities stay **Consumed** (they are at the supplier, not Rejected in
   your stock).
7. Cancel variant: cancel the RTS instead — its coverage returns to the
   write-off pool and the Issue closes with the full scrap posting.

---

## T16 — Permission checks

*Uses: a second user or an employee type with reduced permissions (Users →
Employee Types).*

- Without **Sales** view: the RMAs nav item and `/x/sales/rmas` are
  inaccessible (403/redirect).
- With Sales but without **Invoicing** create: the **Issue Credit** button is
  hidden/disabled and a direct POST to the credit route is rejected.
- Without **Purchasing**: Supplier Returns screens are inaccessible; the
  Issue's Supplier Return card is hidden.
- Without **Quality** create: the Scrap/Rework escalation is rejected.
- Receiving/shipping stays governed by **Inventory** permissions, unchanged.

---

## T17 — How to verify a return is legitimate (summary)

When someone claims a return and you're not sure the goods were ever traded
with them:

1. **Always try "Add lines from document" first.** It is the system's
   evidence: only posted shipments to that customer (RMA) / posted receipts
   from that supplier (RTS) appear, net of previous returns. Not listed ⇒ no
   trading record ⇒ any line you add is a *blind return* by definition.
2. **Read the linkage chips** on each line. Chips (SO/shipment/invoice or
   PO/receipt) = verified lineage with a hard quantity cap. No chips = blind
   = your judgment call; the system will value it at current cost and, for
   tracked items, mint a brand-new entity with no history.
3. **Serialized goods verify themselves.** The pickers only offer serials
   with the right provenance, and the return receipt refuses any serial that
   wasn't expected on the RMA — a serial you never sold cannot come back.
4. Cross-check history when in doubt: the customer's **Sales → Orders** /
   supplier's **Purchasing → Orders**, the item's ledger, and
   **Traceability** for any serial the party quotes at you.

---

## Appendix — one-shot local dev DB reconcile (optional)

The local DB predates this branch and carries another branch's schema. To
align it with main + this branch (fixes the trailing-zeros display and drops
the foreign cutList scaffolding — verified empty except one throwaway row,
backed up during the run):

```bash
docker exec -i carbon-carbon-postgres-1 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DROP VIEW IF EXISTS "cutLists";
DROP TABLE IF EXISTS "cutListLine" CASCADE;
DROP TABLE IF EXISTS "cutList" CASCADE;
DROP TABLE IF EXISTS "cutPattern" CASCADE;
DROP TABLE IF EXISTS "itemStockDimension" CASCADE;
ALTER TABLE "jobOperation" DROP COLUMN IF EXISTS "jobOperationBatchId" CASCADE;
ALTER TABLE "productionEvent" DROP COLUMN IF EXISTS "jobOperationBatchId" CASCADE;
DROP TABLE IF EXISTS "jobOperationBatch" CASCADE;
DROP TYPE IF EXISTS "cutListStatus";
DROP TYPE IF EXISTS "jobOperationBatchStatus";
DELETE FROM pg_enum WHERE enumlabel = 'Cut List Consumption'
  AND enumtypid = '"itemLedgerDocumentType"'::regtype;
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "showCurrencyTrailingZeros" BOOLEAN NOT NULL DEFAULT true;
COMMIT;
SQL
docker exec carbon-carbon-postgres-1 psql -U supabase_admin -d postgres -c "NOTIFY pgrst, 'reload schema';"
```

Then recreate the two `jobOperationsWith*` views from
`packages/database/supabase/migrations/20260811123619_widen-sales-production-scale.sql`
(the DROP COLUMN CASCADE removes them), and run `pnpm db:types` — the diff
should be empty on this branch.
