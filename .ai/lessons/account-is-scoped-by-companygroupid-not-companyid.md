---
paths: []
triggers: []
promoted: null
---
# `account` is scoped by `companyGroupId`, not `companyId`

**Context:** The dataset's accounting tier picked a GL account with `SELECT id FROM account WHERE class = 'Asset' ORDER BY number LIMIT 1` and posted the seeded journal lines against it. The tiers run on a raw `pg` client, which bypasses RLS entirely.

**Problem:** `account` is one of the few business tables NOT keyed by `companyId` — it belongs to the company *group*, so there is no `companyId` predicate to add by reflex and an unscoped `LIMIT 1` silently reaches across tenants. With RLS off there is nothing else stopping it, so one company's journal lines can be posted to another tenant's chart of accounts. Adding `AND "companyId" = $1` would simply have failed with `column "companyId" does not exist`, which is what makes the omission easy to leave in.

**Rule:** In any service-role or Kysely path, confirm which column actually scopes the table before writing the predicate — `companyId` for most, `companyGroupId` for `account` and its children. A `LIMIT 1` with no tenancy predicate in RLS-bypassing code is a cross-tenant bug even when it "works" locally, because a single-tenant dev database cannot show it.

**Applies to:** `packages/database/src/datasets/tiers/09-accounting.ts`; any `account` lookup in `packages/jobs/**`, `apps/erp/app/modules/**` postings, or a Kysely transaction.
