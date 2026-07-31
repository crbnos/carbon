# The MES app

> The shop-floor surface where operators run operations, report quantities, issue material, and log their time.

Carbon is two apps over one data model: the ERP is the office, the MES is the floor. Where a planner releases and schedules work in the ERP, an operator picks up that work here, on a station tablet or a shared kiosk, and reports it back in real time. This page is the scannable map of that surface. For the narrative walkthrough, read the `guides/floor`; for the entities behind it, see `docs/reference/jobs`, `docs/reference/picking`, and `docs/reference/quality`.

Every mutation here hits the network. The MES keeps an IndexedDB read-cache for the item and people pickers so a scan stays snappy, but there is **no offline mode**: without a connection you cannot start, report, or issue anything.

## Getting onto the floor

An operator signs in on the login screen with whichever methods the company has enabled: **"Sign in with Google"**, **"Sign in with Outlook"**, **"Sign in with Passkey"**, or **"Sign in with Email"** (a magic link, which lands on a **"Check your email"** confirmation). The available buttons follow the company's `AUTH_PROVIDERS`, so a floor that only allows passkeys sees only that one.

Once in, the operator sets their context. If the company has more than one location, a **"Location"** submenu appears in the sidebar to pick which floor they're standing on. With a single location the choice is skipped entirely. This selection scopes the board, the assigned lists, and everything they report.

### Console (shared-station) mode

A single tablet bolted to a work center can't ask every operator to log in and out all shift. **Console mode** turns that station into a shared kiosk. It's gated by the `consoleEnabled` company setting, and when on, the sidebar exposes a **"Console Mode"** toggle.

In console mode an operator identifies themselves with a **4-digit PIN**, not a full login. The station prompts to enter a PIN for the named operator, checks it, and attributes the work to that person. Two things stop cold when the PIN is wrong or missing: the station shows **"Incorrect PIN"**, or **"No PIN set. Please set a PIN in your account settings."** if the person never configured one.

A shared station is meant to hand off. **"Switch Operator"** re-prompts for a PIN so the next person takes over, and **"Pin Out"** clears the current operator. Ending the shift also pins out automatically. The PIN identifies *who did the work*; it is not a substitute for the person's real account.

## The operations board

The released work lands on the **"Schedule"** board: a Kanban with one column per work center, each column holding that center's queued operations sorted by **dispatch priority** so the top card is always the next thing to run.

The board is **display and filter only**. A Display popover lets each station tune its own view, toggling **"Empty work centers"** on or off and showing or hiding **"Customer"**, **"Description"**, **"Due Date"**, **"Duration"**, **"Progress"**, **"Status"**, **"Sales Order"**, and **"Thumbnail"** on each card. Filters narrow the queue by **"Work Center"**, **"Process"**, **"Tag"**, or **"Assignee"**.

Operators can filter and focus, but they cannot drag a card to reschedule it. Rebalancing the plan, moving an operation to a different work center or shifting a job's dates, happens on the `docs/reference/scheduling`, where a planner owns the sequence. What reaches the floor is the result.

### Focused lists

Alongside the board, three sidebar lists cut the queue down to what one operator cares about right now:

  - **Assigned to Me**: Operations assigned to the signed-in operator, grouped by work center. Empty state: **"No assigned operations"**.
  - **Active**: Operations the operator currently has running (a production event is open). Empty state: **"No active operations"**.
  - **Recent**: Operations the operator recently touched, for quick return. Empty state: **"No recent operations"**.

Each card carries a status badge, its progress, and a deadline chip (**"ASAP"**, **"No Deadline"**, or a date that turns red when overdue). The badge tracks the operation's own status, not the job's.

### Open Jobs

The **"Open Jobs"** list is the job-level view: columns for **Job**, **Item**, **Quantity**, **Tracking**, **Assignee**, **Due Date**, **Deadline**, and **Status**. One relabel to know here, because it trips people up:

The ERP job status jobs reach when they're cleared to run is `Ready`, but the MES Open Jobs list renders that same value as **"Released"** — the floor's word for "you can start this now." It's a display alias, not a different status. `Closed` jobs also surface in this list.

Opening a job shows its operations as a directed graph (the routing DAG), so an operator sees what feeds what. The toolbar lays it out **"Left to Right"** or **"Top to Bottom"** and offers **"Fit"**; nodes flag a **"Rework"** loop and a scrapped-quantity count when they apply.

## Running an operation

Open an operation and the station panel is where the shift actually happens. A big control starts and stops the clock: **"Start"** opens a production event, **"Pause"** closes it. A toggle picks which kind of time is being logged, matching the three production event types: **"Setup"**, **"Labor"**, or **"Machine"**. The panel is tabbed into **details**, **model** (the 3D part view), **procedure** (work instructions, with **attributes** and **parameters** sub-views), and **chat** (a per-operation note thread).

### Reporting quantities

Good, bad, and reworked units are reported separately, so yield stays honest:

  - **Log Completed**: Records good units off this operation. **"Complete All"** fills the remaining quantity; **"Total Quantity"** sets it explicitly.
  - **Log Scrap**: Records scrapped units against a required **"Scrap Reason"**, so the loss is attributable.
  - **Log Rework**: Records units reworked in place at this operation, without sending them anywhere.

Reworking *in place* is different from sending a unit back upstream. **"Create Rework"** does the latter: pick an operation under **"Go back to operation"**, give a **"Reason for rework"**, and Carbon re-runs every operation from that point forward to the current one.

Closing the operation is a distinct action. **"Finish"** ends any open events and flips the operation to `Done`. If quantities or steps aren't satisfied Carbon warns (**"Insufficient quantity"**, **"Steps are missing"**) and offers **"Finish Anyways"**. A guard also fires when tracked material was never issued; the operator must acknowledge **"I understand and want to complete without issuing"** to proceed.

**"End Operations"** ends *all* the operator's active production events at once (a clean end-of-shift stop) and, when time cards are on, clocks them out. It does **not** complete or finish any operation. The work stays exactly where it was, ready to resume next shift.

### Issuing material

Material is consumed against an operation from the same panel. The **"Issue"** action has an Adjustment Type: **"Add to Inventory"** (a `Positive Adjmt.`) or **"Pull from Inventory"** (a `Negative Adjmt.`). For serial- or batch-tracked material, tabs let the operator **"Scan"** a barcode, **"Select"** from stock, or **"Unconsume"** to return material already issued.

Two edge cases surface right in the flow rather than failing silently. Issuing expired stock is governed by a policy (`Warn`, `Block`, or `BlockWithOverride`); an overridable block asks for a **"Reason for issuing expired stock"**. And when a pick splits a batch, the station reports a **"Batch Split Occurred"** and offers to **"Convert to New Size/Revision"** or scrap the remainder.

### Clocking in and out

When the `timeCardEnabled` company setting is on, the sidebar carries a time card: **"Clock In"** and **"Clock Out"**, a **"My Hours"** view (a table of **Date**, **Clock In**, **Clock Out**, **Duration**), and a **"Clocked in since"** badge with the start time while a shift is open. Leave a shift open too long and Carbon nudges: after twelve hours it asks **"Forgot to Clock Out?"** with **"I'm Still Working"** or **"Set Clock Out"**. Time cards are labor time for payroll and presence; they are separate from the per-operation production events that drive job costing.

## Picking, quality, inspections, and maintenance

The floor does more than run operations. Four adjacent surfaces live in the same app.

### On-floor picking

The **"Picking"** view lists the picking lists assigned to the operator. **"Start"** moves a list to `In Progress`; **"Finish"** takes it to `Completed`. Each line is worked with **"Pick"**, **"Unpick"**, **"Short"**, or **"Scan"** (for tracked material), and a **"No stock"** badge flags an empty source. A short pick asks **"How many were actually picked?"** and records the shortfall with **"Mark Short"**.

Once a list is `Completed` or `Cancelled` it locks. MES shows **"This picking list is closed. Reopen it from the ERP to continue."** — reopening requires an inventory permission the floor doesn't hold. See `docs/reference/picking` for the full lifecycle.

### Quality issues and inspections

An operator who spots a problem raises it without leaving the station. **"Create Quality Issue"** captures an **"Issue Type"**, a **"Priority"** (Low, Medium, High, or Critical), and a **"Description"**, and files a non-conformance for quality to triage. See `docs/reference/quality` for how that record is worked.

Inspections and work instructions run as typed steps inside the procedure tab. A step is one of nine kinds:

  - **Task**: A do-this instruction the operator marks complete.
  - **Checkbox**: A yes/no confirmation.
  - **Value**: A recorded text or free value.
  - **Measurement**: A numeric reading with bounds — out of range, Carbon warns that the value must fall between the configured min and max for the unit of measure.
  - **Timestamp**: Captures the moment the step was done.
  - **List**: A choice from a predefined list.
  - **Person**: Records who performed the step.
  - **File**: An uploaded attachment (a photo, a document).
  - **Inspection**: A pass/fail gate with a **"Passed Inspection"** switch.

### Maintenance dispatch

When a machine goes down, an operator raises a maintenance dispatch from the floor. Every dispatch created here is `Reactive` by source (scheduled and non-conformance dispatches originate elsewhere). It carries a severity, a priority, and an OEE impact; choosing an OEE impact of **"Down"** ends the work center's active production events, because the center can't produce while it's under repair. The maintenance worker executes it from a detail view with Play, Pause, and Complete controls, a **"Time Worked"** total, and a **"Spare Parts"** section (**"Add & Issue"**), landing on **"Maintenance Completed"** when done.

## Troubleshooting

The exact blocks operators hit on the floor, and what unblocks each.

### "Incorrect PIN"
In console mode the 4-digit PIN entered for the named operator didn't match. Re-enter it, or use **"Switch Operator"** to pick the right person. The PIN identifies who did the work; it is not the person's login password.

### "No PIN set. Please set a PIN in your account settings."
The named operator has never configured a console PIN, so console mode can't attribute work to them. They set one in their account settings (in the ERP), then the station can pin them in.

### "This picking list is closed. Reopen it from the ERP to continue."
The picking list is already `Completed` or `Cancelled`, which locks it — the floor can't pick, unpick, short, or scan against a closed list. Reopening it requires an inventory permission the MES doesn't hold; a user reopens it from the ERP.

### Finish is blocked or warns ("Insufficient quantity" / "Steps are missing")
**"Finish"** flips the operation to `Done`, but guards fire first. If reported quantity is short you'll see **"Insufficient quantity"**; if procedure steps aren't satisfied, **"Steps are missing"**. You can override with **"Finish Anyways"**. Separately, if tracked material was never issued, the operator must tick **"I understand and want to complete without issuing"** to proceed.

### "Forgot to Clock Out?"
A time card was left open for twelve hours or more. Choose **"I'm Still Working"** to keep the shift open, or **"Set Clock Out"** to close it. Time cards are labor/presence time for payroll — separate from the per-operation production events that drive job costing.

### The Console Mode toggle or the time card isn't there
Both are company-setting gated. **"Console Mode"** only appears when `consoleEnabled` is on; the **"Clock In"/"Clock Out"** time card (and the 12-hour prompt) only appear when `timeCardEnabled` is on. If a floor needs either, an admin enables it in company settings.

### I can't drag a card to reschedule on the floor
The MES **"Schedule"** board is display and filter only — it never reschedules. Rebalancing the plan (moving an operation to another work center, or shifting a job's dates) happens on the `docs/reference/scheduling`, where a planner owns the sequence.
