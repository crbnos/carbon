---
paths: ["packages/jobs/src/inngest/functions/tasks/sales-order-delivery-date-check.ts"]
triggers: ["check-sales-order-delivery-dates", "IS NOT DISTINCT FROM"]
promoted: null
---
# A background job that reads, works, then writes compares before it writes

**Context:** A sales order line saved at the Capacity level is checked by an Inngest job that reads the line, runs the shop schedule simulation, then writes the result.

**Problem:** Reading the line at the start protects against an old event, not against a save that lands during the simulation. The job wrote a result for the old quantity over the newer one, and credited a newer kept date to the user whose save started the job.

**Rule:** Walk the timeline read → slow work → write with a second save in the middle. Make the write conditional on the inputs that were read (`WHERE col IS NOT DISTINCT FROM v.col … RETURNING id`), and raise side effects only for the rows written. Put in the event what the triggering save wrote, so the job can tell when a later save has replaced it.

**Applies to:** Every deferred check or recalculation that writes a result computed from a row a user can still edit.
