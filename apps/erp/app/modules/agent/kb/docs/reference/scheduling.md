# Scheduling

> Finite-capacity scheduling — how jobs are placed onto real work-center and operator calendars, and the boards that show and steer the result.

Scheduling in Carbon answers three questions for the floor: *when* will each `docs/reference/jobs` actually run, *in what order* does each `docs/reference/work-centers` pick up its operations, and *does the plan fit* the capacity you really have. The engine is **finite-capacity**: it places every operation forward onto real work-center operating hours and, where an operation needs a qualified operator, onto real people's shifts. A machine can hold one operation at a time, so a busy shop genuinely pushes work out rather than pretending everything fits.

## Where scheduling lives

Everything is reached from the **Production** area of the ERP.

- **Priorities** (under *Scheduling*) is where you steer. It opens on a **Week** view of jobs laid out by due date; a view switcher at the top-left also offers **Month** and a **Work Centers** view, an operations Kanban with a column per work center. Dragging a job card onto a day or week writes the job's **due date**; dropping it on **Unscheduled** clears the date. Dragging an operation card on the Work Centers view writes its work center and its dispatch priority. Reordering within a column changes only the pickup order; moving an operation to a *different* work center also queues a reschedule, since the engine has to re-place it on the new machine's calendar.
- **Forecast** (also under *Scheduling*) is where you read the result: a Gantt of every work center's booked time, with an explanation for each bar. More on it [below](#the-forecast-explains-the-schedule).
- **Resource Planning** (under *Planning*) is the manning board: drag employees onto work-center columns per day or week, record time off and overtime, and review a capacity view of scheduled versus available hours. Who is manned where is a scheduling input, so every change here queues a reschedule too. See `docs/reference/people` for the shift model behind it.
- The shop-floor app's **Schedule** page (MES) looks like the Work Centers view but is **display only**. Operators read their station's queue, sorted by dispatch priority, and open an operation to run it. No drag on the MES board writes anything.

Due dates, dispatch order, and manning are all set in the ERP. The MES board reflects the same operation records the engine writes, but changes nothing about the schedule.

## Placement against real capacity

The engine schedules **forward**: each operation is placed at the earliest feasible moment after *now* and after its predecessors in the `docs/reference/routings` finish. There is no backward pass that anchors work on the due date; the projected finish that falls out of placement *is* the forecast, and slack is real. Two finite resources gate every placement:

1. **The work center.** One operation at a time, placed only inside its operating hours. Hours come from a ladder: a **lights-out (24×7)** work center is always open; otherwise its own assigned shifts apply; otherwise the location's shifts; otherwise a stock Mon–Fri, 8-hour day. Open `docs/reference/maintenance` dispatches that take a work center offline subtract their downtime from those hours, lights-out machines included.
2. **Qualified people**, when the operation's process requires an ability. See [the next section](#people-are-part-of-capacity).

When a process can run on more than one work center, the engine picks the candidate that **finishes earliest**, so work naturally routes around a backed-up or unstaffed machine. An operation that has already started stays on its work center, and only the *remaining* work is reserved: labor and machine time are scaled by the quantity still open, and setup counts as done once any production event exists.

The dispatch order the boards show falls straight out of placement. The engine groups placed operations by work center, sorts by projected start, and numbers them 1, 2, 3. The top card in a column is the next thing to run there. The job's deadline type matters here as a *ranking* signal: jobs claim capacity in deadline-class order (ASAP first, then Hard Deadline, Soft Deadline, No Deadline), then by due date. No deadline type blocks or gates placement.

The old model computed dates as if every machine had infinite room, and load only picked which station won a tie. Now a full machine or a booked-up operator pool delays the operation, and the delay is visible and explained. A job with no due date still schedules fine; the due date is the yardstick lateness is measured against, not a placement anchor.

## People are part of capacity

A process can be marked as **requiring an ability**. Operations of that process only run while at least one *qualified* operator is available: someone holding the ability whose qualification hasn't expired, present on shift, not absent, and not already reserved by other work. The engine looks first at the people **manned to the station** on the Resource Planning board, running the operation as a team (labor parallelizes across present members; setup and machine time never compress). If nobody is manned there, it falls back to qualified **floaters** — people with no board assignment anywhere. A person manned to one station is committed to it and is never silently pulled to another.

Each location also has a staffing policy on the Production settings page, described there as: *"Require an assigned operator before the scheduler places work at a location. When on, unstaffed work centers get no work and an operation with no manned coverage shows as unschedulable. Lights-out (24×7) work centers are exempt."* With **"Staffing required"** on, the floater fallback is off and even ability-free operations need a manned station, so work routes only to where you've put people.

If one person holds the ability a station needs and you man them elsewhere, that station's operations become unschedulable rather than double-booking the person or sneaking onto an unmanned night shift. The Forecast flags them as "can't be scheduled" so you can see the gap and fix the manning.

## Two dates on every operation

Each operation carries **two dates with different jobs**, and reading them as one is the most common misunderstanding of the new model:

- **Projected start and finish** are the engine's forward placement: when the work will actually happen given capacity. They are recomputed on every scheduling run.
- The **due date** is the need-by target: working backward from the job's due date through the routing's lead times, when this operation *must* finish to keep the job on time. It is a stable target, changing only when the job's due date, routing, or lead times change. It never constrains placement.

When the projected finish runs past the need-by target, the operation shows an **amber** state: the bill of process and the ops-board cards render the projected date in amber (*"Projected Sep 12"*) with a *"Behind target by N day(s)"* tooltip. Amber is an early warning, not a conflict; the whole job may still make its due date.

You can **pin** an operation's due date from the date picker on the bill of process. The pin's tooltip says it plainly: *"Pinning it overrides the calculated target."* A pin means a human owns the *target*, and upstream operations derive their targets from it. It does **not** freeze the placement; the engine still re-projects a pinned operation's start and finish every run. The one exception is a pinned outside operation, which keeps its stored window because the vendor's turnaround isn't yours to re-place.

## The Forecast explains the schedule

The **Forecast** page renders the schedule the engine actually booked: a lane per work center (idle stations included), operation bars labeled with the job and operation, and operator segments underneath showing who is reserved. Every bar is a stored capacity reservation, so what you see is exactly what the engine committed, not a redraw from dates. Amber maintenance bars show downtime in the same lanes.

Click any bar and a side panel explains its timing. A **schedule note** answers "why does this start when it does" in plain language, for example *"Waited 14h for the work center — queued behind J000001 (3 ops)"* or *"Waited 2d 3h for a qualified operator to be available"*. The panel also separates **work** from **span**: an operation stretched across shift boundaries might show 6 hours of work across a 22-hour span, which is honest rather than alarming. A popover on each lane, *"How are these hours calculated?"*, shows which rung of the availability ladder is in use and what downtime and staffing subtract from it.

The header counts two kinds of trouble separately:

- **Conflicts** are placed operations that finish **after the job's due date**. The stored reason names the cause, e.g. *"Finishes 2026-09-12 but the job is due 2026-09-05 — waited for a qualified operator, queued behind J000001 (3 ops)"*. The same reason appears as a tooltip on the red-flagged card on the ops board.
- **"Can't be scheduled"** operations found no feasible slot at all: no qualified operator exists, no manned coverage under a staffing-required policy, or no open capacity within the horizon. They get a non-binding placeholder bar marking where they *would* run, flagged with an **"Unschedulable"** chip; the panel notes the bar *"isn't holding capacity"* against other jobs.

The engine always produces a complete answer. Late work is placed and flagged, unplaceable work gets an explained placeholder, and the job's projected completion extends over both, so the forecast finish is never quietly optimistic.

## When the schedule recomputes

Scheduling reacts to its inputs. Editing anything the engine reads — a due date on the Priorities board, a manning assignment, a shift, a work center's hours or active flag, an operator qualification, a process's ability requirement, machine downtime — stamps the affected jobs **schedule outdated** and queues a **replan wave**. The wave is debounced about 30 seconds, so a burst of edits triggers a single regeneration of each affected location rather than one run per keystroke. The Forecast's **Regenerate** button runs the same whole-location regeneration on demand.

Two paths skip the wave and reschedule immediately: releasing or changing the status of a job, and the kanban auto-release flow. And a nightly pass re-anchors any schedule whose planned start has slipped into the past, so a quiet shop's forecast doesn't drift stale.

When a regeneration pushes jobs past their due dates that were previously on time, each affected job's assignee gets a **"Jobs projected late"** notification listing the newly late jobs. Silence means the change fit.

A regeneration always re-places every open job at the location, in deadline-class then due-date order, each job claiming capacity ahead of the ones behind it. That is what makes the answer reproducible: the same inputs always produce the same schedule.

## Troubleshooting

What the flags mean and why dates move (or don't) after an edit.

### An operation shows a red conflict flag
A conflict means the placement **finishes after the job's due date**, or the operation could not be placed at all. The stored `conflictReason` names the cause (e.g. *"Finishes … but the job is due … — waited for a qualified operator, queued behind …"*, *"No qualified operator for …"* naming the ability, *"No operator assigned"* under a staffing-required policy). It is **not** a "start date is in the past" signal; that old definition is gone. Fix the cause: move the due date out, add capacity or hours, man the station, or qualify an operator.

### An operation shows an amber "Projected" date
Amber is **behind target**, not a conflict: the projected finish is later than the operation's need-by target (its `dueDate`). The job may still be on time overall. It clears when capacity frees up or the target moves.

### The Forecast says "can't be scheduled"
No feasible slot existed: no qualified operator for the required ability, no manned coverage while the location's **Staffing required** policy is on (lights-out work centers exempt), or no open capacity in the horizon. The bar shown is a placeholder marking where the work would run; it holds no capacity. Man the station, qualify someone, or relax the constraint.

### New dates didn't appear right after my edit
Most edits (due-date drags, manning changes, shift/work-center/ability edits) stamp jobs **schedule outdated** and queue a debounced replan wave (~30 seconds after the last change, batched per company). Dates land when the wave finishes. Job release and status changes reschedule immediately. In local dev the jobs worker must be running or the wave never fires.

### Nothing rescheduled when I reordered cards on the Work Centers view
Reordering within the same column writes only the dispatch position, by design. Moving an operation to a **different work center** does queue a reschedule, because the engine must re-place it on the new machine's calendar. The MES Schedule board writes nothing at all.

### A pinned operation's dates still moved
A pin owns the **need-by target** (`dueDate`), not the placement. The engine re-projects a pinned operation's start and projected finish every run; only its target stays put (and upstream targets derive from it). The exception is a pinned outside-processing operation, which keeps its stored window.

### Flipping "Staffing required" didn't change the schedule
The toggle takes effect at the **next** regeneration; it does not queue one itself. Make any scheduling edit, press Regenerate on the Forecast, or wait for the nightly pass.

### I can't edit the boards
Board edits require the **production update** permission; viewing requires **production view**. The Forecast page requires the Business plan.

## Related

  - Jobs The work orders whose operations the engine places and sequences.
  - Work centers The stations, their operating hours, and the rates that cost them.
  - People Shifts, abilities, and the manning that gates qualified work.
  - Run the floor What operators see and do on the MES board once work is queued.
