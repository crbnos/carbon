# Jobs

> One run of production, covering a single item, a quantity to make, and its own copy of the method.

A **job** is the unit of production work in Carbon. It pins down one item, how many to make, where, and by when, and carries its own copy of the manufacturing method (the materials and operations) so the floor always builds from a fixed recipe, even as the part master changes underneath it.

Everything on the shop floor hangs off a job: the schedule board places its operations, material is issued against it, time is logged to it, and cost accumulates into its work-in-process. A sales order line that's made to order becomes a job; planning turns a stock shortfall into one. It's the bridge between demand and the floor.

## Fields

  - **Job number**: A readable `WO`-prefixed id (e.g. *WO000001*), assigned from a per-company sequence.
  - **Item**: What's being made. The job copies this item's method on release.
  - **Quantity**: Good units to produce.
  - **Scrap quantity**: Units expected lost; `production quantity` = quantity + scrap.
  - **Quantity complete**: Good units finished so far.
  - **Location**: The site the job runs at and receives into.
  - **Storage unit**: The bin or shelf finished goods land in when the job completes.
  - **Due date**: When it's needed, paired with the deadline type below.
  - **Deadline type**: How hard the due date is: `ASAP`, `Hard Deadline`, `Soft Deadline`, or `No Deadline`. The scheduler treats each differently.
  - **Source**: The sales order line or quote line it was raised for, if any.
  - **Assignee**: The person responsible for the job.
  - **Released / Completed date**: Stamped when the job moves to **Ready** and to **Completed**. The span between them is its actual production time.

## Status lifecycle

A job's status drives what you can do with it and what the floor sees.

  - **Draft**: Created and editable; not yet planned or scheduled.
  - **Planned**: Demand is visible to planning, but no work is on the board yet.
  - **Ready**: Released: operations are scheduled and material requirements raised.
  - **In Progress**: The first production event has been logged against it.
  - **Paused**: Work is temporarily halted.
  - **Completed**: Every operation is done; finished goods have been received into inventory.
  - **Closed**: The books are settled. Any residual work-in-process is swept to variance.
  - **Cancelled**: Abandoned before completion.

A **Completed**, **Closed**, or **Cancelled** job is locked. Its method, quantity, and dates can no longer be edited. Closing is what makes a job's work-in-process provably zero.

## Operations

The job's routing is copied into job-specific **operations** on release, each a process on a work center, carrying its own setup, labor, and machine time. The floor runs the job by running its operations, and each carries its own status. A job reads **"In Progress"** the moment any single operation does.

  - **Todo**: Not yet worked, and not necessarily unblocked.
  - **Ready**: Every operation it depends on is **Done**; this one can start.
  - **Waiting**: An upstream dependency isn't finished, so it's blocked. It flips to **Ready** on its own once the last one completes.
  - **In Progress**: A production event is open while someone runs it.
  - **Paused**: Halted; time isn't accruing, but it isn't finished.
  - **Done**: Finished. Completing it closes any open events and promotes downstream operations whose dependencies are now all done.
  - **Canceled**: Won't run.

### Inside and outside

Each operation is **Inside** or **Outside**. An Inside operation runs on one of your work centers and prices against its rates. An **outside** operation is subcontracted: instead of a work center it points at a supplier process, copies that supplier's cost and lead time, and drives an outside-processing purchase order.

An outside operation's cost and lead time are copied when you set the supplier process, not linked live. If the supplier's pricing changes, re-select the supplier process to refresh it.

### Sequencing

The **order** field sets each operation's position, and operation order (*After Previous* or *With Previous*) says whether it waits for the prior step or runs alongside it. Explicit **dependencies** are what gate a start: an operation can't reach **Ready** until every operation it depends on is **Done**, and finishing one re-checks everything downstream. Two operations with no dependency between them can be **Ready** at once and run in parallel.

### Time and output

The floor reports two separate things against an operation. A production event measures *time*, typed **Setup**, **Labor**, or **Machine**, with a start, an end, and the employee. A production quantity measures *units* (**Production**, **Scrap**, or **Rework**) and rolls up automatically into the operation's completed, scrapped, and reworked totals. Logging time implies no output, and reporting output implies no particular time, which is what lets Carbon cost on actual events while measuring yield on actual quantities. Untracked materials are backflushed as output is reported; tracked materials are issued deliberately.

### Procedures

Each operation can attach a procedure: a reusable set of work instructions keyed to a process. A procedure carries an ordered list of typed **steps** the operator completes (a value, a measurement with a min/max range, a checkbox, a list choice, a timestamp, a person, or a file), any of which can be marked required. It also carries **parameters**, the process settings the work runs at, such as a temperature or speed. Separately, the operation lists the **tools** it requires.

Because a procedure is keyed by process, you author it once and every operation running that process can attach it. It's versioned, moving through **Draft** while it's written, **Active** once ready for live work, and **Archived** when retired.

Revising a procedure bumps its version. A job already released keeps the version it was built with, so a change to the master never rewrites instructions on work in flight. Each step is captured as the operator fills it in, giving the finished job a recorded answer for every one it was built with.

## Make to order vs. make to stock

A job is identical whichever way it's raised. Only its source differs. A **make-to-order** job links back to a sales order line; a **make-to-stock** job comes from planning with no order behind it. Either way the job completes into inventory first, and the sale (if any) ships from stock — the job never ships directly to a customer.

Releasing a job copies the part's method into a job-specific copy. Editing that copy never touches the part master, and updating the part never disturbs a job already in flight.

## Related

  - Start with the order Watch a sales order become batched jobs, each with its own method.
  - Manufacturing accounting How a job accumulates cost in work-in-process and settles at close.
  - Routings The operations a job schedules onto the floor, before it copies them.
  - Work centers The stations and rates that cost and schedule its operations.

## Troubleshooting

### "Manufacturing is blocked"
Releasing the job was stopped because the item's planning settings have manufacturing blocked. Open the item, clear the manufacturing-blocked flag under its planning settings, then release the job again.

### "Cannot modify a locked job. Reopen it first."
The job is **Completed**, **Closed**, or **Cancelled** — locked, as the status callout above describes. A Completed job can be reopened if books haven't been settled; a Closed job's costs are final.

### "No location found"
Creating the job needs a location and the company has none (or no default). Add a location in settings, or set the user's default location.

### "Tracked entity not found"
Completing the job to inventory referenced a serial or batch that no longer exists — usually consumed or deleted since the job's output was recorded. Re-check the job's tracked outputs and materials before completing again.

### "Failed to schedule job"
The scheduling engine errored while placing the job's operations. Check that every operation has a work center (inside operations) or supplier process (outside operations) and that the job has a due date, then retry from the job's status menu.
