# Ramp Integration — consolidated implementation record

**Spec:** `.ai/specs/2026-09-19-ramp-integration.md`
**Branch:** `feat/feat-ramp`
**Status:** implemented (Ramp + Rillet legs live-verified; QBO VERIFY-flagged, Xero SPEND
unverified; browser/live-sandbox verification of some criteria env-gated)

This is the merged implementation record for the whole Ramp integration. It consolidates
**nine** source plans:

1. `.ai/plans/2026-08-20-ramp-transaction-sync.md` (foundational build, Tasks 1–14)
2. `.ai/plans/2026-09-10-ramp-project-coding-and-rillet-charge-sync.md` (Parts A/B/C)
3. `.ai/plans/2026-09-11-accounting-projects-crud.md` (slice 1)
4. `.ai/plans/2026-09-11-accounting-projects-dimension.md` (slice 2)
5. `.ai/plans/2026-09-11-ramp-main-sync-migration-order.md` (migration-order repair)
6. `.ai/plans/2026-09-11-ramp-nuclear-remediation.md` (Tasks 1–32)
7. `.ai/plans/2026-09-11-ramp-sync-module-extraction.md` (jobs coordinator split)
8. `.ai/plans/2026-09-12-accounting-projects-ramp.md` (slice 3, Phases 3a/3b)

The phases below are grouped by workstream, not strictly chronological. The
**migration-order** and **nuclear-remediation** reasoning is load-bearing and preserved.

---

## Phase 1 — Transaction sync (foundational build)

*Source: `2026-08-20-ramp-transaction-sync.md`.* The original end-to-end build. Note two of its
task-level decisions were later superseded by Phase 5 (nuclear remediation): the single-column
`cardTransaction` PK and the draft-bill submit path. Everything else stands.

- **Task 1 — Sandbox verification** (blocked on user creds at build time; the equivalent
  verification landed live 2026-08-28, recorded in `.ai/research/ramp-api-doc-verification.md`).
- **Task 2 — Migration**: integration registry row, journal/document enum values, `cardTransaction`
  + `cardTransactionLine` tables, `CARD-%{yyyy}-%{mm}-` sequence + seed template, RLS by invoicing
  permissions. *(PK later reconciled to composite in Phase 5, Task 5.)*
- **Task 3 — `@carbon/ee` client/models/webhook**: `RampClient` over Ramp Developer API v1,
  passthrough zod models, `verifyRampWebhookSignature` (HMAC-SHA256), `buildRampIdempotencyKey`;
  `./ramp.server` export; unit tests.
- **Task 4 — Integration config + settings wiring**: `defineIntegration`, registration in
  `integrations[]`, secret keys, settings drawer with dynamic account options.
- **Task 5 — Ramp service + hooks**: connection, CoA/cost-center push, confirm builder, supplier
  resolution; `rampOnInstall/Update/Uninstall/Healthcheck`.
- **Task 6 — `post-card-transaction` edge function** + pure golden-master journal builder
  (Charge/Credit/Payment/Cashback/Repayment) + tests; `config.toml` entry.
- **Task 7 — `ramp-sync` + `ramp-sweep`**: coordinator with per-family isolation, card/transfer/
  cashback families, hourly cron; event + trigger registration.
- **Task 8 — Bills + bill-payments inbound**: mapping/dedupe, PO-linked conversion, standalone
  invoices, card-paid-bill skip, AP payment + settlement. *(Submit/archive later superseded.)*
- **Task 9 — Reimbursements + repayments inbound**: employee-supplier invoices, Ramp-paid
  payments, cursor-driven repayments with scaled coding lines.
- **Task 10 — Outbound**: PO push and invoice draft-bill push. *(Original submit + archive-on-
  settlement superseded by Phase 5 Task 28 and the 2026-09-11 draft-only ship — see Phase 6.)*
- **Task 11 — Invoicing models/service + path helpers.**
- **Task 12 — UI**: card-transactions list/drawer/void routes, nav, purchase-invoice Ramp badge.
- **Task 13 — Rule file + Task Router.**
- **Task 14 — Browser verification** (env-gated on sandbox).

**Outcome:** full inbound/outbound skeleton in place; refined heavily by later phases.

---

## Phase 2 — Project (cost-center) round-trip + provider charge objects

*Source: `2026-09-10-ramp-project-coding-and-rillet-charge-sync.md`. Status: Parts A+B committed;
Part C Ramp + Rillet legs verified live 2026-09-10; Xero optional/unverified; QBO unverifiable.*

Context: a customer runs Ramp (card spend in) + Rillet (accounting out); card charges must carry
the project (a cost center) through to Rillet, and Rillet asked for payables synced as objects,
not journal entries.

### Part A — make the cost-center round-trip actually work (five breaks fixed)

- **A1** — pure `lib/coding.ts`: `codeSelections` matches `category_info.external_id ===
  "carbon-cost-center"` (a custom field returns `type: OTHER`, so the old native-`COST_CENTER`
  enum match never fired and silently dropped every tag). Validate cost centers via one `.in()`;
  unknown → fail the item as uncoded. Deleted the `TODO(task-1)`.
- **A2** — idempotent `pushCostCenters` converge: correct wire keys (ERP id in `id`,
  `field_id` = the field's `ramp_id`), true diff (`diffCostCenterOptions`: create/rename/hide/
  show) with fingerprinted mappings. `POST /field-options` is all-or-nothing and rejects existing
  options, which is why the old blind re-post failed on every second run.
- **A3** — `ensureCostCenterDimension` + a `ramp-cost-centers` sync step, so a new cost center
  reaches Ramp within ≤1h.
- **A4** — `post-card-transaction` refuses to post a line carrying a `costCenterId` when no active
  CostCenter dimension resolves (fail loud, never drop the tag).
- **A5** — *(later reverted)* originally pushed only Expense + card-liability accounts via a
  `codingAccountScope` setting. **Superseded 2026-09-11**: the setting was removed and every
  classifiable account is pushed VISIBLE (Ramp accepts coding to a HIDDEN account, so the scope
  only hid the accounts manufacturing bills post to). See Phase 6.
- **A6** — docs + lessons.

### Part B — sync card charges (and Rillet reimbursements) as provider objects

- **B1** — schema: `cardTransaction.supplierId` + event trigger (no subscription backfill —
  convergence owns it).
- **B2** — `resolveMerchantSupplier` resolving merchant → supplier. *(Its per-merchant
  auto-create was later replaced by the catch-all in Phase 8.)*
- **B3** — engine: new `"charge"` `AccountingEntityType` with a **per-row `DOC_BACKED` carve-out**
  (inventory-adjustment precedent) so only `Charge`/`Credit` rows become provider objects while
  Payment/Cashback/Repayment stay journal entries. Reconcile executor, outbound sweep,
  subscriptions, golden tests.
- **B4** — shared `loadCardTransactionCostingLines`.
- **B5** — Rillet `charge` adapter (create/void/receipt); `Credit` via negative items gated on a
  sandbox-verified flag, flipped on after the sandbox accepted it.
- **B6** — Rillet reimbursement object (`POST /reimbursements`); the `reimbursementRepresentation`
  setting was built then **removed on review** (the native object is the only representation);
  Rillet has no reimbursement-payment endpoint, so a Ramp-paid reimbursement parks Skipped/Warning.
- **B7** — QBO (`Purchase` `CreditCard`, VERIFY-flagged, no sandbox) + Xero (`BankTransaction`
  SPEND/RECEIVE against a CREDITCARD account) charge adapters.
- **B8** — UI Sync Activity labels + docs.

### Part C — live findings (2026-09-10)

Five real bugs found only by the live pass, all fixed + unit-tested:

1. CoA push leaked the Carbon `visible` flag into the POST body (422) → `toRampGlAccountPayload`.
2. Sync confirm sent empty lists / wrong failed-item shape (422, silent for weeks) →
   `buildSyncConfirmBody` omits empty lists + `confirmError` on step output.
3. **Void journal double-count**: the executor keyed the backing card transaction on
   `cardTransaction.journalId`, which never matches the "VOID Card Transaction" journal, so the
   void pushed as a JE on top of the charge DELETE (Rillet netted −1 charge) →
   `loadCardTransactionPolicyInputs` resolves via journal-line `documentType/documentId`.
4. Ramp bill/reimbursement inserts had no `purchaseInvoiceDelivery` row that
   `post-purchase-invoice` requires → `createPurchaseInvoiceDelivery` at both sites.
5. `reimbursementRepresentation` setting removed — always the native object.

Verified live: Hertz split charge → Rillet `POST /charges`; void → `DELETE /charges`; Delta
refund (Credit) → charge with negative items; five statement Payments → Rillet journal entries;
reimbursement → `POST /reimbursements`; payout → Warning with the "mark paid in Rillet" message.

---

## Phase 3 — Accounting Projects CRUD (slice 1)

*Source: `2026-09-11-accounting-projects-crud.md`. Tasks 1–3 done; Task 4 UI + browser verify.*

- **Task 1** — `project` table (immutable `id('prj')`, composite PK, company-unique `name`,
  optional `description`, `active`, audit; four RLS policies on `accounting_*` scopes). Regenerate
  types; `db:check:datasets`/`db:check:backups` pass.
- **Task 2** — `projectValidator` (red→green): trimmed required name, optional description.
- **Task 3** — services `getProjects` (active only) / `getProject` (incl. inactive) /
  `upsertProject` / `deleteProject` (soft `active = false`), `Project` type; MCP digest.
- **Task 4** — flat Projects CRUD routes/UI under Accounting → Configure (Payment Terms
  precedent), nav, `/translate` for 13 catalogs, `/test` create→edit→delete.

**Outcome:** company-scoped Project master with soft-delete, kept separate from Cost Centers,
superseding the CostCenter-as-"Project" practice.

---

## Phase 4 — Project dimension (slice 2)

*Source: `2026-09-11-accounting-projects-dimension.md`. Tasks 1–2 committed; Task 3 browser verify
blocked (shared-worktree dev server down).*

- **Task 1** (`4af666fd3d`) — `Project` added to `dimensionEntityType` via **two** migrations
  (enum-add, then backfill — PostgreSQL cannot consume a new enum value in the same transaction),
  plus new-company seed. ScrapReason precedent.
- **Task 2** (`89289db8bf`) — app/EE wiring: `dimensionEntityTypes` array,
  `getEntityDimensionValues` / `getEntityValuesByIds` (eager-loaded, low-cardinality),
  `DIMENSION_LABEL_SOURCES`, `DimensionEntityTypeIcon`, selector color.
- **Task 3** — typecheck/tests green; browser verify recorded blocked.

**Outcome:** `Project` is a first-class journal-line dimension; a group-level Project dimension
exists per company group.

---

## Phase 5 — Nuclear remediation (correctness + tenancy + structure)

*Source: `2026-09-11-ramp-nuclear-remediation.md`. All 32 tasks done. Load-bearing — this is where
the branch went from "works in a demo" to production-safe.* Grouped:

**Security / atomicity foundations**
- Task 1 — safe Ramp allocation via `distributeRoundingResidual` (`lib/allocation.ts`).
- Task 2 — single-use signed OAuth state sessions (`packages/auth/oauth-state.server.ts`), bound
  to integration/user/company, ten-minute cookie.
- Task 3 — atomic `upsert_company_integration_patch` RPC + `lib/state.ts`; every writer patches
  only its owned dot-paths; no read/merge/write, no whole-object Vault replacement.
- Task 4 — hardened OAuth callback: consume state before code exchange, atomic credential patch,
  stable error codes, no financial sync until mappings validate.

**Schema reconciled forward (load-bearing)**
- Task 5 — **tombstone the three branch-only backdated card-transaction migrations and recreate a
  single forward, retry-safe reconciliation** (`20260911150050`). Composite `(id, companyId)` PKs
  with `id()` (superseding Phase 1's single-column plan), tenant-composite FKs, Draft-only RLS,
  parent-locking line trigger, company-group account validation, offending-id failure on any
  branch-local cross-tenant row. Plus the lifecycle-audit CHECK (`20260911150058`).
- Task 6 — tenant-safe ERP card reads (`(companyId, id)`, group-scoped account labels, fail-closed
  loaders).
- Task 7 — transactional, idempotent post/void: lock the header first, one Kysely transaction,
  repeat-safe, real two-connection serialization proof.

**Inbound/outbound correctness**
- Task 8 — validate Ramp monetary payloads (`money.ts`): minor-unit object shapes + the deprecated
  major-unit card fallback, never default currency precision or FX; centralized family/entity
  policy (`ramp-sync-policy.ts`).
- Task 9 — stable `(updatedAt, id)` keyset cursors (`ramp-sync-cursor.ts`); resumable payments +
  reimbursements (`ramp-sync-payment.ts`, `ramp-sync-reimbursement.ts`) with FX snapshots and
  observed-Posted confirmation.

**Structure (size gate)**
- Task 11 — split the jobs coordinator into `ramp-sync-{shared,card,bill,reimbursement-family,
  repayment,outbound}.ts`, keeping the durable Inngest contract unchanged.
- Task 12 — split the service into `connection/chart-of-accounts/cost-centers/suppliers/spend/
  sync-confirmation/webhooks.ts` behind the `service.ts` facade.

**Follow-up nuclear-review hardening (Tasks 13–18)**
- 13 (`01e0fec3c5`) atomic card ingestion (advisory lock, resume, observed Posted);
  14 (`7b7f561247`) edge permission + period + scoped fault trigger;
  15 (`7b29e22ca7`) paginate outbound document-line reads beyond 1,000;
  16 (`aa95b5ff84`) atomic bill staging + exact single-PO provenance + one-Draft legacy adoption;
  17 (`432b3b28cb`) surface family drain/confirm failures (no false success);
  18 (`30e5f1f81d`) retry-safe provider charge create/void.

**Final nuclear-review corrections (Tasks 19–32)** — ten Must Fixes + two risks:
- 19 (`a30afa3fc7`) bind edge `userId` to JWT `sub`;
  20 (`c4e2a33380`) Payment/Cashback reject coding lines;
  21 (`13435e74cb`) failed bill archival stays retryable;
  22 (`04eb4d7216`) hold cursors on supplier lookup errors;
  23 (`7666cc8f61`) refresh mapped card Drafts from corrected Ramp input;
  24 (`5bf802406c`) bind dimensions to preallocated journal-line ids;
  25 (`8438ecf5e6`) require authoritative outbound invoice FX;
  26 (`e13c6ab70a`) fail closed on unsupported financial discriminators
  (`ONE_TIME_CARD_DELIVERY` skips AP posting, `REIMBURSED_VIA_PUSH` requires settlement, only
  `ach` repayment funding);
  27 (`ef1b83f26f`) reject invalid card coding-line magnitudes;
  28 (`21d83b81a4`) release-gate unverified draft-bill export
  (`RAMP_DRAFT_BILL_CONTRACT_VERIFIED = false` — **later removed when the contract shipped**, see
  Phase 6);
  29 (`95ad2310e0`) authenticate every webhook challenge;
  30 (`80281070e1`) constrain legacy reimbursement adoption;
  31 (`7c0555d90c`) batch outbound PO/vendor prerequisites;
  32 (`86aa49b217`) bounded archive-on-settlement status reads.
- Task 10 — refresh all rules/AGENTS.md/specs and run final branch gates (EE 1,157/1,157;
  Jobs 648 runnable; Auth 44/44; five scoped typechecks; lint; dataset + backup checks; build).

---

## Phase 6 — Migration-order reconciliation + draft-bill ship

*Source: `2026-09-11-ramp-main-sync-migration-order.md` (done). Load-bearing.*

Merge `origin/main` into the published Ramp branch without losing local work, then ensure every
effect-bearing Ramp migration is forward-dated after main's latest migration:

- Preserve the dirty card-transaction route + untracked run records.
- Merge `origin/main` (no commit) and resolve the five predicted conflicts.
- **Tombstone the three applied effect-bearing migrations and recreate their bodies in fresh
  ordered migrations** — schema reconciliation, integration-patch RPC, lifecycle CHECK — so a
  clean checkout applies them after main's Returns work rather than before it.
- Apply, regenerate artifacts, run `db:check:datasets` + `db:check:backups --stage`, scoped
  typechecks, lint, focused Ramp tests. Backup manifest stages the combined Returns + Ramp schema;
  branch is zero commits behind `origin/main`.

Draft-bill push then **shipped as draft-only** (live-verified 2026-09-11,
`.ai/runs/2026-09-11-ramp-draft-bill-push-verification.md`): the
`RAMP_DRAFT_BILL_CONTRACT_VERIFIED` gate was removed; Carbon pushes a coded provisional draft with
`remote_id: invoice.id` and hands off — it never submits (`400 BILL_PAY_7145` needs per-vendor
bill-pay config) and there is no archive-on-settlement (a draft has no delete endpoint, `405`).
The `codingAccountScope` setting from Phase 2/A5 was also removed here (every classifiable account
pushed VISIBLE).

---

## Phase 7 — Sync-module extraction (characterization-safe refactor)

*Source: `2026-09-11-ramp-sync-module-extraction.md`. Done.*

Establish a green characterization baseline, then extract shared context/monetary/tenancy/link/
attachment helpers, the card/transfer/cashback families, bill creation/payment + reimbursement
families, and repayment + outbound (incl. cursor advancement) into named modules — reducing
`ramp-sync.ts` to the unchanged Inngest contract plus thin `step.run` orchestration under 1,000
lines. Verified with focused/full Jobs tests, the real-DB integration test, Jobs+EE typechecks,
focused Biome, and `git diff --check`. *(Overlaps Phase 5 Task 11; recorded separately because it
ran as its own characterization-first pass.)*

---

## Phase 8 — Ramp project slice (slice 3) + merchant modeling

### Slice 3 — Ramp project field + inbound round-trip

*Source: `2026-09-12-accounting-projects-ramp.md`. Status: COMPLETE.*

**Phase 3a — outbound field sync + coding** (`76e7627671`): `lib/projects.ts` cloned from
`cost-centers.ts` (`RAMP_PROJECT_FIELD_ID = "carbon-project"`, `diffProjectOptions`,
`ensureProjectField`, `ensureProjectDimension` (finds the slice-2 dimension), `pushProjects`),
new `externalIntegrationMapping` entityTypes `"project"` / `"projectField"`, active-only desired
set; `coding.ts` encode/decode for `projectId`; orchestration in `convergeRamp`, a `ramp-projects`
sync step, and `pushInvoiceDraftBill` emitting the project selection. Cost Center convergence left
unchanged (parallel field, own id).

**Phase 3b — inbound persistence** (schema `1a22855b5b`, code `3dd5f63e30`, docs `83fa47f9de`):
nullable `projectId` (tenant-composite FK) on `cardTransactionLine` + `purchaseInvoiceLine`;
staging threads the picked project (`ramp-sync-card.ts`, `-shared.ts` `verifyProjects`,
`-card-stage.ts`, bill/reimbursement staging); `post-card-transaction` (+ void) and
`post-purchase-invoice` write a Project `journalLineDimension` per line. *(Ask-First class — new
custom Ramp field round-tripping as a dimension, touching sensitive posting edge functions —
confirmed before 3b.)* Verified: erp/ee/jobs/database typecheck clean; ee 1170 + jobs 694 tests
pass; zero deno-check errors in edited edge files. Live Ramp-sandbox round-trip verification NOT
done (needs a running stack + sandbox creds).

### Merchant modeling — the "Card Merchant" catch-all

*Source: `2026-09-17-ramp-card-merchant-modeling.md`. All 6 tasks done.*

- **Task 1** — rewrite `resolveMerchantSupplier` to **match-or-catch-all**: mapping-first →
  exact-name match to an existing supplier (link it) → single `"Card Merchant"` house supplier per
  company (`resolveCardMerchantCatchAllSupplier`, no per-merchant mapping written on the
  fallback). The per-merchant auto-create path is removed; `resolveRampSupplier` keeps its
  auto-create for the `vendor` path.
- **Task 2** — unit tests for the resolution order (mapping hit / name match + link / catch-all
  create / catch-all reuse / name escaping).
- **Task 3** — carry `merchantName` on the provider charge line description in all three adapters:
  `charge.merchantName ?? line.description ?? charge.memo` (merchant identity now rides here, since
  all card spend shares the catch-all vendor).
- **Task 4** — charge adapter tests assert merchant-in-description + the fallback chain.
- **Task 5** — scoped `@carbon/ee` typecheck + full suite green (live Rillet-sandbox acceptance is
  env-gated, flagged as a manual follow-up).
- **Task 6** — docs/rules sync.

**Outcome:** at most one `"Card Merchant"` supplier per company; the vendor-master pollution is
gone; a per-merchant "Merchant" GL dimension is a deferred follow-up.

---

## Consolidated status

- **Shipped + live-verified:** OAuth Connect; card/transfer/cashback/bill/bill-payment/
  reimbursement/repayment inbound; PO push; draft-bill push (draft-only); cost-center + project
  round-trip; Rillet charge + reimbursement objects; merchant catch-all; forward-reconciled schema;
  atomic state + posting.
- **VERIFY-flagged / unverified:** QBO charge adapter (no sandbox); Xero SPEND/RECEIVE; exact
  webhook signing/challenge contract; repayment funding beyond `ach`; some browser/round-trip
  criteria (env-gated on a running stack + Ramp sandbox creds).
- **Deferred follow-ups:** multi-entity outbound guard; unmapped-PO `external_id` pre-match + true
  PO-number collision error; Rillet reimbursement payments (blocked on Rillet's API); historical
  `supplierId` backfill; per-merchant "Merchant" dimension; Payment-type transfers as QBO
  `CreditCardPayment` / Xero `BankTransfers`; user-facing `docs/`.
