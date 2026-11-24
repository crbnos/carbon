---
paths: []
triggers: ["!inner(", "user(email)", ".in(\"user."]
promoted: null
---
# A PostgREST filter on an embedded column needs `!inner`, or it filters nothing

**Context:** The Linear and Jira inbound sync matched an issue's assignee to a Carbon employee with `userToCompany.select("userId,user(email)").in("user.email", [email])` (2026-10-19).

**Problem:** Without `!inner`, PostgREST applies the filter to the embed only: every `userToCompany` row comes back, with `user` set to null where the email did not match. The job took `employees[0]`, so every synced issue assigned the task to the company's first employee. Typecheck and a "returns rows" check both pass.

**Rule:** When a filter on an embedded column must restrict the parent rows, embed it as `relation!inner(...)`. Test it with a non-matching value and expect zero rows.

**Applies to:** every `.eq/.in/.ilike("embed.column", …)` on a Supabase select.
