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
  - **Department**: The department the work center rolls up to.
  - **Default unit**: The standard factor time is expressed in (e.g. *Minutes/Piece*).
  - **Always on**: Lights-out (24×7) operation. The scheduler treats the work center as continuously open, and it is exempt from a location's staffing-required policy.
  - **Shifts**: Shifts assigned to this work center. They define its operating hours for scheduling; without them, the location's shifts (or a stock Mon–Fri, 8-hour week) apply.

## Processes

A **process** is a capability a work center can perform; work centers and processes are many-to-many. A process is *Inside*, *Outside*, or both. **Outside** processes are subcontracted, and suppliers attach to them for outside-processing purchase orders.

A work center is **not** a fixed asset. The machine you schedule production on (a work center) and the machine you depreciate (a fixed asset) are independent records in Carbon. There's no link between them, even when they're the same physical machine.

## Rates: estimate vs actual

Rates exist at two layers. When an operation picks a work center, that work center's rates are **copied onto the operation** as a snapshot. That's what drives the cost *estimate*. The **actual** labor and machine cost posted to the ledger reads the work center's *live* rate at the time the production event was logged. The two can diverge if a rate changes after an operation is planned.

## Capacity and operating hours

A work center is a **finite resource**: the `docs/reference/scheduling` places one operation on it at a time, inside its real operating hours. Those hours come from a ladder, first rule wins: **Always on** (lights-out, continuously open) → the work center's own assigned shifts → the location's shifts → a stock Mon–Fri, 8-hour week. Booked time is materialized as capacity reservation rows, which is what the Forecast page draws.

An open maintenance task that takes the work center offline subtracts its downtime from those hours (lights-out machines included), so the scheduler routes work around a machine that's down rather than booking it.

## Related

  - Routings The operations that get scheduled onto work centers.
  - Manufacturing accounting How a work center's rates become a job's labor and machine cost.
