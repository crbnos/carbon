---
paths: ["packages/api/src/permissions.ts"]
triggers: ["permission: {}", "refuseKeyWithout"]
promoted: null
---
# `permission: {}` admits a read-only API key

**Context:** A person logs their own time, so `logTimesheetEntry` and its siblings gate on
company membership (`permission: {}`).

**Problem:** For an API key, membership means any scope in the company. Publishing these
operations let a key with only `sales_view` write time and post labor cost under the name of
the person who created the key. The manifest shows no permission, so nothing looks wrong.

**Rule:** A write gated on `{}` starts with `refuseKeyWithout(ctx, required)`. Before you tag
an operation `@mcp`, ask what its gate means for a key, not only for a person.

**Applies to:** `permission: {}` on any published write, `packages/api/src/permissions.ts`.
