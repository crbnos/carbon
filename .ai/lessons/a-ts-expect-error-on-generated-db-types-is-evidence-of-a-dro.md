---
paths: []
triggers: []
promoted: null
---
# A `@ts-expect-error` on generated DB types is evidence of a dropped column, not a type quirk

**Context:** `InventoryTable.tsx` read `row.original.tags` behind a `// @ts-expect-error TS2339`. The suppression was correct that the property was missing — `20260713235406` had forked `get_inventory_quantities` and dropped the `tags` output added by `20260113122437` (the sibling-branch failure mode above). The regression then hid in plain sight for months: the Tags column silently rendered empty, and the Tags filter sent `.overlaps("tags", …)` → PostgREST 42703 against a nonexistent column.

**Problem:** Generated types are mechanically derived from the live schema, so TS2339 on a generated Row/Returns type is never a false positive — it is the type system reporting that the column does not exist. Suppressing it converts a compile-time regression signal into a silent runtime one. The blast radius was widened by `quantities.tsx` calling `redirect(...)` without `throw`, which discarded the resulting PostgREST error and rendered an empty table instead of surfacing it.

**Rule:** Never `@ts-expect-error` / `@ts-ignore` a missing property on a `@carbon/database` generated type. Grep every migration touching the function or table (`grep -l '<name>' migrations/*.sql | sort`) and find the revision that removed it — the fix is a migration restoring the column, not a suppression. When reviewing, treat a `@ts-expect-error` near generated types as a probable dropped-column regression. Corollary: in a loader, always `return` or `throw redirect(...)` on a service error — a `redirect(...)` that is neither returned nor thrown is a no-op that swallows the error and renders empty data.

**Applies to:** `packages/database/src/types.ts` consumers; `apps/erp/app/modules/**/ui/**` table columns bound to RPC outputs; any loader branching on `{ data, error }`.
