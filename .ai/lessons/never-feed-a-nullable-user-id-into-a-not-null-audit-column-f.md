---
paths: []
triggers: []
promoted: null
---
# Never feed a nullable user id into a NOT NULL audit column from a DB function

**Context:** A live demo failed to record production quantities, backflush materials, or complete the job. `sync_update_job_operation_quantities` auto-flipped the operation to `Done` without stamping `updatedBy`; `sync_finish_job_operation` then passed `p_new->>'updatedBy'` (NULL) as `p_user_id` into `complete_job_to_inventory`, whose `itemLedger` insert violated `createdBy NOT NULL` (23502) and rolled back the entire cascade. A sweep found the same latent bug in `sync_purchase_invoice_line_price_change` (payload `updatedBy` → NOT NULL `purchaseInvoicePriceChange.updatedBy`) — right next to a migration that had fixed the adjacent trigger for exactly this reason.

**Problem:** `updatedBy` is nullable on every table, and trigger/interceptor UPDATEs don't go through the app layer that normally stamps it. So `p_new->>'updatedBy'`, `NEW."updatedBy"`, and `p_user_id DEFAULT NULL` params are all NULL-able user sources; writing them into a NOT NULL `createdBy`/`updatedBy`/`postedBy` makes the whole transaction (including the user's original write) roll back with 23502. The failure is invisible in testing whenever the row happens to have been user-updated before.

**Rule:** In SQL functions: (1) any UPDATE issued by a trigger/interceptor that other interceptors may react to must stamp `"updatedBy"` (from the payload's `createdBy`/`updatedBy`) and `"updatedAt"`; (2) never write a payload user field into a NOT NULL column without a fallback — `COALESCE(p_new->>'updatedBy', p_new->>'createdBy')` (`createdBy` is NOT NULL on source tables); (3) functions taking `p_user_id` that write audit columns must not default it to NULL, or must guard right after `BEGIN` with a fallback to the entity's `createdBy` (see `20260706182830_fix-null-user-audit-columns.sql`). When forking a large function to add such a guard, extract the newest body verbatim (sed) and diff-verify instead of retyping.

**Applies to:** `packages/database/supabase/migrations/` — all `sync_*` interceptors and any PL/pgSQL function writing `createdBy`/`updatedBy`/`postedBy`; reviews of new event-system interceptors.
