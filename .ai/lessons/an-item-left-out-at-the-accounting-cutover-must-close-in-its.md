---
paths: []
triggers: []
promoted: null
---
# An item left out at the accounting cutover must close in its own sub-ledger

**Context:** Migration Clearing's Ignore (2026-10-13): an invoice another system already settled is left out of the opening journal.

**Problem:** Dropping an item from the opening journal alone leaves its document open. The AR/AP readers fall back to the invoice total when no control line exists, so the invoice stays in aging, the tie-out shows a permanent variance, and a later payment is refused ("Target is missing its original control account"). And an invoice Carbon itself settles on or after the cutover posts a payment journal that credits the control account, which then has no opening line to credit.

**Rule:** Leave an item out only when the sub-ledger can say it is closed: an invoice is marked Paid the day before the cutover by the enable. Refuse it when Carbon settles it on or after the cutover (`settledFromCutoverIds`). Any other item type (memo, payment, WIP, lease, inventory, fixed asset) has no such state and stays in the opening journal.

**Applies to:** `packages/database/src/accounting-cutover/trial-balance.ts`, `apps/erp/app/modules/accounting/accounting.service.ts`.
