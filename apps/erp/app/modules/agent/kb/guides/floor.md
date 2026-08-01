# Run the floor

> Work hits the floor; the floor reports back.

Time to build. You release the first production job, the first 30 robots, to the shop floor, along with the subassembly jobs for the parts that feed it. This is the handoff most shops fumble; in Carbon it's a single, traceable step.

## The schedule

The released work lands on the MES "Schedule" board, a Kanban with one column per work center. Each column holds the operations queued at that center, sorted by dispatch priority so the operator always sees what to run next. The Display popover lets each station tune its own board, toggling empty work centers on or off and showing or hiding the customer, description, due date, duration, progress, status, sales order, and thumbnail on each card. Filters narrow it further, by work center, process, tag, or assignee.

The MES board is a live read of the schedule, so operators can filter and focus but they don't drag work to reschedule it. Rebalancing the plan, moving an operation to a different work center or shifting a job's dates so Carbon reschedules it, happens on the `guides/plan`, where a planner owns the sequence. What lands here is the result.

## Operations & work centers

Open a job and its routing is an ordered list of operations. Each operation names a process (Mill, Deburr, Anodize, Assemble) and the work center that runs it, with separate setup, labor, and machine time so estimates and costs are honest about where the hours go.

Most operations run on your floor. But some don't, and Carbon plans for that explicitly:

- Inside operation: runs at one of your work centers, by your people.
- Outside operation: performed by a supplier. Anodizing the arm part, say: the step leaves your floor, goes out, and comes back to finish its routing.

Tie a process to a supplier and mark the operation Outside. Releasing the job raises an Outside Processing PO for that step, priced at the supplier's rate, and its lead time takes its place in the routing, so the schedule knows the arm is away being anodized.

## Work instructions

On the shop-floor view, an operator doesn't see a spreadsheet — they see rich work instructions: ordered steps, with images, for the exact operation in front of them. It reads like a great minimal manual, and it's always the current revision.

## At the station

When the operator opens their operation on the MES, the controls feel physical, closer to a machine panel than a form. A big Play button reads "Start"; press it and it becomes "Pause". Everything they do here flows straight back to the job:

- Clock time with the "Setup", "Labor", and "Machine" toggles, each of which starts and stops a production event, so the operation's estimated hours meet the actual ones.
- "Issue Material" to issue the operation's components onto the job as they're consumed.
- "Log Completed" for good units, "Log Scrap" with a scrap reason, or "Log Rework" as pieces come off the operation. "Complete All" reports the whole remaining quantity in one tap.
- "Finish" to close the operation. It ends every active production event in one move and flips the operation to "Done".

Logged hours multiply by the work center's labor and machine rates; issued material posts at its cost. By the time the operation reads "Done", the job already knows `guides/job-costing`.

"Finish" closes one operation for good. "End Operations", from the sidebar, is the end-of-shift move: it stops every production event you have running without completing or finishing any of them, so the clock stops but the work stays open for the next person to pick up. If time cards are turned on, clocking out does the same to your labor clock.

## Backflush & issue

Material leaves inventory two ways in Carbon, and the BoM decides which one applies to each component, so stock stays accurate without busywork:

- Issued: tracked material, like the serialized or batch-tracked motors, is issued to the operation (or picked to the line) so every unit is accounted for by its lot.
- Backflushed: non-tracked material is pulled from stock automatically the moment the operation or job reports complete. No transactions, no keystrokes.

Flag a material to backflush and you never reconcile it by hand. The moment an operation reports complete, what it consumed is gone from stock and `guides/job-costing` — while the parts that truly need tracing stay explicitly issued.

## Scan & trace

For parts that demand a paper trail, operators scan as they build. Under the hood, every physical thing (a serial, a batch, a lot) is a tracked entity. Scanning a child into the unit you're building records a `docs/reference/traceability`: the child is marked consumed, the unit is marked produced, and the link between them is permanent.

Serialize what you track one-by-one: the finished robot, its arm, its leg. Batch-track what moves in lots: motors, fasteners, raw stock. Scan a serial into a batch and Carbon records the link, so the robot's record knows exactly which motor lot it carries.
