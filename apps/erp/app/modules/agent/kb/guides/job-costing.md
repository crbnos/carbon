# How a job costs out

> Where a job's cost comes from, and how it piles up in work-in-process.

The `guides/order` built robots. This flow follows the money those jobs spend. As a job is worked, Carbon accumulates its cost (materials consumed, labor and machine time) into work-in-process, then releases that cost into finished-goods inventory when the job completes. Every figure here is grounded in real ledger postings, so it's worth being precise about what posts, when, and to which account.

## Accounting is a switch

The first thing to know is that costing is gated. A company setting, **accounting enabled**, is **off by default**. With it off, the physical world still moves: the item ledger records quantities, job and operation statuses advance, material gets issued. But no general-ledger entries and no cost layers are written. Turn it on and the same operations also post money.

Receiving, issuing, completing: the physical and status changes happen regardless. The GL postings described in this flow are written only when accounting is enabled for the company, so a shop can run operationally before it runs its books.

## Cost lands in WIP

As the job runs, cost flows **into** its work-in-process. Two streams feed it.

**Material.** When a job consumes a part (issued to an operation, or backflushed at completion), Carbon moves that part's cost out of inventory and into WIP. The ledger entry is a debit to the work-in-process account and a credit to inventory, tagged *Job Consumption*.

**Labor and machine.** Every production event a worker or machine logs carries a duration. Carbon prices it (hours times the **work center's** labor or machine rate) and posts it in real time: a debit to WIP, a credit to a labor-absorption account, tagged *Production Event*. The rate comes from the work center, not from the operation's estimate.

Only material and the labor/machine event rates post to WIP. Overhead rates exist on work centers and operations, but they drive estimating and quoting; Carbon does not absorb overhead into a job's actual cost. WIP is the sum of real material plus real time.

## Issued or backflushed

That material reaches WIP one of two ways, and the difference is *when*. **Issuing** pushes a part to an operation as the work happens, the same move the picking list drives when it stages material to the line. **Backflushing** waits for the finish: when the job completes, Carbon consumes whatever the method called for that wasn't already issued, in a single sweep.

The posting is identical either way (cost out of inventory, into WIP), so the choice is about floor discipline, not accounting. Issue as you go when you need tight control over what's consumed; lean on backflush for the routine material you'd rather not hand-count.

Scrap and rework are recorded as their own production quantities, but scrapping a tracked part posts the same consumption: out of inventory, into the job's WIP. There's no separate scrap account; the cost of what you ruined rides along in the job until it settles at close.

## WIP isn't a table

Here's the part most ERPs hide. In Carbon, work-in-process is not a column or a table you can read off a job. It's a **balance in the `docs/reference/accounting`**, the sum of every posting against the work-in-process account that carries this job's id. A job's WIP is a query, not a field.

The cost itself lives in the **cost ledger**, where each inbound entry opens a layer with a remaining quantity. How a consumed part is priced depends on the item's costing method: **FIFO** or **LIFO** walk the open layers, **Average** uses the running unit cost, **Standard** uses the standard cost. That choice changes the *amount* of the WIP entry, but the shape never changes: cost in from inventory, cost out to finished goods.

There is no separate cost-layer table. Open layers are cost-ledger rows that still have remaining quantity. Consuming walks those layers by date for FIFO or LIFO; the costing method only decides which cost a consumption picks up, never whether WIP is tracked.
