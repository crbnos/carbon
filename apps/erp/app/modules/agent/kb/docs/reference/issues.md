# Issues (non-conformances)

> How Carbon logs a non-conformance, drives it through a configurable workflow of actions and approvals, and dispositions the affected material before closing.

An **issue** is Carbon's non-conformance record, an NCR: a logged defect or deviation plus the work to resolve it. This page is the deep dive behind the `docs/reference/quality`. It lives in the `quality` module (there is no separate `issue` module), and every issue carries an `nc`-prefixed internal id plus a readable `nonConformanceId` you see in the UI.

An issue opens several ways: by hand from the issues list, from the shop floor in MES, from Slack, or **automatically** when an `docs/reference/quality` rejects a lot. Whichever door it comes through, it lands in the same lifecycle.

## The lifecycle

A `nonConformanceStatus` has three values. A new issue defaults to **"Registered"**; **"Closed"** is terminal and locks the record.

  - **Registered**: The issue exists but no one has picked it up. The DB default for a new `nonConformance`. Editable.
  - **In Progress**: Someone is working it. An issue auto-advances here the first time a user types into a task note while still Registered, or when you click **"Start"** in the header.
  - **Closed**: Resolved and locked. `isIssueLocked(status)` is true only for Closed, which blocks edits to the issue and its task assignments. Closing clears the assignee and stamps `closeDate`. **"Reopen"** sends it back to Registered.

The header buttons drive these transitions, all gated by the `quality` update permission: **"Start"** (Registered → In Progress), **"Complete"** (In Progress → runs `closeIssue`), and **"Reopen"** (In Progress or Closed → Registered). The reopen path is why Closed isn't a dead end. It just re-opens the record for more work.

The issue header holds the priority, source, type, and workflow. The *affected material* lives in a separate junction (`nonConformanceItem`), so a single issue can cover several items and several tracked lots or serials, each dispositioned on its own. The header status is not the same thing as a per-item disposition.

## Header fields

Every issue carries a small set of classification fields. Type and location are required; the rest have defaults or are optional.

  - **Priority**: How urgent. Defaults to **"Medium"**.
  - **Source**: Where the defect originated. Defaults to **"Internal"**. External covers supplier- and customer-side non-conformances.
  - **Type**: A configurable category (`nonConformanceType`) — your own list, not a fixed enum.
  - **Workflow**: An optional `nonConformanceWorkflow` that pre-seeds the issue's priority, source, required actions, approvals, and a document template. See below.
  - **Location**: The site the issue is raised against.
  - **Open / Due / Close date**: `openDate` is required; `dueDate` is optional; `closeDate` is stamped automatically on close.
  - **Quantity**: The affected quantity, optional at the header level.

## Workflows: the 8D and its cousins

A **workflow** is a reusable template, not a rigid state machine. It stores a rich-text **issue template** (the investigation write-up you start from) plus a preset priority, source, a list of required actions, and approval requirements. Picking a workflow when you raise an issue copies those presets in and drops the template into the issue's content.

This is how Carbon models the 8D method: an "8D workflow" is just a workflow whose required actions cover the eight disciplines. A "containment workflow" is a lighter one. Nothing about 8D is hard-coded. You compose it from the same action building blocks as any other workflow, and you can build your own.

## Required actions and their system categories

Each issue references a set of **required actions** (`requiredActionIds`), and the moment the issue is set up, Carbon materializes one **action task** (`nonConformanceActionTask`) per required action, numbered by sort order. Those tasks are the checklist the team works through.

A required action can carry a `systemType` that classifies what kind of action it is. There are five:

  - **Containment**: The immediate action that quarantines affected stock or work before the root cause is known. Drives the issue's containment status (below).
  - **Corrective**: The fix for a confirmed root cause.
  - **Preventive**: The action that stops the problem recurring elsewhere.
  - **Verification**: Confirms the corrective and preventive actions actually worked.
  - **Communication**: Notifies the affected party, e.g. a customer.

The five system actions (Containment Action, Corrective Action, Preventive Action, Verification, Customer Communication) are seeded per company and **protected**: a database trigger blocks deleting them or changing their `systemType`, and each is unique per company. Any action you add yourself has no `systemType` and is fully editable.

The `issues` view computes a **containment status** from the action tasks. It reads **"Contained"** when a Containment-type task is In Progress or Completed, **"Uncontained"** when a Containment task exists but hasn't started, and **"N/A"** when the issue has no containment task at all. You don't set it. It follows the work.

### Working the tasks

Action tasks run their own small lifecycle: **"Pending"** → **"In Progress"** → **"Completed"**, with **"Skipped"** as an off-path exit. Tasks start Pending and do *not* auto-start. Completing a task stamps its completed date. A completed or skipped task can be reopened back to Pending. Tasks can be reordered, given due dates, and tied to specific processes, and a supplier-facing action task can be shared externally as a **SCAR** (Supplier Corrective Action Request) report.

## Approvals and the Material Review Board

Beyond actions, an issue can require **approvals**. The only approval requirement Carbon ships is MRB (Material Review Board). Adding it materializes an approval task and, when MRB is newly required, seeds two **reviewers** with titles **"Engineering"** and **"Quality"**. Remove MRB and those seeded reviewers are cleared; reviewers you added by hand are left alone. A reviewer is just a title on the issue. You manage the list inline on the issue.

## Dispositions: deciding the material's fate

Closing an issue is where the affected material gets resolved. Each `nonConformanceItem` row carries a disposition — the decision about what to do with that material. The database enum has more values than the UI exposes; the active picker is a deliberate subset of five:

  - **Pending**: Not yet decided. The default. **Blocks closing** the issue if the row has linked material.
  - **Return to Supplier**: Send it back. On close, linked tracked entities flip to **Rejected** and a Negative Adjustment ledger entry is written.
  - **Rework**: Fix it and use it. On close, linked entities return to **Available**.
  - **Scrap**: Write it off. On close, linked entities flip to **Rejected** with a Negative Adjustment ledger entry.
  - **Use As Is**: Accept the deviation. On close, linked entities return to **Available**.

`closeIssue` runs a preflight over every affected-item row that has linked tracked entities. It refuses to close — *"Cannot close: Disposition is still Pending"* — if any such row is still Pending, if the linked quantities don't sum to the row quantity, or if a linked entity is missing or already Consumed. Only once the plan is clean does it stamp each entity's outcome and set the issue **"Closed"**. A row with no linked material is not gated: you don't have to disposition what you never traced.

## What an issue can point at

An issue links to the documents and records it concerns through typed association tables. There are ten association types: **items**, **customers**, **suppliers**, **job operations**, **purchase-order lines**, **sales-order lines**, **shipment lines**, **receipt lines**, **tracked entities**, and **inbound inspections**. These are what let quality trace a defect back to exactly where it came from — a specific received lot, a specific job operation, a specific supplier — and what makes supplier quality a *derived* number rather than a scorecard you maintain by hand.

From the issue header you can also spin up a `docs/reference/change-orders` directly, carrying the issue across as its source, when the fix is an engineering change rather than a one-off disposition.

## Related

  - Quality The module overview: issues, inbound inspection, gauges, documents.
  - Calibration Gauges and calibration-due tracking, the other side of quality.
  - Risk register Risks and opportunities tracked by source, alongside non-conformances.
  - Change orders Turn an issue into an engineering change.

## Troubleshooting

Exact errors and blocking preconditions from the issue validator, the close/disposition gate, and the entity-move server logic.

### "Name is required" / "Location is required" / "Type is required" / "Open date is required"
Form-validation from `issueValidator`. A new issue needs a summary name, a location (the plant/warehouse where the defect originated), an issue type, and an open date before it saves.

### "Cannot modify a closed issue. Reopen it first."
The issue's status is **Closed**, which locks it against all edits — entity moves, splits, disposition changes. Reopen the issue first, then make the change. (A Closed issue is the only locked state; `isIssueLocked` returns true only for Closed.)

### "Cannot close: Disposition is still Pending; …"
One or more disposition rows are still set to **Pending**. Every tracked-entity row must have a final disposition (Rework, Scrap, Use As Is, Return to Supplier) before the issue can close. Open each row and pick an outcome.

### "Cannot close: Linked entity quantity (…) does not match row quantity (…); …"
The quantities of the tracked lots linked to a disposition row don't sum to the row's quantity — usually stale after a split or move. Re-split or re-link the entities so the totals match, then close.

### "Cannot close: Tracked entity … is already Consumed; …"
An entity in the disposition has already been consumed in production, so it can no longer be dispositioned. Unlink or replace the consumed entity, then close.

### "Cannot move entities between different NCRs" / "Cannot move entities onto the same row"
Entity moves are only valid between two disposition rows on the *same* issue, and the source and target rows must differ. Pick a different target row on the same NCR.

### "Split quantity (…) must be less than the current quantity (…)"
A split has to leave something on the original row — the split-off amount can't equal or exceed the row's current quantity. Reduce the split amount.

### "Disposition changed while closing; please retry."
Another user modified a disposition row (status, quantity, or an entity's state) between your preflight and the close transaction. This is a transient race — press Close again.

### MRB review is holding the issue open
When an issue requires **MRB** approval, an approval task and reviewer rows (Engineering, Quality) are seeded and the issue can't move to Closed until those reviewers complete their tasks. The issue sits In Progress until MRB signs off — complete the review tasks to unblock closure.

### Permission-gated: you can't create, edit, close, or delete an issue
Listing issues needs `quality` **view**; creating needs `quality` **create**; editing, closing, splitting, and moving entities all need `quality` **update**; deleting needs `quality` **delete**. If an action is blocked, your role is missing the corresponding quality permission (Settings → Roles).
