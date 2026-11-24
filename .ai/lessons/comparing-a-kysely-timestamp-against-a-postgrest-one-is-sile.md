---
paths: []
triggers: []
promoted: null
---
# Comparing a Kysely timestamp against a PostgREST one is silently always-false

**Context:** "Why does this one vendor resync every 30 minutes?" — the v5 reconciler's
master-data change check (`reconcileMasterData`, `jobs/…/integrations/reconcile.ts`).

**Problem:** `snapshot.updatedAt <= input.lastSyncedAt` compared an ISO string (loaded
via supabase-js) against a JS `Date` (loaded via Kysely — see the `date` lesson above;
timestamptz is still decoded as a `Date`). JS relational operators coerce both operands
toward NUMBER: the `Date` becomes epoch ms, the ISO string becomes `NaN`, and every
comparison with NaN is `false`. So the "unchanged since the last successful sync"
short-circuit could never fire, and every master-data row edited inside the 7-day sweep
window re-enqueued a no-op push twice an hour — ~336 green `Completed` rows per row.
Nothing failed, nothing was written remotely (the provider's own bailout does the same
comparison correctly, `Date <= Date`), so the only symptom was ledger noise. Both the
declared type (`lastSyncedAt: string | null`) and the existing golden tests (two matching
ISO strings) asserted the fiction.

**Rule:** never use `<`/`<=` on two timestamps that came from DIFFERENT clients. Convert
both to epoch ms first (`instantMs`). Where a value's runtime type disagrees with the
generated types, WIDEN the declared type (`string | Date | null`) rather than leaving the
lie in place — the widened type is what makes the next reader handle it. And write the
test with the argument shapes the caller REALLY passes: a test that feeds two tidy ISO
strings into a comparison bug passes forever.

**Applies to:** any decision function fed by both a Supabase-client read and a Kysely
read — `jobs/…/integrations/reconcile*.ts` above all; `packages/ee/src/accounting/core/**`
syncers (`syncInstant` in `charge-syncer.ts` is the pattern that got it right).

---

**Context:** A security report: any signed-in user could read, create, update and delete every
`public."user"` row through PostgREST. The policy was `FOR ALL USING
(has_any_company_permission('users_update'))`, and a self-serve signup holds `users_update` in
its own company.

**Problem:** `has_any_company_permission(claim)` answers "does the caller hold this permission
ANYWHERE?" It never relates the row to a company, so any policy built on it alone is
cross-tenant. A table with no `companyId` (`user`) cannot use the standard four-policy template,
so the shortcut looked reasonable.

**Rule:** Never gate a policy on `has_any_company_permission`. Every policy must connect the ROW
to a company in `get_companies_with_employee_role()` or
`get_companies_with_employee_permission(...)`. For tables without `companyId`, go through a
membership table (`userToCompany`, `employee`, …), as `20260924153817` does. When a global
row is shared by several tenants, also pin the columns no single tenant owns (a BEFORE UPDATE
guard on `current_user IN ('anon','authenticated')`), and revoke INSERT/DELETE from the API
roles when only the server writes them. Also check `pg_policies` for `qual = 'true'`.

**Applies to:** `packages/database/supabase/migrations/**` RLS on global tables (`user`,
`userPermission`, `group`), and any review of an RLS helper.

---

**Context:** A security report: with only the published anon key, a caller could reach 84+
SECURITY DEFINER functions through `/rest/v1/rpc` — inventory valuation, claims, document
sequences, the event interceptors — for any company, plus a SQL injection in
`get_company_id_from_foreign_key`. Table RLS held on all 438 tables; the functions went around it.

**Problem:** Every function in `public` is an RPC endpoint, and a SECURITY DEFINER one bypasses
RLS. Guards were written inline as `IF NOT (has_role(...) OR ...)`, which is NULL — not true —
when a lookup finds nothing, so they never raised. The obvious fix, `REVOKE EXECUTE`, segfaults
this Postgres image on the next anon call (`20260924192316`); a first draft of the fix did exactly
that and only a rule file caught it, because its test checked `has_function_privilege` instead of
making the call.

**Rule:** Never `REVOKE EXECUTE` on a public function. A SECURITY DEFINER function that takes a
company id calls `assert_company_access` first; one that only servers call raises on
`current_setting('role')`; everything internal (helpers, event interceptors) is SECURITY INVOKER.
Never trust a user id parameter without relating it to `auth.uid()`. Test a guard by CALLING the
function as `anon` and as another company's user, not by reading the catalog. Edge functions:
`verify_jwt` accepts the anon key, so authorize in-function (`requireCaller` / `requireServiceRole`).

**Applies to:** every `CREATE FUNCTION` in `packages/database/supabase/migrations/**`,
`packages/database/supabase/functions/*/index.ts`; enforced by the
`public-definer-function-authorizes-caller` invariant and `supabase/tests/rpc-privileges.test.sql`.
