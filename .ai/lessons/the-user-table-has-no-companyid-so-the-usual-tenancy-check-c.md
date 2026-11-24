---
paths: ["packages/jobs/src/workflows/actions/update.ts"]
triggers: ["userToCompany", "existsInCompany", "selectInCompany"]
promoted: null
---
# The `user` table has no `companyId`, so the usual tenancy check cannot be applied to it

**Context:** The workflow update executor must prove that every entity-typed
value it writes belongs to the acting company, or a workflow could point a row at
another tenant's record. The plan specified one generic
`select id where id = ? and companyId = ?` for that check.

**Problem:** Every entity-typed writable column in the workflow catalogue is an
assignee, and they all point at `user` — which is one of the few Carbon tables
with **no** `companyId` column. The literal check would have 400'd on every
assignee write, i.e. on every workflow that assigns anybody.

**Rule:** Membership for `user` is `userToCompany(userId, companyId)`, not a
column on the row. Route those entities through that join instead of skipping the
check — dropping it is the tenancy hole the check exists to close. Before writing
a "every table has `companyId`" helper, confirm it for the specific tables it
will actually receive.

**Applies to:** `packages/jobs/src/workflows/actions/update.ts`, and any generic
company-scoping helper that takes a table name at run time.
