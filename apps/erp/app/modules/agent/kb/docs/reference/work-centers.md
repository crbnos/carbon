# Work centers

> Where operations run — the stations and machines, their rates, and the processes they perform.

A **work center** is a place on the floor where operations run, tied to a location: a station, a machine, a cell. It carries the rates used to cost and schedule work, and performs one or more **processes** (the capabilities, like *cut* or *weld*).

Routing operations are scheduled onto work centers, and a work center's rates price the labor and machine time logged against it. It's the link between an operation in the abstract and a real place with a cost and a calendar.

## Fields

  - **Name**: Unique within its location.
  - **Location**: The site it belongs to.
  - **Labor rate**: Cost per labor hour.
  - **Machine rate**: Cost per machine hour.
  - **Overhead rate**: Cost per hour of overhead.
  - **Default standard factor**: How time is expressed (e.g. *Minutes/Piece*).
  - **Required ability**: A skill an operator must hold to run it.

## Processes

A **process** is a capability a work center can perform; work centers and processes are many-to-many. A process is *Inside*, *Outside*, or both. **Outside** processes are subcontracted, and suppliers attach to them for outside-processing purchase orders.

A work center is **not** a fixed asset. The machine you schedule production on (a work center) and the machine you depreciate (a fixed asset) are independent records in Carbon. There's no link between them, even when they're the same physical machine.

## Rates: estimate vs actual

Rates exist at two layers. When an operation picks a work center, that work center's rates are **copied onto the operation** as a snapshot. That's what drives the cost *estimate*. The **actual** labor and machine cost posted to the ledger reads the work center's *live* rate at the time the production event was logged. The two can diverge if a rate changes after an operation is planned.

## Capacity

Work centers have no fixed capacity field. Load is derived from the durations of the operations scheduled onto them. Shifts in Carbon are an employee-and-location concept and aren't bound to work centers. A work center can also be temporarily **blocked** by an in-progress maintenance task that takes it down.

## Related

  - Routings The operations that get scheduled onto work centers.
  - Manufacturing accounting How a work center's rates become a job's labor and machine cost.
