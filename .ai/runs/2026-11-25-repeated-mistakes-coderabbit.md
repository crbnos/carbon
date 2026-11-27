# Repeated mistakes: the CodeRabbit review findings, last 6 months

Candidates: the gaps in `.ai/research/2026-11-25-coderabbit-review-findings.md`.
One agent per cause searched `origin/main` for fix commits with the Step 1
command of `.claude/skills/find-repeated-mistakes/SKILL.md` and with `git log -S`
on the API each fix added. Kept: 15 fixes across 5 causes.

## A supabase-js update or delete on a tenant table filters by `id` alone
- Fixes: `573bcf0079` `x+/receipt+/$receiptId.post.tsx` (the receipt set to Pending by `id`); `0909321afd` `x+/sales-invoice+/update.tsx` (`dateIssued`, `paymentTermId`); `9ddb3bc295` `apps/mes/app/services/maintenance.service.ts` (four dispatch writes, a security report); `89bdf0e27e` `invoicing.service.ts`:`upsertSalesInvoiceShipment` / `upsertPurchaseInvoiceDelivery`.
- Existing guard: none. `no-unscoped-kysely-write` covers Kysely only.
- Enforcement: check `no-unscoped-supabase-write`, because the chain shows the missing filter.
- Proof: each parent is flagged and each fix passes; `provenance.incidents` lists the 4 shas.
- Baseline: 449 entries. A sample of 15 had 0 false positives. The check cannot tell an RLS client from the service role, as the Kysely check cannot.
- Known hole: `.upsert`, whose tenant key is the row and the conflict target.

## Two dependent writes in a service function run without a transaction
- Fixes: `efd366dba0` `sales.service.ts`:`upsertQuoteLinePrices` (delete, then re-insert); `37f71945a4` `items.service.ts`:`upsertMakeMethodVersion` (a Draft insert, then the source set Active); `f922057bbc` `sales.service.ts`:`insertCustomerContact` (an orphaned contact). Also `5cc9f8d0c2` (not in the incidents).
- Existing guard: `route-action-shape`, for routes only.
- Enforcement: check `no-chained-client-writes`, in `SERVER_CHECKS`. It reads the function bodies with the TypeScript compiler.
- Proof: the parents are flagged at `sales.service.ts:3957`, `items.service.ts:4335` and `sales.service.ts:2163`; the fixes pass.
- Baseline: 94 entries. A sample of 15 had 4 false positives: a retry-as-update upsert, a claim and its release around a transactional posting, deletes of a cache, and a bulk insert retried row by row.
- Known holes: writes through a helper, `.rpc`, a single write in a loop.

## A foreign key to a tenant table names `id` alone
- Fixes: `3fc6be2f2d` and `8a5281c6ff` `20261013030022_oee-provider.sql` (`workCenterDevice`, `machineStateChange`, `unattributedMachineTime` to `workCenter`); `aa781984a4` `20261105213627_supplier-prepayments.sql` (`payment.purchaseOrderId`); `ba1db4283e` `20261021002400_field-service.sql` (`customerAsset.customerId`).
- Existing guard: none. The lesson `database-migrations.md` "Single-column FKs on multi-tenant children accept cross-tenant ids".
- Enforcement: check `tenant-fk-composite`, in the migrations `scanAll` and `FILE_SETS`. It reads the parents' keys from every migration.
- Proof: each parent is flagged at its line and column; each fix passes.
- Baseline: none. Only migrations after `20261124175920` are checked. With the cutoff off, migrations since 2026-10-01 have 32 such keys, all real.
- Not confirmed: `52a6b3c741` (a reference to `journal`, which has no composite key on main).

## Server code calls an external endpoint with no timeout
- Fixes: `1098851cee` `packages/auth/src/services/self-signup.server.ts`:`isPlatformSignupDisabled`; `1f5183a1f2` `packages/stripe/src/gtm-events.server.ts`:`forwardToGtm`; `7138724800` `packages/ee/src/onshape/lib/oauth.ts`:`requestToken`.
- Existing guard: none. No shared fetch-with-timeout helper exists.
- Enforcement: check `no-untimed-fetch`, with its own roots (`UNTIMED_FETCH_ROOTS`) and its own `FILE_SETS` entry. `SERVER_CHECKS` skips `packages/auth`, `packages/ee` and `packages/stripe`, where all 3 fixes are.
- Proof: the parents are flagged at `self-signup.server.ts:70`, `gtm-events.server.ts:20` and `oauth.ts:145`; the fixes pass.
- Baseline: 23 entries for 25 findings. All 25 were read: 22 are real, 3 are false positives (a browser file with no path marker, a `data:` URL, a loopback to the app).

## A migration takes a long write lock on a live table
- Fixes, constraints added without `NOT VALID`: `efde0fe4ea` (account FKs), `ddeaab8da5` (posted-number CHECKs), `7a2220cf4d` (exchange-rate CHECKs), `b52644969b` (jobOperation FKs), `dab1966019` (a salesOrderLine CHECK). A `VALIDATE` moved out of its file: `b2e62f8c00`. `DROP INDEX` without `lock_timeout`: `86bd0af78d`, `90634155b3`.
- Existing guard: none.
- Enforcement: check `migration-lock-safe`, in `packages/checks/src/proposed/migration-lock-safe.ts`. It is written and tested (24 cases), but `CHECKS` does not include it.
- Why not registered: the repo does not follow the constraint rule today. Main has 220 such constraints since August, 140 of them on a column the same file adds, and `adf7c23698` removed `NOT VALID` on purpose. Registered as written, the check flags about 35 new migrations a month. The user decides whether to keep the rule for columns the same file adds.
- Not confirmed: `CREATE INDEX` without `lock_timeout`. The repo builds plain indexes on purpose (`c94312947a`, the reply on PR 2067).

## Not confirmed as checks
- A child id that belongs to the company but not to the parent the request names; a lost update; a missing value replaced by a default; a read cut at 1,000 rows. No text shows them reliably. Each one is now a rule line or a checklist question (see the research file).
