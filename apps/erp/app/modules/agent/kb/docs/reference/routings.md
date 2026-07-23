# Routings

> The ordered operations and work centers a part flows through to get made.

A **routing** is the recipe the shop floor follows to make a part: the ordered list of operations and
the work center each one runs on. It's what turns "we have an order" into "here's exactly what happens,
in what order, where."

Without a routing, a job can't be scheduled or costed. There's nothing to place on the board and
nothing to estimate run time from. The routing is the bridge between *what* you're making (the item) and
*how* it gets made (the schedule).

## Fields

  - **Operation**: The step performed, in sequence (e.g. *Cut*, *Weld*, *Inspect*).
  - **Work center**: Where the operation runs; supplies the rates used for scheduling.
  - **Setup time**: Fixed time to prepare the operation, independent of quantity.
  - **Run time**: Time per unit produced.
  - **Sequence**: Order of operations; lower runs first.

## Per-revision routings

Routings are defined per item revision, so a design change doesn't rewrite history. Jobs built against
an older revision keep the routing they were released with.

A routing with no operations can't be scheduled — the job will sit in **Planned** until at least one
operation exists.

## Related

  - Run the floor See routings in context: how a job inherits one and turns it into a schedule.
  - Methods & sourcing Where a routing's operations live alongside the part's materials.
  - Jobs What a routing operation becomes once a job copies it, runs it, and attaches its procedure.
