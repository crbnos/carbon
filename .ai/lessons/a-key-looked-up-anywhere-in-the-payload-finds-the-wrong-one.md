---
paths: []
triggers: []
promoted: null
---
# A key looked up "anywhere in the payload" finds the wrong one

**Context:** The API dispatcher decides whether an upsert creates or updates from the
record's `id`. It looked for `id` at the top level and then inside any nested object, to
support `{ job: { id } }`.

**Problem:** `{ name: "x", customFields: { id: "z" } }` matched the nested `id`, so a
create was stamped as an update and went down the service's update branch.

**Rule:** Read a record's key only where the record can be: the body itself or the wrapper
named by the service's payload parameter. A search that descends into arbitrary objects
will eventually match user data.

**Applies to:** `resolveUpsertOperation` / `recordField` in
`apps/erp/app/routes/api+/v1+/lib/dispatch.server.ts`.
