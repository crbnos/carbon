# Ramp nuclear remediation — implementation plan

**Source:** 2026-09-10 nuclear self-review of PR #1503
**Branch:** feat/feat-ramp

## Progress

- [x] Task 1: Replace unsafe Ramp allocation
- [x] Task 2: Add single-use OAuth state sessions
- [x] Task 3: Add atomic integration-state patching
- [x] Task 4: Harden the Ramp OAuth callback and install ordering
- [x] Task 5: Reconcile the card-transaction schema forward
- [x] Task 6: Make ERP card-transaction reads tenant-safe
- [x] Task 7: Make card post/void transactional and idempotent
- [x] Task 8: Validate Ramp monetary payloads and inbound policy
- [x] Task 9: Use stable outbound cursors and resumable payments
- [x] Task 10: Refresh documentation and run final gates
- [x] Task 11: Split the Ramp jobs coordinator below the nuclear size gate
- [x] Task 12: Split the Ramp service below the nuclear size gate
- [x] Task 13: Make card ingestion transactional and retry-safe
- [x] Task 14: Harden the card-posting transaction boundary
- [x] Task 15: Page outbound document-line reads
- [x] Task 16: Make inbound bill staging transactional and provenance-safe
- [x] Task 17: Surface family drain failures
- [x] Task 18: Make provider charge create/void retry-safe
- [x] Task 19: Bind edge permissions to the authenticated JWT subject (`a30afa3fc7`)
- [x] Task 20: Reject ignored Payment/Cashback coding lines (`c4e2a33380`)
- [x] Task 21: Keep failed Ramp bill archival retryable (`13435e74cb`)
- [x] Task 22: Hold outbound cursors on supplier lookup errors (`04eb4d7216`)
- [x] Task 23: Refresh mapped card Drafts from corrected Ramp input (`7666cc8f61`)
- [x] Task 24: Bind journal dimensions to preallocated line ids (`5bf802406c`)
- [x] Task 25: Require authoritative outbound invoice FX (`8438ecf5e6`)
- [x] Task 26: Fail closed on unsupported financial discriminators (`e13c6ab70a`)
- [x] Task 27: Reject invalid card coding-line magnitudes (`ef1b83f26f`)
- [x] Task 28: Release-gate unverified outbound bill export (`21d83b81a4`)
- [x] Task 29: Authenticate every webhook challenge (`95ad2310e0`)
- [x] Task 30: Constrain legacy reimbursement adoption (`80281070e1`)

## Dependencies

Tasks 2 and 5 are independent. Task 3 depends on its migration being applied and generated. Task 4 depends on Tasks 2–3. Task 6 depends on Task 5. Task 7 depends on Task 5. Task 8 is independent. Task 9 depends on Tasks 3 and 8. Tasks 11–12 depend on the completed behavioral fixes and preserve their contracts. Tasks 13–18 are the findings from the follow-up nuclear review and depend on the relevant earlier foundations. Tasks 19–30 resolve the final review's ten Must Fixes plus its line-magnitude and webhook risks. Task 10's final gates depend on all implementation and nuclear-refactor tasks.

---

## Task 1: Replace unsafe Ramp allocation

**Depends on:** none
**Files:**
- Create: `packages/ee/src/ramp/lib/allocation.ts`
- Modify: `packages/ee/src/ramp/lib/index.ts`
- Modify: `packages/ee/src/ramp/lib/service.ts`
- Modify: `packages/ee/src/ramp/lib/__tests__/service.test.ts`
- Modify: `.claude/rules/ramp-integration.md`

**Steps:**
1. Move both scaling functions into `allocation.ts`.
2. Compute exact proportional values and delegate residual placement to `distributeRoundingResidual`.
3. Reject non-finite input and nonzero targets without a source basis.
4. Preserve the public `@carbon/ee/ramp.server` exports.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/ramp/lib/__tests__/service.test.ts
pnpm --filter @carbon/ee test
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
# Expected: 42 targeted and the full EE suite pass; both typechecks exit 0.
```

**Out of scope:** Other Ramp service refactors.

## Task 2: Add single-use OAuth state sessions

**Depends on:** none
**Files:**
- Create: `packages/auth/src/lib/oauth-state.server.ts`
- Create: `packages/auth/src/lib/oauth-state.server.test.ts`
- Modify: `packages/auth/package.json`
- Modify: `apps/erp/app/routes/x+/settings+/integrations.tsx`
- Modify: `apps/erp/app/modules/settings/ui/Integrations/IntegrationCard.tsx`
- Copy from (precedent): `packages/auth/src/services/session.server.ts`

**Steps:**
1. Add a server-only auth export that issues and consumes a cryptographically random, ten-minute OAuth nonce in a signed HttpOnly SameSite=Lax cookie.
2. Bind each nonce to `integrationId`, `userId`, and `companyId`; consumption is one-time and clears mismatches.
3. Issue Ramp state in the integrations loader and attach its `Set-Cookie` header.
4. Require the server-issued Ramp state in `IntegrationCard`; remove random client fallback for OAuth integrations.
5. Add red→green tests for valid, expired, replayed, altered, user-mismatched, and company-mismatched state.

**Verify:**
```bash
pnpm --filter @carbon/auth exec vitest run src/lib/oauth-state.server.test.ts
pnpm exec turbo run typecheck --filter=@carbon/auth --filter=erp
# Expected: OAuth-state tests pass and both packages typecheck.
```

**Out of scope:** Changing the primary Carbon authentication session.

## Task 3: Add atomic integration-state patching

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<generated>_upsert-company-integration-patch.sql`
- Create: `packages/database/supabase/tests/integration-metadata-patch.test.sql`
- Modify: `apps/erp/app/modules/settings/settings.server.ts`
- Modify: `packages/ee/src/integrations/secrets.ts`
- Modify: `packages/ee/src/integrations/secrets.test.ts`
- Create: `packages/ee/src/ramp/lib/state.ts`
- Create: `packages/ee/src/ramp/lib/__tests__/state.test.ts`

**Steps:**
1. Create the migration with `pnpm db:migrate:new upsert-company-integration-patch`.
2. Add a service-role-only `SECURITY DEFINER` RPC that locks `(integrationId, companyId)`, patches declared metadata/secret keys, writes Vault and the integration row atomically, and never accepts a stale whole-object replacement.
3. Keep settings-owned and runtime-owned keys separate; runtime owns OAuth tokens, expiry, connection/webhook identifiers and secrets, and `cursors.*`.
4. Migrate Ramp token, connection, webhook, cursor, and settings writers to patch only their owned keys.
5. Prove disjoint stale patches compose and Vault/metadata failures roll back together.

**Verify:**
```bash
pnpm db:migrate
pnpm run generate:types
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/integration-metadata-patch.test.sql
pnpm --filter @carbon/ee exec vitest run src/integrations/secrets.test.ts src/ramp/lib/__tests__/state.test.ts
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/ee --filter=erp
# Expected: SQL rolls back after all assertions; tests and scoped typechecks pass.
```

**Out of scope:** Changing full-replacement semantics for non-Ramp integrations.

## Task 4: Harden the Ramp OAuth callback and install ordering

**Depends on:** Tasks 2–3
**Files:**
- Modify: `apps/erp/app/routes/api+/integrations.ramp.oauth.ts`
- Modify: `apps/erp/app/modules/settings/integration-errors.ts`
- Create: `apps/erp/app/routes/api+/integrations.ramp.oauth.test.ts`
- Modify: `packages/ee/src/ramp/hooks.server.ts`

**Steps:**
1. Consume state against Ramp, user, and company before exchanging the code; clear the state cookie on success and failure.
2. Store credentials through the atomic patch RPC and remove `@ts-ignore`.
3. Redirect with stable error codes and keep provider messages server-side.
4. Do not launch financial synchronization until required account mappings and entity configuration validate; convergence may run only for configured families.
5. Test invalid/replayed state, metadata preservation, stable errors, and disabled initial financial sync.

**Verify:**
```bash
pnpm --dir apps/erp exec vitest run 'app/routes/api+/integrations.ramp.oauth.test.ts'
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee
# Expected: callback security/configuration tests pass and both packages typecheck.
```

**Out of scope:** Live Ramp authorization, which requires external credentials.

## Task 5: Reconcile the card-transaction schema forward

**Depends on:** none
**Files:**
- Modify: `packages/database/supabase/migrations/20260820143726_ramp-integration.sql`
- Modify: `packages/database/supabase/migrations/20260822154812_cardtransactionline-rls-fix.sql`
- Modify: `packages/database/supabase/migrations/20260910183955_ramp-card-transaction-supplier-and-event-trigger.sql`
- Create: `packages/database/supabase/migrations/<generated>_reconcile-ramp-card-transactions.sql`
- Create: `packages/database/supabase/tests/ramp-card-transaction-integrity.test.sql`

**Steps:**
1. Tombstone the three branch-only backdated/ordering-dependent migrations.
2. Create a forward retry-safe migration with `pnpm db:migrate:new reconcile-ramp-card-transactions` that converges clean and previously-applied branch databases.
3. Use `id()`, composite `(id, companyId)` primary keys, tenant-composite line/supplier/cost-center foreign keys, and supporting indexes.
4. Add Draft-only RLS plus a parent-locking line-mutation trigger so posting and line edits serialize.
5. Validate card/offset accounts against the company group.
6. Fail with offending IDs if branch-local cross-tenant rows exist; do not rewrite ownership.

**Verify:**
```bash
pnpm db:migrate
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/ramp-card-transaction-integrity.test.sql
pnpm run generate:types
pnpm --filter @carbon/database typecheck
# Expected: migration applies without reset, integrity tests pass and roll back, generated types compile.
```

**Out of scope:** Rebuilding or resetting the database.

## Task 6: Make ERP card-transaction reads tenant-safe

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts`
- Modify: `apps/erp/app/routes/x+/invoicing+/card-transactions.$id.tsx`
- Create: `apps/erp/app/modules/invoicing/invoicing.service.card-transaction.test.ts`
- Create: `apps/erp/app/routes/x+/invoicing+/card-transactions.$id.test.ts`
- Copy from (precedent): `apps/erp/app/routes/x+/invoicing+/purchase-invoice.$id.tsx`

**Steps:**
1. Require `companyId` in `getCardTransaction` and filter by both company and ID.
2. Scope account lookups by `companyGroupId`; keep document reads company-scoped.
3. Fail the loader on auxiliary query errors rather than rendering raw identifiers.
4. Integrate without overwriting the existing confirmation-modal work.

**Verify:**
```bash
pnpm --dir apps/erp exec vitest run app/modules/invoicing/invoicing.service.card-transaction.test.ts 'app/routes/x+/invoicing+/card-transactions.$id.test.ts'
pnpm exec turbo run typecheck --filter=erp
# Expected: tenant and fail-closed regression tests pass; ERP typecheck exits 0.
```

**Out of scope:** Visual redesign of the card-transaction page.

## Task 7: Make card post/void transactional and idempotent

**Depends on:** Task 5
**Files:**
- Create: `packages/database/supabase/functions/post-card-transaction/post-card-transaction-transaction.ts`
- Create: `packages/database/supabase/functions/post-card-transaction/post-card-transaction-post.ts`
- Create: `packages/database/supabase/functions/post-card-transaction/post-card-transaction-void.ts`
- Modify: `packages/database/supabase/functions/post-card-transaction/index.ts`
- Create: `packages/database/supabase/functions/post-card-transaction/post-card-transaction-transaction.test.ts`
- Create: `packages/database/supabase/functions/post-card-transaction/post-card-transaction-concurrency.test.ts`
- Copy from (precedent): `packages/database/supabase/functions/post-payment/post-payment-transaction.ts`

**Steps:**
1. Lock the full company-scoped header before reading settings, lines, accounts, periods, journal data, or dimensions.
2. Load and write all authoritative posting data in one Kysely transaction.
3. Make repeated post/void requests return the existing result without creating another journal.
4. Fail closed on settings/query errors and validate account classes/group, costs centers, periods, and original journal provenance.
5. Use `datetime.timestamp()` and eliminate JavaScript `Date` calls.
6. Prove rollback and real two-connection serialization against the parent-locking mutation trigger.

**Verify:**
```bash
pnpm exec tsx scripts/run-local-accounting-check.ts deno test --no-lock --no-check --allow-env --allow-net --config packages/database/supabase/functions/deno.json packages/database/supabase/functions/post-card-transaction/post-card-transaction.test.ts packages/database/supabase/functions/post-card-transaction/post-card-transaction-transaction.test.ts packages/database/supabase/functions/post-card-transaction/post-card-transaction-concurrency.test.ts
# Expected: pure, rollback, tenant, idempotency, and concurrency tests pass with none skipped.
```

**Out of scope:** Changing the economic journal shape beyond validating its existing account assumptions.

## Task 8: Validate Ramp monetary payloads and inbound policy

**Depends on:** none
**Files:**
- Create: `packages/ee/src/ramp/lib/money.ts`
- Create: `packages/ee/src/ramp/lib/__tests__/money.test.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-policy.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-policy.test.ts`
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync.ts`
- Modify: `packages/ee/src/ramp/lib/index.ts`

**Steps:**
1. Normalize verified minor-unit object shapes and the deprecated major-unit card fallback explicitly; reject absent/non-finite/ambiguous values per item.
2. Never default unknown currency precision or foreign exchange rates to two/one.
3. Centralize family toggle policy and entity matching.
4. Require transfers/cashbacks to honor `pullTransactions`; locally reject rows outside configured entity scope without confirming them.
5. Add red→green amount, toggle, and entity matrix tests.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/ramp/lib/__tests__/money.test.ts
pnpm --filter @carbon/jobs exec vitest run src/inngest/functions/integrations/ramp-sync-policy.test.ts
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
# Expected: monetary and policy regressions pass; both packages typecheck.
```

**Out of scope:** Guessing unverified Ramp bare-number units; unsupported shapes fail visibly.

## Task 9: Use stable outbound cursors and resumable payments

**Depends on:** Tasks 3 and 8
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-cursor.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-cursor.test.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-payment.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-payment.test.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-reimbursement.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-reimbursement.test.ts`
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync.ts`
- Modify: `packages/ee/src/ramp/lib/models.ts`
- Modify: `packages/ee/src/accounting/index.ts`

**Steps:**
1. Replace PO/invoice timestamp cursors with backward-compatible `(updatedAt,id)` keysets and hold before the first failure.
2. Reuse the accounting payment-application core for source/target FX snapshots and atomic Draft/payment mapping creation.
3. Give reimbursement payments a stable synthetic external identity and resume Draft/ambiguous posts instead of skipping mapped invoices.
4. Confirm paid reimbursements only after the Carbon payment is observably Posted.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/inngest/functions/integrations/ramp-sync-cursor.test.ts src/inngest/functions/integrations/ramp-sync-payment.test.ts src/inngest/functions/integrations/ramp-sync-reimbursement.test.ts
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/ee
# Expected: timestamp ties and crash/retry cases pass; both packages typecheck.
```

**Out of scope:** Automatically associating any pre-existing untracked production payment.

## Task 11: Split the Ramp jobs coordinator below the nuclear size gate

**Depends on:** Tasks 8–9
**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-shared.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-card.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-bill.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-reimbursement-family.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-repayment.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-outbound.ts`

**Steps:**
1. Keep the deployed function id, event, concurrency key, step ids, ordering, result shape, and notification behavior in the coordinator.
2. Move each sync family into a named module without changing its confirmation, cursor, or failure-isolation contract.
3. Move cross-family tenant/currency helpers into an import-light shared module.

**Verify:**
```bash
pnpm --filter @carbon/jobs test
RUN_RAMP_DB_TESTS=true pnpm --filter @carbon/jobs exec vitest run src/inngest/functions/integrations/ramp-sync-payment.integration.test.ts src/inngest/functions/integrations/ramp-sync-reimbursement.integration.test.ts
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/ee
# Expected: all runnable jobs tests and all six real-DB tests pass; both typechecks exit 0.
```

**Out of scope:** Renaming durable Inngest identifiers or changing provider behavior.

## Task 12: Split the Ramp service below the nuclear size gate

**Depends on:** Tasks 1, 3–4, and 8
**Files:**
- Modify: `packages/ee/src/ramp/lib/service.ts`
- Create: `packages/ee/src/ramp/lib/connection.ts`
- Create: `packages/ee/src/ramp/lib/chart-of-accounts.ts`
- Create: `packages/ee/src/ramp/lib/cost-centers.ts`
- Create: `packages/ee/src/ramp/lib/suppliers.ts`
- Create: `packages/ee/src/ramp/lib/spend.ts`
- Create: `packages/ee/src/ramp/lib/sync-confirmation.ts`
- Create: `packages/ee/src/ramp/lib/webhooks.ts`

**Steps:**
1. Preserve `service.ts` as the stable compatibility facade and retain its complete public export set.
2. Move implementation into cohesive domain modules with one-way dependencies on connection/state helpers.
3. Keep provider payloads, return values, and public `@carbon/ee/ramp.server` imports unchanged.

**Verify:**
```bash
pnpm --filter @carbon/ee test
pnpm --filter @carbon/ee exec vitest run src/ramp/lib/__tests__/service.test.ts src/ramp/lib/__tests__/service-production.test.ts
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
# Expected: the full EE suite and characterization tests pass; both typechecks exit 0.
```

**Out of scope:** Redesigning the Ramp client or changing the facade contract.

## Tasks 13–18: Follow-up nuclear-review hardening

**Depends on:** Tasks 5–9 and 11–12

The follow-up review found six cross-cutting correctness gaps. Each landed as an isolated
commit with its own regression coverage:

1. `01e0fec3c5` — card ingestion now advisory-locks and atomically stages the Draft header,
   lines, and mapping; retries resume and ambiguous posts require an observed `Posted` row.
2. `7b7f561247` — the card-post edge requires invoicing-update permission, avoids nested line
   locks, uses the shared accounting-period resolver, and scopes its fault trigger.
3. `7b29e22ca7` — outbound purchase-order, invoice, and journal document-line reads paginate
   beyond the Supabase 1,000-row response limit.
4. `aa95b5ff84` — inbound bills stage atomically; single-PO conversion preserves exact line
   provenance and quantities, multi-PO bills remain standalone, and legacy adoption is
   restricted to one untracked Draft.
5. `432b3b28cb` — every family exposes drain/confirm errors and accumulates rather than
   overwrites failure counts, so the coordinator notification cannot report false success.
6. `30e5f1f81d` — charge create retries use deterministic provider identities, successful
   batch items link immediately, and Rillet/Xero/QBO native void paths fail closed unless
   the remote operation is confirmed.

**Verification:** Focused unit, integration, real-database, Deno, and scoped typecheck gates
are recorded in the commits. Task 10 reruns the aggregate branch gates after these changes.

## Tasks 19–30: Final nuclear-review corrections

**Depends on:** Tasks 5–9 and 13–18

The ten Must Fixes and two independently identified risks landed separately:

19. `a30afa3fc7` — authenticated edge requests must bind body `userId` to JWT `sub`;
    permission lookup uses the verified subject. Handler regressions reject impersonated ids.
20. `c4e2a33380` — Payment/Cashback refuse persisted coding lines rather than silently
    dropping them from their header-only journal. Builder and transactional tests cover both.
21. `13435e74cb` — archive failures propagate without stamping `archived`; network/auth/5xx,
    rate-limit, 404, and misleading already-paid wording preserve retry eligibility.
22. `04eb4d7216` — failed supplier/supplier-type lookups cannot masquerade as excluded rows
    or advance PO/invoice cursors. Lookup-error and successful-retry tests pin the boundary.
23. `7666cc8f61` — mapped card Drafts atomically replace their header/coding from corrected
    Ramp input under the posting lock; Posted rows remain unchanged. Real-DB tests prove
    recoding, failed-refresh rollback, and retry after failure.
24. `5bf802406c` — card post and void preallocate journal-line ids and use explicit identity
    maps for dimensions. Reordered-return tests prove projects stay on the right lines.
25. `8438ecf5e6` — foreign outbound invoices require finite positive stored FX; base currency
    alone defaults to one. Invalid rates fail and hold the cursor.
26. `e13c6ab70a` — bill payment methods, reimbursement states, and repayment funding use
    explicit supported branches. `ONE_TIME_CARD_DELIVERY` skips AP bank posting;
    `REIMBURSED_VIA_PUSH` requires settlement; manual reimbursements do not debit bank;
    only documented `ach` repayment funding is supported. Unknown values fail before writes.
27. `ef1b83f26f` — **line-magnitude risk:** Charge/Credit/Repayment reject zero, negative,
    NaN, or infinite coding-line magnitudes even if offsetting values sum to the header.
28. `21d83b81a4` — `RAMP_DRAFT_BILL_CONTRACT_VERIFIED = false` blocks outbound invoice export
    before provider/vendor/document I/O, including existing enabled installations. The gate
    has no customer override; exports remain retryable until contract proof enables it.
29. `95ad2310e0` — **webhook risk:** all challenges require a valid HMAC before callback or
    echo. Only the signed body supplies a challenge; query parameters cannot override it.
30. `80281070e1` — reimbursement reference adoption requires a unique unposted system Draft
    with matching identity, dates, currency, complete delivery/lines, coding and amounts,
    preserved valid FX, zero tax/shipping and no unrelated source provenance. Incomplete,
    mismatched, ambiguous or non-Draft reference matches fail without destructive repair.

**Verification evidence:** Each commit includes targeted regression coverage. The discriminator
suite recorded 20 red failures followed by 36 passing cases; archive recorded seven failures
followed by eight passing cases; webhook recorded five failures followed by six passing cases.
The associated full EE run passed 1,165 tests; the Jobs run passed 705 with 28 opt-in skips;
EE/Jobs and ERP scoped typechecks passed. Later gate/adoption changes have their own focused
and real-database evidence; these earlier totals are not an aggregate verdict on Task 30.
Task 10 records final branch-wide verification separately.

## Task 10: Refresh documentation and run final gates

**Depends on:** Tasks 2–9 and 11–30
**Files:**
- Modify: `.claude/rules/ramp-integration.md`
- Modify: `.claude/rules/accounting-sync-handlers.md`
- Modify: `.claude/rules/environment-configuration.md`
- Modify: `.claude/rules/sst-deployment-infrastructure.md`
- Modify: `packages/ee/AGENTS.md`
- Modify: `packages/jobs/AGENTS.md`
- Modify: `packages/locale/AGENTS.md`
- Modify: `.ai/specs/2026-08-20-ramp-transaction-sync.md`
- Modify: `.ai/specs/2026-08-28-ramp-oauth-and-production-hardening.md`

**Steps:**
1. Reconcile implemented behavior, remaining external-contract limitations, environment propagation, event subscriptions, and package exports.
2. Extract and translate any new ERP messages through `/translate`.
3. Run compatibility gates only after applying migrations; never reset the database.

**Verify:**
```bash
pnpm --filter @carbon/ee test
pnpm --filter @carbon/jobs test
pnpm --filter @carbon/auth test
pnpm exec turbo run typecheck --filter=@carbon/auth --filter=@carbon/database --filter=@carbon/ee --filter=@carbon/jobs --filter=erp
pnpm run lint
pnpm db:check:datasets
pnpm db:check:backups
git diff --check
# Expected: every command exits 0, with no missing translations or compatibility verdicts.
```

**Earlier result (before Tasks 19–30):** EE 1,157/1,157; Jobs 648/648 runnable tests (26 intentional skips across three
files); Auth 44/44; all five scoped typechecks; full lint; four dataset checks; backup
compatibility; the nine-target production build; and `git diff --check` passed. Lint and
build retained the repository's existing non-fatal diagnostics. The explicit Ramp database
suites passed separately for card staging, bill staging, payment/reimbursement staging, and
card post/void transactions. The post-refactor browser retry was blocked at the external
Cloudflare challenge; the earlier isolated run passed the Ramp settings, owned/cross-tenant
detail, and void/reversal checks.

**Out of scope:** Claiming unverified Ramp API contracts are production-verified.
