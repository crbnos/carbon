# Plan: Inbound Payment Sync-Back — AP Bill Payments Across QBO, Xero, Rillet (v2 Phase F)

> Spec: [.ai/specs/2026-07-09-accounting-sync-engine.md](../specs/2026-07-09-accounting-sync-engine.md) §Phase F
> Complements: [.ai/specs/2026-08-02-accounting-sync-engine-v3.md](../specs/2026-08-02-accounting-sync-engine-v3.md) §2 (outbound payment journals)
> Date: 2026-08-05
> Status: Phases 0-3 ✅ implemented + green (uncommitted); Phase 4 in progress (gate + rule done; settings note, review-finding fixes (Task 4.4), sandbox acceptance remain)

## Progress
- **Phase 0** (family-agnostic core, GL via post-payment) — ✅ done, green
- **Phase 1** (Rillet AP `/bill-payments`) — ✅ done, green
- **Phase 2** (QBO `Payment`+`BillPayment` via CDC + `webhook.quickbooks.$companyId.ts`) — ✅ done, green
- **Phase 3** (Xero `/Payments` `listChanges` + Invoice-update webhook) — ✅ done, green
- **Phase 4**: `isPaymentSyncbackEnabled` documents-mode gate ✅; `.claude/rules/accounting-sync-handlers.md` refreshed ✅; per-provider sandbox live-fire ⬜ (env-gated)
- Final combined gate (2026-08-05): `@carbon/ee` typecheck ✅, **456 tests ✅**, `erp` typecheck ✅
- **Settings UI toggle (was Task 4.1) — DROPPED as unnecessary.** The gate derives purely from the existing `families.{ar,ap}` mode (`documents` → pull-back on), so payment sync-back rides the v3 posting-sync family setting; no separate toggle. ⚠ Design note for veto: this couples "AR/AP in documents mode" to "pull payments back" — a shop that syncs documents but reconciles payments manually in Carbon cannot opt out without a separate `paymentSyncback` flag (small add if wanted).
- Not committed. Sandbox live-fire + the Rillet-AR-GL behavior-change check are env-gated (need a stack + provider sandbox creds).

## Goal

A vendor bill marked paid in the external accounting system must flow back into
Carbon and close the `purchaseInvoice` — for **all three** providers. Today
inbound payment sync-back is Rillet-only and AR-only. Deliver AP bill payments
everywhere, and (folded in for free, since QBO/Xero have no payment syncer at
all) AR for QBO/Xero, on **one family-agnostic core**.

**No schema change.** Reuses `payment` + `invoiceSettlement`,
`externalIntegrationMapping(entityType='payment')`, and the
`companyIntegration.metadata.settings` blob.

## Design invariants (from the spec — do not drift)

1. Pull sweep (`listChanges`) is the correctness **guarantee** for every provider;
   webhooks are accelerators only where first-class. Webhook + sweep collapse via
   the **live-operation unique index** (same composite entityId) + the 60s
   cooldown + the `postAction:'none'` already-Posted guard — NOT via
   `idempotencyKey`, whose scopes differ per path (`event.id` vs
   `pull:<updatedAt>`). *(Wording corrected 2026-08-05 review.)*
2. Pulled payments **post to Carbon's GL** via the native `post-payment` edge
   function (Draft → `{type:'post'}`). Double-count in the *provider* GL is
   avoided by the documents-mode `Payment` outbound-push exclusion (DOC_BACKED),
   not by skipping the GL. Carbon's GL/AP subledger stay tied out.
3. Inbound pull is **gated on `families.{ar,ap}='documents'`** (the default).
   In `journals`/`none` mode nothing is pulled (Carbon owns / handles outside).
4. Family derives from the settled **document** (invoice → AR/Receipt/salesInvoice;
   bill → AP/Disbursement/purchaseInvoice), not from any per-payment flag.
5. Ownership skip: a payment on an unmapped document, or a Carbon-owned payment,
   is silently skipped by `shouldSync` — never an error, never a ledger row.
6. Behavior parity: the Rillet AR path must be **byte-identical** after the core
   refactor, proven by a test, before any AP code is added.

## Reference implementation

`packages/ee/src/accounting/providers/rillet/entities/payment.ts`
(`RilletPaymentSyncer`) is the only existing payment syncer. Its `upsertLocal`
(AR write: `payment` Receipt + `invoiceSettlement` targetSalesInvoiceId +
`salesInvoice` status; FAILED void) is the template for the shared core. Its
composite id (`getRilletPaymentSyncEntityId(invoiceRemoteId, paymentId)`) and
`shouldSync` ownership skip are the templates for F.3/F.5.

Native AP model (mirror target): `payment{paymentType:'Disbursement', supplierId}`
+ `invoiceSettlement{targetPurchaseInvoiceId}` + `purchaseInvoice` status
(`20260630093809_ar-ap-payments.sql`; posting reference —
`packages/database/supabase/functions/post-payment/index.ts`, `cashIn` branch).

---

## Phase 0 — Family-agnostic core (`PaymentSyncerBase` + GL via `post-payment`) — ✅ DONE (2026-08-05, uncommitted)

**Landed:** `core/payment-application.ts` (`NormalizedPayment`, `upsertLocalPaymentDraft`),
`core/payment-syncer.ts` (`PaymentSyncerBase`), Rillet `entities/payment.ts` refactored onto
the base. `pnpm exec turbo typecheck --filter=@carbon/ee` green; `pnpm --filter @carbon/ee test`
397 pass (+8). The core **already supports AP** (`family:'ap'` → Disbursement/supplierId/
targetPurchaseInvoiceId) and multi-document fan-out — Phases 1-3 only supply provider mappers.

**Resolved design points (build on these):**
- **`postAction`** returned by `upsertLocalPaymentDraft`: settled→`post`; settled-but-already-Posted→
  `none` (idempotent, no double-GL); failed/void-on-Posted→`void`; else `none`/throw. The base
  drains it post-commit and calls `post-payment` accordingly.
- **`post-payment` reuse** via lazy `await import("@carbon/auth/client.server")` `getCarbonServiceRole()`
  (top-level import triggers env validation at module load — breaks tests). Body
  `{ type, paymentId, userId, companyId }`.
- **Document status is VIEW-derived** (`salesInvoices`/`purchaseInvoices` views from Posted-payment
  settlements) — `post-payment` doesn't write `salesInvoice.status` directly; `getSettledInvoiceStatus`
  kept only for tests.
- **⚠ Precondition / behavior change to verify in sandbox (env-gated):** `post-payment {type:'post'}`
  requires the invoice in `Submitted` status; failure surfaces as a `SyncResult` `error` (base has no
  `Warning` — that's the `accountingSyncOperation` layer). Shipped **Rillet AR now posts a Carbon GL
  journal** (previously `journalId:NULL`) and flips invoice status with triggers ENABLED (like a user
  post) — intended, but a real change to live Rillet AR behavior; confirm on the Rillet sandbox.
- `mapToLocal` is identity (TLocal=TRemote); normalization happens in `upsertLocal` via
  `mapToNormalized(remote, remoteId)` because the base doesn't pass the composite id to `mapToLocal`.

### (original Phase 0 task detail follows, for reference)

> Design change (2026-08-05): pulled payments now **post to Carbon's GL** by
> reusing the native `post-payment` edge fn, not by hand-writing rows with
> `journalId: NULL`. The write is two-step: Draft `payment`+`invoiceSettlement`
> in the base pull tx, then `post-payment {type:'post'}` after commit. This
> changes shipped Rillet AR behavior (AR now gets a GL journal) — intentional.
> `post-payment` signature: `{ type:'post'|'void', paymentId, userId, companyId }`
> (`packages/database/supabase/functions/post-payment/index.ts`; posts only when
> `companySettings.accountingEnabled`, sets `payment.journalId`, updates document
> status). `cashIn = paymentType==='Receipt'`, `isAR = customerId != null`.

### Task 0.1 — `core/payment-application.ts` (Draft write, family-agnostic)
- **New file**. Define `NormalizedPayment = { family:'ar'|'ap', documentRemoteId,
  paymentRemoteId, amount, currencyCode, exchangeRate, paidDate, reference,
  status:'settled'|'failed'|'void', linkedDocuments?: {remoteId, amount}[] }`
  (`linkedDocuments` for multi-document provider payments; single-doc uses
  `documentRemoteId`/`amount`).
- `upsertLocalPaymentDraft(tx, ctx, normalized)`: resolve each linked document via
  `mappingService.getEntityId(provider, docRemoteId, family==='ar'?'invoice':'bill')`
  → the Carbon `salesInvoice`/`purchaseInvoice`; drop unmapped (ownership skip).
  Party = `salesInvoice.customerId` / `purchaseInvoice.supplierId`. Idempotent by
  the `payment` mapping (composite id): update-or-insert one **Draft** `payment`
  (`paymentType` by family, `bankAccount` from `accountDefault.bankCashAccount`,
  `reference`, `get_next_sequence('payment', companyId)`), replace its
  `invoiceSettlement` rows (one per mapped document, `targetSalesInvoiceId` |
  `targetPurchaseInvoiceId`), and `link` the payment mapping. Returns the
  `payment` row id.
- **Verify:** `pnpm exec turbo run typecheck --filter=@carbon/ee`.

### Task 0.2 — `PaymentSyncerBase` (pull-flow override + post-payment)
- **New file** `core/payment-syncer.ts`: abstract `PaymentSyncerBase` extends
  `BaseEntitySyncer`, pull-only (push stubs throw). Concrete providers implement
  `mapToNormalized(remote, entityId) → NormalizedPayment` + `fetchRemote`/batch.
- Override `pullFromAccounting`/`pullBatchFromAccounting`: run the base upsert
  (which calls `upsertLocalPaymentDraft` via `upsertLocal`), then **after the tx**
  invoke `post-payment` through a service-role supabase client
  (`getCarbonServiceRole().functions.invoke('post-payment', { body })`):
  `{type:'post'}` for `settled`, `{type:'void'}` for `failed`/`void`. Map a
  `post-payment` error to the operation's `Failed`/`Warning` (period lock →
  Warning). `userId` = the syncer's default-user resolution (moved from Rillet).
- Move `getDefaultUser`, `getBankCashAccount` here (shared).
- **Verify:** typecheck; unit test the post-payment invocation (mock the client)
  — settled → `{type:'post'}`, failed → `{type:'void'}`.

### Task 0.3 — Refactor `RilletPaymentSyncer` onto `PaymentSyncerBase`
- Reduce `RilletPaymentSyncer` to: `mapToNormalized` (family `'ar'`, from
  `mapRilletPaymentToLocal`), `fetchRemote`/batch (unchanged), the composite-id
  helpers, and `shouldSync` (ownership skip + new `isPaymentSyncbackEnabled`).
  Delete the hand-written `upsertLocal` status logic (now the base + post-payment).
- **Verify (gate for the whole plan):** behavior-*change* test — a fixture Rillet
  `InvoicePayment` now produces Draft `payment` + `invoiceSettlement` **and** a
  `post-payment {type:'post'}` call; document-status outcome unchanged. Assert no
  `journalId: NULL` write remains. Existing Rillet mapper/webhook tests stay
  green. `pnpm --filter @carbon/ee test`.

### Task 0.4 — Gating helper — SUPERSEDED (as-built: families-only)
- ~~Separate `paymentSyncback:{ar,ap}` flag~~ **DROPPED** (see Progress note). As built:
  `isPaymentSyncbackEnabled(metadata, family)` in `core/posting.ts` returns
  `resolvePostingSyncSettings(metadata).families[family] === 'documents'` — no
  extra flag, no settings shim. The `families` mode is the only switch.
- **Verify:** covered by existing tests (documents-mode on, journals-mode off).

---

## Phase 1 — Rillet AP (extend the existing syncer)

### Task 1.1 — Bill-payment listing in `listChanges` — **VERIFY**
- In `providers/rillet/provider.ts`: add `listBillPaymentsUpdatedSince(since)` →
  `GET /bill-payments?updated.gt=...&sort_by=updated` (mirror
  `listInvoicePaymentsUpdatedSince`). **VERIFY** against the live OpenAPI that
  `/bill-payments` exposes `updated.gt`; if not, fall back to polling
  `list-all-bills` and diffing open balance (note the degradation in a `log`).
- Extend `RilletProvider.listChanges` to emit `payment` `ProviderChange`s for
  bill payments with `remoteId = <billRemoteId>:<billPaymentRemoteId>` and
  `dependsOnMapping` on the bill (`entityType:'bill'`).
- **Verify:** provider unit test over a fixture `/bill-payments` page →
  `ProviderChange[]` with composite ids + bill dependency.

### Task 1.2 — AP path in the Rillet payment syncer
- Generalize `getRilletPaymentSyncEntityId`/`parseRilletPaymentSyncEntityId` to
  carry a family/document-kind discriminator (or branch on mapping `entityType`).
- `fetchRemote`: parse composite → for AP, `GET /bills/{billId}/payments` (or
  `retrieve-a-bill-payment`); map → `NormalizedPayment` family `'ap'`.
- `shouldSync`: reuse the ownership skip, keyed on the **bill** mapping; add the
  `isPaymentSyncbackEnabled(config,'ap')` gate.
- Register nothing new — `payment` already in `rilletSyncerRegistry`.
- **Verify:** unit tests — AP mapper (full/partial/void), unmapped-bill skip,
  journals-mode gate off. `pnpm --filter @carbon/ee test`.

### Task 1.3 — Webhook accelerator (optional) — **VERIFY**
- **VERIFY** whether Rillet emits `bill`/`bill-updated` (or a bill-payment event)
  on payment. If yes: extend `apps/erp/app/routes/api+/webhook.rillet.$companyId.ts`
  to accept it and enqueue the same composite-id `payment` op (poll remains the
  guarantee). If no: poll-only for Rillet AP; leave the webhook untouched and
  note it in the spec's F.2 VERIFY row.
- **Verify:** webhook signature/branch unit test if wired; otherwise a `log` line
  documenting poll-only.

### Task 1.4 — Rillet AP sandbox live-fire (env-gated)
- Sandbox: push a bill, mark it paid, run the sweep → assert Carbon `payment`
  (Disbursement) + `invoiceSettlement` (targetPurchaseInvoiceId) + `purchaseInvoice`
  Paid. Gated on sandbox creds (loop-proof: flag if unavailable, don't fake it).

---

## Phase 2 — QBO payments (first QBO payment syncer; AR + AP)

### Task 2.1 — `QboPaymentSyncer`
- **New file** `providers/quickbooks-online/entities/payment.ts`, pull-only
  (`BaseEntitySyncer<QboLocalPayment, Qbo.Payment|Qbo.BillPayment, never>`).
- `mapToNormalized`: `BillPayment` → family `'ap'` (`VendorRef`, `TotalAmt`,
  `Line[].LinkedTxn{TxnType:'Bill', TxnId}` → one or many bill documents);
  `Payment` → family `'ar'` (customer, linked Invoice). Multi-document → fan out
  in `upsertLocalPayment` to N settlements over mapped documents only.
- `fetchRemote`: `SELECT * FROM BillPayment WHERE Id = ...` / `Payment` via the
  QBO query client; `getRemoteUpdatedAt` from `MetaData.LastUpdatedTime`.
- `shouldSync`: ownership + mapping skip on the linked document(s) +
  `isPaymentSyncbackEnabled` gate (per family).
- Composite id `<documentRemoteId>:<paymentRemoteId>` (documentRemoteId = the
  first/only linked Bill or Invoice; multi-bill payments key on the payment id
  with per-document settlement resolution inside the mapper).

### Task 2.2 — CDC pull for payments
- In `providers/quickbooks-online/provider.ts`: add `Payment` and `BillPayment`
  to `QBO_CDC_ENTITY_TYPES` (~L908). Confirm `listChanges` (~L865) emits them as
  `payment` `ProviderChange`s with the composite id + document dependency.
- **VERIFY:** CDC returns `BillPayment` deltas in the sandbox (research says yes;
  confirm the 29-day clamp still applies).

### Task 2.3 — Register `payment` for QBO
- `providers/quickbooks-online/index.ts` (~L47): register
  `payment: QboPaymentSyncer`; force pull-only in the QBO sync-config
  (`direction:'pull-from-accounting'`, `owner:'accounting'`, `enabled`), mirroring
  the Rillet `RILLET_PULL_ONLY_ENTITIES` mechanism.
- **Verify:** `SyncFactory.getSyncer({provider:'quickbooks-online', entityType:'payment'})`
  resolves in a unit test.

### Task 2.4 — QBO webhook route (committed — Brad, 2026-08-05)
- QBO supports direct `BillPayment`/`Payment` webhooks; there is **no QBO webhook
  route today**. Build `apps/erp/app/routes/api+/webhook.quickbooks.$companyId.ts`:
  - Verify the Intuit webhook signature — `intuit-signature` header = base64
    HMAC-SHA256 of the raw body with the app's **verifier token** (store per
    company alongside the QBO OAuth credentials in `providerMetadata`, or an env
    verifier token; mirror the Rillet webhook-token pattern).
  - Parse the `eventNotifications[].dataChangeEvent.entities[]` payload
    (`name`, `id`, `operation`, `lastUpdated`); it is **notification-only** — no
    object body, so enqueue a sync op whose `fetchRemote` pulls the entity.
  - For each `name in {Payment, BillPayment}`, resolve the linked document
    (query the entity to get the invoice/bill remote id — or defer to the
    syncer's fetchRemote) and enqueue a `payment` op with the composite id via
    `trigger('sync-external-accounting', { syncType:'webhook',
    syncDirection:'pull-from-accounting', entities:[...] })`. Mirror the Rillet
    webhook route shape (`webhook.rillet.$companyId.ts`).
  - CORS `OPTIONS`, `loader` health-check (mirror Rillet route). CDC (2.2)
    remains the correctness backstop; ledger idempotency dedupes webhook+CDC.
- **Config.toml / registration:** none (it's an ERP resource route, not an edge
  function). Add the QBO webhook URL to the QBO integration setup instructions.
- **Verify:** signature unit test (known token + body → expected header);
  payload-parse → enqueued composite-id ops; `Payment`+`BillPayment` handled,
  other entities acked-and-ignored.

### Task 2.5 — QBO unit tests + sandbox gate (env-gated)
- Mapper tests (Payment AR, BillPayment AP single + multi-bill, void), registry
  resolution, CDC `listChanges`. Sandbox live-fire gated on Intuit creds.

---

## Phase 3 — Xero payments (first Xero payment syncer + first Xero pull sweep; AR + AP)

### Task 3.1 — `XeroPaymentSyncer`
- **New file** `providers/xero/entities/payment.ts`, pull-only. Map a Xero
  `Payment` (on an `Invoice` of `Type` `ACCPAY`→AP / `ACCREC`→AR;
  `PaymentType` `ACCPAYPAYMENT`/`ACCRECPAYMENT`) → `NormalizedPayment`.
  `documentRemoteId` = the payment's `Invoice.InvoiceID`; `getRemoteUpdatedAt`
  from `UpdatedDateUTC`.
- `shouldSync`: ownership/mapping skip on the invoice + `isPaymentSyncbackEnabled`.

### Task 3.2 — Give `XeroProvider` `SupportsIncrementalPull`
- Xero has **no `listChanges` today** (inbound was webhook-only). Implement
  `listChanges({since})` in `providers/xero/provider.ts`: `GET /Payments` with
  `If-Modified-Since: <since>` (whole-second UTC) + `where=Status=="AUTHORISED"`;
  emit `payment` `ProviderChange`s (both families) with composite ids +
  invoice dependency. Declare `pullLookbackDays` if needed.
- **VERIFY:** `If-Modified-Since` on `/Payments` returns AP + AR payments in the
  sandbox; confirm the `where`/type fields.
- This makes Xero participate in `accounting-pull-sweep` for the first time —
  confirm the cron includes Xero once `SupportsIncrementalPull` is present.

### Task 3.3 — Register `payment` for Xero + sync-config
- `providers/xero/index.ts` (~L49): register `payment: XeroPaymentSyncer`,
  force pull-only/owner accounting/enabled in the Xero sync-config.

### Task 3.4 — Invoice-update webhook accelerator
- Xero has no payment webhook, but paying an ACCPAY bill fires an **Invoice**
  update event. Extend the existing Xero inbound webhook route: on an Invoice
  update, fetch the invoice, and for each entry in `Payments[]` enqueue the same
  composite-id `payment` op (poll from 3.2 remains the guarantee; ledger
  idempotency dedupes).
- **Verify:** unit test the Invoice-update → payment-op fan-out.

### Task 3.5 — Xero unit tests + sandbox gate (env-gated)
- Mapper tests (ACCPAY AP, ACCREC AR, partial, void), `listChanges` over a
  fixture `/Payments` page, webhook fan-out. Sandbox live-fire gated on Xero creds.

---

## Phase 4 — Settings UI, docs, acceptance sweep

### Task 4.1 — Settings surface — REDUCED (toggle dropped)
- No `paymentSyncback` toggle (dropped — families-only gate, Task 0.4). Remaining
  UI work: on the families setting in `x+/settings+/integrations.$id.tsx`, note
  that `documents` mode also pulls provider payments back into Carbon (closes
  invoices/bills + posts GL), so the coupling flagged in the Progress note is
  visible to the operator.
- **Verify:** scoped ERP typecheck.

### Task 4.2 — Rule + docs refresh
- Update `.claude/rules/accounting-sync-handlers.md` (already stale): document
  the payment syncers for all three providers, the family-agnostic core, the
  pull-vs-webhook table, and the `documents`-mode gate. Remove any "Rillet is
  the only payment syncer" / "AR-only" claims.
- Curated docs: if AP payment write-back is user-facing, update the accounting
  integration page (carbon-docs skill), grounded in source.

### Task 4.3 — Full acceptance sweep
- Run the Phase F acceptance criteria from the spec across all three sandboxes
  (env-gated). Behavior-parity (0.3), AP close per provider, multi-bill fan-out,
  ownership skip, void reopen, journals-mode no-pull.
- Gates: `pnpm exec turbo run typecheck --filter=@carbon/ee`,
  `pnpm --filter @carbon/ee test`, `pnpm run lint`, `pnpm run generate:types`
  (no schema change expected — confirm the diff is empty).

### Task 4.4 — Review findings (2026-08-05): void-detection gaps + FX guard + enablement
- **Xero DELETED poll leg (required):** `XeroProvider.listChanges` currently filters
  `where=Status=="AUTHORISED"`, so a payment deleted in Xero is never seen — and the
  Invoice-update accelerator can't see it either (a deleted payment is absent from the
  refetched `Payments[]`). Add a second poll leg for `Status=="DELETED"` (or drop the
  filter); `mapToNormalized` already maps `DELETED → 'void'`.
- **QBO deleted-stub tombstone (required):** CDC `Deleted` stubs for `Payment`/`BillPayment`
  are currently logged-and-skipped by the sweep, and a refetch 404s. Map them to a tombstone
  `NormalizedPayment{status:'void'}` (voided-but-existing payments already arrive as
  `TotalAmt === 0`).
- **Rillet FX guard:** `mapToNormalized` hardcodes `exchangeRate: 1`; park payments whose
  currency ≠ company base currency as `Warning` instead of posting at 1.0.
- **Enablement check:** confirm the QBO and Xero registries force-enable the pull-only
  `payment` entity the way `RILLET_PULL_ONLY_ENTITIES` does (else the feature is dark via
  `DEFAULT_SYNC_CONFIG.payment.enabled: false` despite the families gate defaulting on).
- **Spec alignment:** the void acceptance criterion changed — settlements are **retained** on
  void (views reopen the document); assert that, not settlement deletion.
- **Verify:** unit tests — Xero DELETED page → void ops; QBO Deleted stub → tombstone void;
  Rillet FX payment → Warning/skip; registry force-enable assertions.

---

## Task → file quick index

| Task | Primary files |
|---|---|
| 0.1–0.2 | `packages/ee/src/accounting/core/payment-application.ts` (NEW) |
| 0.3 | `providers/rillet/entities/payment.ts` |
| 0.4 / 4.1 | `core/models.ts` (settings shim), `x+/settings+/integrations.$id.tsx` |
| 1.1–1.3 | `providers/rillet/provider.ts`, `providers/rillet/entities/payment.ts`, `api+/webhook.rillet.$companyId.ts` |
| 2.1–2.4 | `providers/quickbooks-online/{entities/payment.ts (NEW), provider.ts, index.ts}`, `api+/webhook.quickbooks.$companyId.ts` (NEW, stretch) |
| 3.1–3.4 | `providers/xero/{entities/payment.ts (NEW), provider.ts, index.ts}`, Xero inbound webhook route |
| shared | `core/types.ts` (IEntitySyncer/SupportsIncrementalPull), `core/external-mapping.ts`, orchestration `packages/jobs/.../accounting-pull-sweep.ts` |

## Open VERIFY gates (carry into implementation; env-gated, never faked)

1. Rillet `/bill-payments` exposes `updated.gt` (else poll `list-all-bills` +
   balance diff) — Task 1.1.
2. Rillet emits a `bill`/bill-payment webhook on payment — Task 1.3 (poll-only if not).
3. QBO CDC returns `BillPayment` deltas (29-day clamp) — Task 2.2.
4. Xero `/Payments` honors `If-Modified-Since` for AP+AR; ACCPAY Invoice-update
   webhook fires on bill payment — Tasks 3.2/3.4.

## Risks

| Risk | Mitigation |
|---|---|
| Core refactor regresses shipped Rillet AR | Behavior-parity test is the gate before any AP code (0.3) |
| Double-count in the provider GL from the pulled payment's Carbon journal | *(Corrected 2026-08-05 review — the old `journalId:NULL` / no-post-payment mitigation was superseded by design.)* The payment journal IS posted to Carbon's GL via `post-payment`; the provider is protected by the documents-mode `Payment` DOC_BACKED outbound-push exclusion + the AR/AP control-account safety net (invariant 2) |
| Inbound sweep re-imports a Carbon-owned payment | `documents`-mode gate + owner/mapping `shouldSync` skip (invariant 5) |
| Multi-bill QBO BillPayment mis-splits | One `payment` + N `invoiceSettlement` over **mapped** docs only; unit test |
| Xero joining the pull sweep destabilizes existing Xero sync | `listChanges` scoped to `payment` only; ledger idempotency; sandbox gate |
| Provider API assumptions wrong | Four VERIFY gates above resolved in-sandbox before wiring each provider |
