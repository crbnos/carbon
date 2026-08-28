# Warranty & Repairs — click-by-click test guide

Company: **Northspoke Cycles**. Everything below was checked against your local
database on 2026-08-28, so the item numbers, customers and suppliers are real.

Two complete runs:

- **Run A — a serial-tracked bike** that goes out to the supplier and comes back.
- **Run B — a non-tracked part** repaired in-house and billed.

Before you start, the stack must be up (`crbn up`) and migrations applied.

---

## 0. What you already have

| | |
|---|---|
| Serial-tracked bikes in stock | **BIKE-GX** Gravel GX Complete Bicycle (7 on hand), **BIKE-VOLT** Volt E-City (6), **BIKE-S20** Sprocket 20 (1) |
| Non-tracked parts in stock | **BAR-FLAT** Flat Handlebar 680mm (4), **BRK-DISC** Mechanical Disc Brake Set (8), **CBL-KIT** Brake & Shift Cable Kit (86) |
| Customers | Cascade Bike Shop, Bridgetown Bikes, Campus Rides, City Fleet Delivery Co., Golden Gate Gravel Co. |
| Suppliers (for the OEM leg) | VoltCore Systems, DriveTrain Distribution Co., Cascade Aluminum Works, Summit Powder Coating |
| Locations | Headquarters, Eastside Warehouse |

Nothing shipped so far carries a warranty, because warranties did not exist
until now. **A warranty is stamped when a shipment posts**, so Run A starts by
selling a bike — that is what creates the warranty record you will later claim
against.

---

## 1. One-time setup (about 3 minutes)

### 1.1 Create a warranty term

1. In the left sidebar click **Sales**.
2. Under *Configure*, click **Warranty Terms**.
3. Top right, click **New Warranty Term**.
4. Fill in:
   - **Name**: `Bicycle 2 Year`
   - **Warranty starts on**: `Ship Date`
   - **Covers parts**: on
   - **Parts duration (months)**: `24`
   - **Covers labor**: on
   - **Labor duration (months)**: `12`
5. Click **Save**.

> Leaving a duration empty means *lifetime* coverage for that class, not "no
> coverage" — the list column will read `Lifetime`.

### 1.2 Attach the term to the bike

1. Sidebar → **Items** → **Parts**.
2. Search `BIKE-GX` and open **Gravel GX Complete Bicycle**.
3. In the **Properties** panel on the right, scroll to **Warranty Term**.
4. Choose `Bicycle 2 Year`. It saves as soon as you pick it.
5. Optional, for the supplier-warranty banner later: set **Supplier Warranty**
   to the same term.

### 1.3 Attach a term to the handlebar (for Run B)

Repeat 1.2 for **BAR-FLAT** Flat Handlebar 680mm.

---

## Run A — serial-tracked bike, repaired by the supplier

### A1. Sell and ship the bike

1. Sidebar → **Sales** → **Orders** → **New Sales Order**.
2. **Customer**: `Cascade Bike Shop`. Save.
3. On the order, add a line: **Item** `BIKE-GX`, **Quantity** `1`, set a unit
   price (e.g. `2400`). Save.
4. Click **Confirm** on the order.
5. Click **Ship**. A draft shipment opens.
6. On the shipment, open the **Tracking** tab and pick one serial number for the
   bike. Note the serial down — you will follow it the whole way.
7. Click **Post**.

**Check now:**

- Sidebar → **Sales** → **Warranties**. There is a new row `WTY000001`:
  item `BIKE-GX`, the serial you picked, customer `Cascade Bike Shop`,
  **Parts** `Active`, **Labor** `Active`, **Source** `Shipment`.
- The parts date is 24 months out, labor 12 months out, both counted from
  today (the posting date).

**Sales order status:** the order moves to **To Invoice** (it is fully shipped,
not yet invoiced). Shipping is what completes the ship half — nothing about
warranty or repair changes that.

### A2. Customer sends the bike back

1. Sidebar → **Sales** → **RMAs** → **New RMA**.
2. **Customer**: `Cascade Bike Shop`. **Order Date**: today. Save.
3. Add a line: **Item** `BIKE-GX`, **Quantity** `1`, **Return Reason**
   `Warranty`. In the tracked-entity picker choose the serial from A1. Save.
4. Click **Confirm**.
5. Click **Receive**. A draft receipt opens.
6. On the receipt, open **Tracking** and confirm the same serial.
7. Click **Post**.

**Check now:**

- The RMA header reads **Received**.
- Sidebar → **Items** → **Parts** → `BIKE-GX` → **Inventory**: the bike is back
  on hand but **On Hold**, so it is not available to sell.

### A3. Send it to repair

1. Still on the RMA, open the returned line.
2. Set **Disposition** to **Repair**.
3. You land on a new repair order, e.g. `REP000001`, and the unit row shows
   **In the shop**.

> The RMA line is now settled from the return's point of view — the repair order
> owns the unit from here. If you click **Repair** again you are taken back to
> the same repair order rather than getting a second one.

### A4. Name the supplier

1. On the repair order, scroll to the **Repair Order** form at the bottom.
2. **Repair Supplier**: `VoltCore Systems`.
3. **Supplier RMA Number**: whatever the supplier gave you, e.g. `VC-88231`.
4. Click **Save**.

### A5. Ship it to the supplier

1. Top of the repair order, click **Ship to Supplier**. A draft shipment opens.
2. Open **Tracking** and confirm the serial.
3. Click **Post**.

**Check now:**

- Back on the repair order, the unit row reads **At supplier**.
- Sidebar → **Sales** → **Repairs**: the *Where* column reads `1 at supplier`.
  This is the answer to "where are my customers' units right now".

Optional: click **Create Repair PO** to raise a purchase order on VoltCore for
the repair fee. Add the fee as a line on that PO yourself — we cannot know the
supplier's price.

### A6. Receive it back, repaired

1. On the repair order, click **Receive from Supplier**. A draft receipt opens.
2. Open **Tracking**, confirm the serial, click **Post**.

**Check now:** the unit row reads **Repaired**, and it is the *same* serial
number it started with — not a new one.

### A7. Record what the repair used

1. On the repair order, in **Parts & Charges**, click **Add Charge**.
2. Fill in:
   - **Unit**: the bike line
   - **Type**: `Part`
   - **Item**: `CBL-KIT` (Brake & Shift Cable Kit)
   - **Quantity**: `1`
   - **Unit Price**: `0`
   - **Billing**: it is already set to **Warranty**, because the bike is in
     warranty. Leave it.
3. Save.
4. On the new row, click **Issue Part**.

**Check now:**

- Sidebar → **Items** → **Parts** → `CBL-KIT` → **Inventory**: on hand dropped
  by 1 (86 → 85).
- Sidebar → **Accounting** → **Journal Entries**: a `Repair Consumption` entry
  posts the cable kit's cost to **5330 Warranty Expense**, not to COGS. That is
  the whole point of the billing code — warranty work is absorbed, and you can
  see how much it cost you.

### A8. Ship it home

1. Click **Ship to Customer**. A draft shipment opens.
2. Confirm the serial in **Tracking**, click **Post**.

**Check now:** the unit row reads **Shipped back**.

### A9. Warranty on the repair itself, then close

1. On the unit row, use the **Apply warranty…** dropdown and pick
   `Bicycle 2 Year`.
2. Click **Complete** at the top.

**Check now:**

- Sidebar → **Sales** → **Warranties**: there are now **two** rows for that
  serial. The original from the shipment, and a new one with **Source**
  `Repair` starting today. The original is untouched — you keep the history.
- The repair order reads **Completed**.

---

## Run B — non-tracked part, repaired in-house and billed

Same shape, no serial numbers, and this time the customer pays.

### B1. Sell and ship handlebars

1. **Sales** → **Orders** → **New Sales Order**, customer `Bridgetown Bikes`.
2. Line: **Item** `BAR-FLAT`, **Quantity** `2`, unit price e.g. `45`. Save.
3. **Confirm**, then **Ship**, then **Post** the shipment. There is no tracking
   tab to fill — the part is not serialized.

**Check now:** **Sales** → **Warranties** shows one row for `BAR-FLAT` with
**Serial / Batch** empty and quantity `2`. One row covers the whole shipped
line, which is why the next step asks you to pick it explicitly.

### B2. One handlebar comes back, out of warranty coverage for labor

1. **Sales** → **Repairs** → **New Repair Order**.
2. **Customer**: `Bridgetown Bikes`. **Shop Location**: `Headquarters`.
   **Opened**: today. Save.
3. Add a unit line: **Item** `BAR-FLAT`, **Quantity** `1`.
   In **Warranty** pick the registration from B1 — for a non-serialized part
   there can be several from repeat purchases, so you choose which one this
   repair is claiming against.
4. Click **Confirm**.

> Try over-claiming: add a second line for quantity `2` against the same
> registration. It is refused — the registration covers 2 units and 1 is
> already claimed.

### B3. Take it in

1. Click **Receive from Customer**. A draft receipt opens. Click **Post**.

**Check now:** the row reads **In the shop**. Look at **Items** → `BAR-FLAT` →
**Inventory**: quantity went up by 1, but the **value did not change**. The
customer's part is in your building at zero value — it is their property, not
your stock.

### B4. Repair it in-house and bill it

1. **Add Charge** → **Type** `Service`, **Item** `BAR-FLAT` (or any service
   item), **Description** `Straighten and refinish`, **Quantity** `1`,
   **Unit Price** `35`, **Billing** `Billable`. Save.
2. **Add Charge** → **Type** `Part`, **Item** `CBL-KIT`, **Quantity** `1`,
   **Unit Price** `0`, **Billing** `Warranty`. Save, then **Issue Part**.

You now have one charge the customer pays and one you absorb. The **Billable
total** at the bottom shows `35.00` — warranty work is deliberately not in it.

3. Click **Create Quote**. A quote is drafted from the billable charge only.
   Open it from the **Quote** link on the repair order.

> Clicking **Create Quote** twice returns the same quote. Use **Create Sales
> Order** instead if you want to skip quoting and bill directly.

### B5. Finish

1. On the unit row, click **Mark Repaired**.
2. Click **Ship to Customer**, then **Post** the shipment.
3. Click **Complete**.

**Check now:** `BAR-FLAT` on-hand is back to what it was before B3 — the
customer's part left the building.

---

## What to check when you want to be sure

**Inventory**

- A customer's unit in for repair shows in on-hand quantity but adds **zero
  value**. Check **Items** → part → **Inventory**, and the item's value in
  **Inventory** → **Inventory Value**.
- A returned serial comes back **On Hold**, so it can never be accidentally sold
  while it is in the shop.

**Accounting** (only if Accounting is enabled for the company)

- **Accounting** → **Chart of Accounts** → **5330 Warranty Expense** — this
  account was created for you and is what absorbed repair costs land in.
- **Accounting** → **Journal Entries**, filter source `Repair Consumption`:
  warranty and no-charge parts debit 5330; billable parts debit COGS.
- Receiving and shipping the customer's unit posts **no journal at all** — zero
  value in, zero value out.

**Sales orders**

- A repair never changes the original sales order. The bike in Run A stayed on
  its own order at **To Invoice**; the repair is separate paperwork.
- Billing a repair creates a **new** quote or sales order for the repair charges
  only, linked from the repair order header.

**Things that should be refused** (worth trying once)

| Try this | What should happen |
|---|---|
| **Complete** a repair order while a unit is still *In the shop* | Refused — ship it back or scrap it first |
| **Cancel** after a unit has been received | Refused — units are in your custody |
| **Ship to Supplier** with no supplier set | Button is disabled until you set one |
| Add a charge with no billing code | Refused — the code must be chosen, it never silently defaults to Warranty |
| **Issue Part** twice on the same charge | Refused — it is already issued |
| Delete a charge after issuing it | Refused — it is history, not a draft |

---

## If something goes wrong

- **No warranty row appeared after posting a shipment** — the item had no
  **Warranty Term** at the moment the shipment posted. Set it (step 1.2) and
  ship another one; warranties are stamped at posting time, not backfilled.
- **The Repair disposition does nothing** — the RMA line must have been received
  first. Post the receipt, then set the disposition.
- **"Receive from Customer" says nothing is waiting** — every unit on the order
  is already in the shop or beyond. That button only pulls units still
  *Awaiting arrival*.
