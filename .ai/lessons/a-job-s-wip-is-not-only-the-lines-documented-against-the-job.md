---
paths: []
triggers: []
promoted: null
---
# A job's WIP is not only the lines documented against the job

- **Context:** Finished goods from a job with an outside processing operation came out without the supplier's cost.
- **Problem:** The receipt of an outside processing purchase order debits WIP with `documentId` = the receipt and the purchase order line in `documentLineReference`. The job completion, `closeJob` and `attachJob` each summed WIP `WHERE documentId = <job>`, so the supplier's cost was never moved to finished goods and never written off. And when the receipt finished the job's last operation, `postReceipt` set the operation Done before it wrote its journal, so the completion that update triggers ran before the debit existed.
- **Rule:** Read a job's WIP with SQL `job_wip_balance`, never with a `documentId` filter of your own. A reader that cannot call it per job (a set-based read of every job, such as the accounting cutover's per-job WIP items) attributes lines through SQL `job_receipt_line_references`, the rule `job_wip_balance` uses. A posting that can trigger a job completion (any write that sets a `jobOperation` Done) writes its own journal first.
- **Applies to:** `complete_job_to_inventory`, `closeJob`, `attachJob`, `postReceipt`, `getWorkInProgressItems` (`accounting-cutover/open-items.ts`), and any new reader of a job's cost or writer of a job operation's status.
