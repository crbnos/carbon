# Slice 6B.2 — atomic Change Notice deletion

## Goal

Make Change Notice parent deletion one atomic, error-visible Kysely transaction without changing the route/API/MCP wire contract, `parts:delete` authorization, or Impact cascade scope. Draft cleanup is reference-driven: only `newItemId` and `draftMakeMethodId` values present on this tenant's locked affected-item rows may drive explicit cleanup. Unreferenced rows that merely carry the Change Notice id are not orphan-swept.

## Scope boundary

Slice 6B.2 owns the Change Notice parent-delete transaction and its explicitly referenced draft cleanup only. It does not add Impact-specific provenance reconciliation, source-deletion handling, or a generic Item-deletion protocol; those remain outside this slice and must not be inferred from the parent delete's existing database cascades. Slice 6C is not implemented here.

This is a local implementation and verification record for the checked-out tree. It does not claim direct upstream implementation or provenance.

## Files

- `apps/erp/app/modules/items/items.service.ts` — lock the tenant-owned parent and affected references, classify each referenced item from its complete locked Make Method set, validate item/method lifecycle, delete only referenced standalone Draft methods and pending inactive items, then delete the parent with exact count checks.
- `apps/erp/app/modules/items/items.service.test.ts` — recorder-boundary coverage for reference classification, tenant predicates, lifecycle contradictions, delete order/counts, and transaction-callback failures. PostgreSQL cascades are not replayed here.
- `apps/erp/app/routes/x+/items+/change-notice+/delete.$id.tsx` — pass the database singleton while retaining route permission, flash, and redirect behavior.
- `apps/erp/app/routes/api+/v1+/lib/dispatch-parity.test.ts` and `apps/erp/app/routes/api+/v1+/lib/base.server.ts` — preserve the public argument and API-key behavior; explicitly gate the OAuth service-role operation with the canonical exact-company permission predicate.
- `apps/erp/app/modules/agent/agent.tools.test.ts` and `packages/workflows/src/catalog/catalog.test.ts` — prove session agent/workflow surfaces do not expose the destructive operation.
- `apps/erp/test/mcp-tool-metadata.test.ts` — pin the unchanged destructive metadata contract.
- `packages/database/supabase/tests/change-notice-impact.test.sql` — verify the complete direct Change Notice FK inventory, delete actions, trigger-created method reuse, and real backlink/cascade behavior.

## Implementation checks

- [x] Keep one `db.transaction().execute(...)`; no Supabase writes in the transaction.
- [x] Scope every service read and explicit delete by `companyId`; do not scan foreign-company children or database-owned cascade tables.
- [x] Preserve the helper's non-parent callers and leave generic item deletion and Impact behavior untouched.
- [x] Keep `changeNoticeId` and generated `items_deleteChangeNotice` metadata unchanged: destructive classification, injected `companyId` and `db`, `parts:delete`, and null response.
- [x] Classify each referenced item once from its complete locked Make Method set: foreign-owned methods, owned non-Draft methods, and mixed Draft/non-Draft sets fail closed; all released methods are preserved; all safely owned Drafts retain the existing pending-inactive cleanup behavior.
- [x] Do not model PostgreSQL `CASCADE`, `SET NULL`, locks, or rollback in the unit fake.

## Verification record

- [x] Focused ERP tests: 119 passed across the four changed test files; the workflow package test suite passed with 431 tests across 25 files.
- [x] Scoped typechecks for `erp`, `@carbon/api`, and `@carbon/workflows` passed.
- [x] ERP build passed; targeted Biome checks passed for all eight changed TypeScript/TSX files; `git diff --check` passed.
- [x] `check:manifest` and `check:workflow-catalog` passed; generated MCP digest remained current.
- [x] The SQL fixture passed against the existing local PostgreSQL container without rebuilding or resetting the database; its transaction rolled back all fixture rows. It was executed through the repository's `pg` dependency because the shell image has no `psql` binary.
- [x] The direct RLS harness was run with `pnpm --filter @carbon/database exec tsx supabase/tests/change-notice-impact.rls.test.ts` and fails at `change-notice-impact.rls.test.ts:660` with `Task links do not reveal PO links to production-only users`. The same normalized failure was reproduced at Slice 6B.2 base HEAD, so it was not introduced by this patch. No upstream provenance claim is made. Complete RLS verification remains Slice 6C work.

The unit fake intentionally does not model PostgreSQL `CASCADE`, `SET NULL`, locks, or rollback; the SQL harness covers the live FK contract. Transaction rollback/concurrency remain database-behavior concerns outside this unit boundary. The SQL assertions document existing database behavior only; they do not expand Slice 6B.2 into Slice 6C.
