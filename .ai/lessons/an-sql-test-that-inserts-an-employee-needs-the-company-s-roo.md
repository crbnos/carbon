---
paths: []
triggers: []
promoted: null
---
# An SQL test that inserts an employee needs the company's root group first

**Context:** Seeding employees in a `supabase/tests/*.test.sql` file (`rpc-privileges.test.sql`, 2026-10-26).

**Problem:** The `employee` insert fires the employee-type group interceptor, which needs the company's "All Employees" root group. A test company made by hand has no root group, so the insert fails. `SET session_replication_role` is not permitted there.

**Rule:** Insert the root group first, with the id `getGroupId` builds: `'00000000-0000-' || substr(c,1,4) || '-' || substr(c,5,4) || '-' || substr(c,9,12)` for company id `c`. Then insert the employee type and the employee.

**Applies to:** SQL tests under `packages/database/supabase/tests/` that create employees.
