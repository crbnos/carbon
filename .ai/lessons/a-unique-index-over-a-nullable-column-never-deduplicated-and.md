---
paths: ["packages/database/src/event-system/handlers/*membership*"]
triggers: ["CREATE UNIQUE INDEX", "uq_membership", "NULLS NOT DISTINCT"]
promoted: null
---
# A unique index over a nullable column never deduplicated, and adding a real one breaks silent writers

**Context:** Employee re-invite (2026-10-15). `membership` had `uq_membership ("groupId", "memberGroupId", "memberUserId")`, and every user membership has `memberGroupId` NULL.

**Problem:** Under the default `NULLS DISTINCT`, rows with a NULL in the key never conflict, so the constraint that looked like it deduplicated user memberships never had. Writers inserted duplicates without error. A new unique index on `("groupId", "memberUserId")` made those same writers fail: the insert interceptors had no `ON CONFLICT`, and the employee-type change interceptor moved a membership onto a group the user was already in. Each would have failed the employee, customer-account or supplier-account write that fired it.

**Rule:** Before adding a unique index, list every writer of the table, interceptors included, and give each one `ON CONFLICT … DO NOTHING` or a conflict-safe update in the same change. When a composite unique key includes a nullable column, assume it deduplicates nothing for rows where that column is NULL.

**Applies to:** `membership` and its interceptors in `packages/database/src/event-system/handlers/`, and any unique key with a nullable column.
