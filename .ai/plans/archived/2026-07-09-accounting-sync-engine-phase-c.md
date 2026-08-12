# Accounting Sync Engine v2 — Phase C (QuickBooks Online) — implementation plan

**Spec:** .ai/specs/implemented/2026-07-09-accounting-sync-engine.md (Phase C)
**Research:** .ai/research/quickbooks-accounting-sync-engine.md
**Branch:** feat/quickbooks-enterprise (worktree /Users/barbinbrad/Code/carbon-feat-quickbooks-enterprise)

**Prerequisite:** Phase A+B plan complete (.ai/plans/archived/2026-07-09-accounting-sync-engine-phase-ab.md)
— the operations ledger (Task 5), account-mapping service (Task 8), and JournalEntrySyncer
patterns (Task 9) are consumed here. Do not start this plan before those tasks are checked off.

**Naming note (fixed for the whole plan):** the integration **id stays `quickbooks`** (the
existing stub in `packages/ee/src/quickbooks/config.tsx` — changing the id would orphan any
`companyIntegration` rows). The provider code lives at
`packages/ee/src/accounting/providers/quickbooks-online/` and the display name becomes
"QuickBooks Online". `externalIntegrationMapping.integration` = `'quickbooks'`.

## Progress
- [x] Task C1: Provider-keyed SyncFactory registry — `SyncFactory.register(providerId, registry)` in core/sync.ts (no provider imports left there); xero barrel exports `xeroSyncerRegistry` (9 entity types incl. Phase B `journalEntry`) and registers at module scope, no import cycle. Tests colocated at core/sync-factory.test.ts per repo convention (not `__tests__/`). 116 ee tests green (110 baseline + 6 new); ee + jobs typecheck exit 0.
- [x] Task C2: QBO env + OAuth connect flow — env pre-check: QUICKBOOKS_CLIENT_ID/SECRET already in packages/env (re-exported via @carbon/auth's `export * from "@carbon/env"`, same path the Xero route uses); added QUICKBOOKS_ENVIRONMENT (sandbox|production, default "production", RESEND_DOMAIN-style `??` default) + ProcessEnv declaration. Route integrations.quickbooks.oauth.ts mirrors Xero step-for-step minus the discovery + currency-check steps (realmId comes from the callback query params; QBO CompanyInfo has no reliable home-currency field — per the C2 step list). Token exchange reuses `createOAuthClient` UNCHANGED — it already sends `Authorization: Basic base64(clientId:clientSecret)` + form body, exactly Intuit's contract. Credentials stored new-shape with providerMetadata.realmId; empty quickbooksOnInstall hook (subscriptions land with C5+ syncers) registered in hooks.server.ts; `./quickbooks/hooks.server` added to ee package.json exports; config.tsx → name "QuickBooks Online", accounting scope only, id/active unchanged. TS2589 recurrence (predicted): the new route's import graph flipped SalesInvoiceForm.tsx:109's embedded-relation select — restored the same `@ts-expect-error Supabase composite key issue` marker QuoteForm previously carried (bisect: route-file-absent = green).
- [x] Task C3: QboProvider + zod models — providers/quickbooks-online/{provider,models,index}.ts + __tests__/provider.test.ts. QboProvider **extends BaseProvider** (Xero uses implements): host switch prod/sandbox via config.environment (service.ts reads process.env.QUICKBOOKS_ENVIRONMENT, mirroring Xero's process.env pattern — @carbon/env import would force its required-var checks on all ee consumers), paths /v3/company/{realmId} with pinned minorversion=75 constant, refresh-on-401 single retry persisting via the shared onTokenRefresh path, `query<T>(entity, where?, startPosition?, maxResults?)` STARTPOSITION/MAXRESULTS loop (1000 cap, stops on short page, throws structured AccountingApiError), validate() = GET /companyinfo/{realmId} via getCompanyInfo(). BaseProvider had NO capabilities concept → added optional readonly `capabilities?: ProviderCapabilities` to core/types.ts (documented absent-means-rest default; no consumers wired — flagged deviation per plan); QBO sets {transport:"rest", supportsWebhooks:false, supportsJournalPush:true}. ProviderID.QUICKBOOKS added (models.ts, enum only); AccountingProvider = XeroProvider | QboProvider; getProviderIntegration gains overloads (literal → concrete class, ProviderID → union) + the quickbooks case with realmId extraction — jobs' uncast call sites use only getSyncConfig/id (verified), Xero-specific sites already cast. getSyncConfig mirrors Xero's (journalEntry via DEFAULT_SYNC_CONFIG). Tests: refresh-on-401 (Basic auth + grant asserted, retry-once, callback persistence), pagination loop + 1000 cap, sandbox-vs-prod host, Qbo model parses. 126 ee tests green (116 post-C1 + 10); ee/erp/jobs/env typecheck exit 0; biome clean.
- [x] Task C4: QBO chart-of-accounts fetch route — api+/integrations.quickbooks.accounts.ts mirrors the Xero accounts route (view:settings, `{accounts: [{value,label}]}` + 500 `{error, accounts: []}` envelope) via QboProvider.listChartOfAccounts(); value = QBO account Id (refs/mappings key on Id, not code), label shows AcctNum only when assigned. PLAN-TEXT ADAPTATION: step 2's "point the UI's chart fetch at the right route" doesn't apply — Task 11 fetches server-side in x+/settings+/integrations.$id.tsx, so the loader instead gained a parallel `integrationId === "quickbooks"` branch (cast `as QboProvider`, chartAccounts = the already-normalized `{id, code, name}` list, NO coded-accounts filter since QBO maps by Id; dynamicOptions untouched — the quickbooks config has no account-code settings fields). NOTE: the two providers' listChartOfAccounts shapes are NOT the same (Xero returns raw Xero.Account[], QBO returns normalized rows), hence per-provider branches rather than a shared one. No TS2589 flip this time; erp typecheck exit 0.
- [x] Task C5: Customer + Vendor syncers — SEPARATE QboCustomerSyncer/QboVendorSyncer (no dual-Contact logic); shared `entities/shared.ts` carries the pure contact mappers + a `QboEntitySyncer` base that reimplements the base push workflow (journal-syncer override pattern, base semantics preserved incl. lastSyncedAt bailout) so NAME_EXISTS/NAME_TOO_LONG survive as structured envelopes — `JOURNAL_ENTRY_SYNC_ERROR_CODES` extended minimally with those two codes (core/posting.ts; drain detects them generically via isJournalEntrySyncFailure, no jobs changes). 6240 fault → NAME_EXISTS Warning; 100-char DisplayName cap → NAME_TOO_LONG Warning (no truncation); updates are read-modify-write `sparse: true` with ONE stale-SyncToken (5010) refetch-retry via `updateWithSyncTokenRetry`; Id = externalId, SyncToken → mapping metadata, MetaData.LastUpdatedTime → remoteUpdatedAt. Provider gained fault parsing (extractQboErrorDetails/throwQboApiError/QBO_FAULT_CODES) + get/create/updateCustomer|Vendor. Registered in qboSyncerRegistry; sync-factory test's unknown-provider case moved to "sage" (quickbooks is now registered) + both-providers-side-by-side assertions added.
- [x] Task C6: Item syncer — QboItemSyncer push-only; `mapItemToQboItem` (pure, tested): Type Service (Carbon "Service" — ItemSchema enum extended to match the DB itemType enum) vs NonInventory, NEVER Inventory; QBO Name = Carbon item code (unique key, Xero-Code role), >100 → NAME_TOO_LONG Warning; Income/ExpenseAccountRef resolved through the account-mapping service (externalId = QBO account id, journal-syncer path via shared loadQboAccountRefsById) from accountDefault salesAccount/costOfGoodsSoldAccount (items carry no per-item accounts post posting-group drop) — unmapped → UNMAPPED_ACCOUNTS Warning with unmappedAccountIds/missingDefaults metadata. Provider gained get/create/updateItem + listChartOfAccounts() returning normalized `{id, code: AcctNum ?? Id, name}` ([] on failure, Xero-parity contract).
- [x] Task C7: Invoice + Bill + PO syncers — QboSalesInvoiceSyncer (SalesItemLineDetail ItemRef/Qty/UnitPrice via JIT item sync, CustomerRef via JIT customer sync, TxnDate/DueDate net-30 fallback, Xero status gate verbatim; DocNumber 21-char rule via buildQboDocNumberFields — overflow → PrivateNote "Carbon <id>" + QBO auto-numbers, carrier recorded as mapping metadata `docNumberSource`; pull derives status from Balance/TotalAmt, update-only), QboBillSyncer (VendorRef JIT; item lines → ItemBasedExpenseLineDetail, non-item → AccountBasedExpenseLineDetail via mapped account — unmapped throws plain Failed; pull mirrors Xero incl. create-from-remote with sequence + supplierInteraction + default user; ItemRef/AccountRef reverse-resolved through mappings), QboPurchaseOrderSyncer (POEmail from supplier primary contact — Qbo.PurchaseOrderSchema gained POEmail; POStatus Open/Closed mapping; Xero locked-status gate verbatim; pull update-only). BillLineSchema/PurchaseOrderLineSchema gained optional `accountId` (QBO resolves G/L lines by account.id through the mapping service; Xero-only accountNumber untouched); QBO syncers use entityType "vendor" for supplier-mapping lookups (Xero files query "supplier", which nothing ever writes). All registered in qboSyncerRegistry (journalEntry stays for C8). 181 ee tests green (126 baseline + 55 across C5–C7: contact/item/invoice/bill/PO fixtures, NAME_EXISTS + NAME_TOO_LONG + UNMAPPED_ACCOUNTS envelope paths incl. batch survival, stale-token retry-once, DocNumber boundary/overflow, fault parsing, listChartOfAccounts, sparse-update body); ee+jobs+erp typecheck exit 0 (TS2589 flip-flop: the C2 `@ts-expect-error` in SalesInvoiceForm.tsx:109 became unused under the new import graph and was reverted to HEAD).
- [x] Task C8: QBO JournalEntrySyncer + closed-books pre-flight — entities/journal-entry.ts mirrors the Xero journal syncer structurally (extends BaseEntitySyncer directly, NOT QboEntitySyncer — journals need the hard skip-when-mapped, not the lastSyncedAt bailout): same shouldSync gates (Posted / Reversed-with-original-mapping, resolvePostingSyncSettings enabled + sourceType filter, already-mapped), same pushToAccounting/pushBatchToAccounting overrides so JournalEntrySyncFailure envelopes survive both drain paths, same reversal contract (`<journal.id>:reversal`, sign negated pre-abs so every PostingType flips, PrivateNote "Carbon reversal of <journalEntryId>"). Step 1's extraction was already done (core/posting.ts consumed as-is, untouched). mapJournalEntryToQboJournalEntry (pure, exported): unsigned Amount = abs 2dp + PostingType Debit when signed amount > 0 else Credit (sandbox-verify TODO carried in the header like Xero's), AccountRef via loadQboAccountRefsById (mapping externalId = QBO Account.Id; preflight consumes a derived id-as-code map), DocNumber = journalEntryId ≤21 chars via buildQboDocNumberFields (overflow → omitted, PrivateNote "Carbon <journalEntryId> <journal.id>" always carries the ids), TxnDate = preflight pushDate (redate appends " | original date <d>"). Closed books: lock date ONLY from settings.lockDate via getQboLockDate (no org fetch — QBO API can't read the close date); BACKSTOP: 6210 on create → toQboPeriodClosedError → structured PERIOD_LOCKED Warning (new isQboAccountPeriodClosedError predicate beside the 6240/5010 ones). Provider gained getJournalEntry/createJournalEntry (create-only; pushed journals immutable). Registered journalEntry in qboSyncerRegistry (sync-factory test updated: registry toEqual + instance assertion replaced the C8-pending throw case); getSyncConfig already exposed journalEntry via DEFAULT_SYNC_CONFIG (verified). ERP: NO change needed — PostingSyncSettings.tsx's "Books lock date (manual)" DatePicker (Task 11) renders unconditionally for all accounting providers. 15 new tests (fixture Debit/Credit split + balance cents, 2dp rounding, reversal flip, redate note, DocNumber boundary/overflow, UNMAPPED_ACCOUNTS guard, getQboLockDate, park + redate + after-lock + UNBALANCED via shared preflight, 6210 backstop mapping + null for other faults); ee 200 green (181 + 15 + concurrent C9's 4); ee+erp typecheck exit 0; biome clean.
- [x] Task C9: CDC pull cron — `QboProvider.changeDataCapture(entities, changedSince)` (GET /cdc, minimal zod identity parse: Id + status + MetaData.LastUpdatedTime → normalized `{entityName, id, deleted, lastUpdatedTime}`; Deleted stubs flagged, unparseable records logged+skipped; test in `__tests__/provider-cdc.test.ts`, separate file to avoid colliding with the concurrent C8 edits). Inngest cron `quickbooks-cdc` (`*/30 * * * *`) in jobs: per ACTIVE quickbooks integration, CDC only entity names whose RESOLVED config direction includes pull (Customer/Vendor/Invoice/Bill under defaults; Item/PO push-only → excluded); Deleted → log+skip (house rule); others enqueue pull-from-accounting, trigger "webhook", entityId = remote id, idempotencyKey scope `cdc:<LastUpdatedTime>` (stable across retries; null timestamp falls back to the run's changedSince); drain via drainSyncOperations. Cursor: read `metadata.settings.cdcCursor`, default = integration `updatedAt` (companyIntegration has NO createdAt — updatedAt is at-or-after connect, so pre-connect history never pulls), clamp to 29 days (DEVIATION: plan's per-entity query fallback for >30-day gaps dropped as overkill for a 30-min cron — clamp + two-way owner semantics/backfill recover; clamps logged in the run summary); advance ONLY after all enqueues succeed + drain returns, to max(changedSince, LastUpdatedTimes seen) — never the CDC server time (lagging-snapshot risk); drain FAILURES don't hold the cursor (Failed ledger rows are the durable record, retryable in Sync Activity); write via mergeCdcCursor raw-metadata read-modify-write (sibling of mergePostingSyncReconciliation; cursor is settings-level, NOT postingSync). Registered in functions/integrations/index.ts + inngest/index.ts like accounting-consolidation. Pure helpers + 16 tests in accounting-sync-operations{,.test}.ts (mapping/pull-filter, cursor default/clamp/normalize/advance/no-regress, scope shape + key composition, merge preservation); jobs 88 green (72 baseline + 16), ee provider-cdc adds 4 (200 total incl. concurrent C8's 15); ee+jobs typecheck exit 0.
- [x] Task C10: Activation, plan gating, gates + sandbox verification *(PARTIAL 2026-07-09: config.tsx active:true; plan gating needed NO change — the plan text assumed a per-integration FEATURE_PLANS entry, but gating is the generic INTEGRATIONS feature + INTEGRATION_WHITELIST bypass, and quickbooks (like xero) is simply not whitelisted → identical gate by default; ProviderID.QUICKBOOKS landed in C3. Final gates green: typecheck 3/3 (ee/jobs/erp), @carbon/ee 200 tests (17 files), @carbon/jobs 88 tests, biome clean on all 46 changed TS/TSX files. DEFERRED per "implement only": integration-card render check and the Intuit-sandbox e2e (needs QUICKBOOKS_CLIENT_ID/SECRET + QUICKBOOKS_ENVIRONMENT=sandbox in local env + a running stack + browser) — including the QBO PostingType sign-convention sandbox check flagged in the journal syncer header.)*

## Dependencies
- C1 first (everything else registers into it). C2 → C3 → C4–C8 (C5–C8 parallel-safe after C3).
- C9 needs C5–C7. C10 last.
- Phase D consumes C1; if Phase D starts first, execute C1 as part of it (it is shared).

---

## Task C1: Provider-keyed SyncFactory registry

**Depends on:** Phase A+B complete
**Files:**
- Modify: `packages/ee/src/accounting/core/sync.ts` — replace the entityType `switch` (which imports Xero syncers directly, lines 1–7/15+) with a registry keyed by `(ProviderID, AccountingEntityType)`
- Modify: `packages/ee/src/accounting/providers/xero/index.ts` — export a `xeroSyncerRegistry` map registering the existing syncers
- Create: `packages/ee/src/accounting/core/__tests__/sync-factory.test.ts`

**Steps:**
1. Define `type SyncerRegistry = Partial<Record<AccountingEntityType, SyncerConstructor>>` in
   `core/sync.ts`; `SyncFactory` holds `Record<ProviderID, SyncerRegistry>` populated by
   provider modules (Xero registers exactly its current set — contact syncer under both
   `customer` and `vendor`, etc.). `getSyncer(context)` resolves
   `registry[context.provider]?.[context.entityType]` and returns a descriptive error for
   unregistered combinations (same error text style as the current `default:` branch).
2. Behavior must be identical for Xero: same classes, same construction arguments.
3. Tests: every currently-supported Xero entityType resolves to the same class as before
   (assert constructor names); an unknown provider/entity pair returns the error.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: sync-factory tests pass; all existing @carbon/ee tests still green.
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0.
```

**Out of scope:** Any QBO code; changing syncer constructor signatures.

---

## Task C2: QBO env + OAuth connect flow

**Depends on:** C1
**Files:**
- Create: `apps/erp/app/routes/api+/integrations.quickbooks.oauth.ts`
- Modify: `packages/ee/src/quickbooks/config.tsx` — display name "QuickBooks Online"; description mentions posting sync; keep `id: "quickbooks"`, keep `active: false` until Task C10
- Copy from (precedent): `apps/erp/app/routes/api+/integrations.xero.oauth.ts` (whole flow) and `packages/ee/src/accounting/providers/xero/provider.ts` (`authenticate`/`exchangeCode`)

**Steps:**
1. Env check FIRST: `grep -rn "QUICKBOOKS_CLIENT_ID\|QUICKBOOKS_CLIENT_SECRET" packages/auth/src packages/env/src`.
   The config already imports `QUICKBOOKS_CLIENT_ID` from `@carbon/auth`. If
   `QUICKBOOKS_CLIENT_SECRET` (or equivalent) is not exported anywhere, STOP and report the
   exact env additions needed (name, where to add in `packages/env`, `.env` template) — do
   not invent an env mechanism.
2. OAuth callback route mirrors the Xero one step-for-step: validate `state`, exchange `code`
   at `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` (Basic auth
   clientId:clientSecret), and capture **`realmId` from the callback query params** (Intuit
   sends it alongside `code` — this replaces Xero's `GET /connections` tenant discovery).
   Store credentials in the NEW shape: `{ type: "oauth2", accessToken, refreshToken,
   expiresAt, providerMetadata: { realmId } }` in `companyIntegration.metadata.credentials`,
   then call the integration's on-install hook if one exists (mirror Xero's
   `xeroOnInstall` wiring in `packages/ee/src/quickbooks/hooks.server.ts` — create it as an
   empty hook like Xero's if absent).
3. Scopes: `com.intuit.quickbooks.accounting` only (drop the `payment` scope from the stub —
   payments are out of scope v1; edit `config.tsx` scopes accordingly).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee
# Expected: exit 0.
```

**Out of scope:** Intuit app registration itself (human task — sandbox + production keys);
webhooks; the `payment` scope.

---

## Task C3: QboProvider + zod models

**Depends on:** C2
**Files:**
- Create: `packages/ee/src/accounting/providers/quickbooks-online/provider.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-online/models.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-online/index.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-online/__tests__/provider.test.ts`
- Copy from (precedent): `packages/ee/src/accounting/providers/xero/provider.ts` (request wrapper, refresh-on-401, list pagination) and `xero/models.ts` (zod style)

**Steps:**
1. `QboProvider extends BaseProvider`: base URL `https://quickbooks.api.intuit.com/v3/company/
   {realmId}` (sandbox `https://sandbox-quickbooks.api.intuit.com` when
   `providerMetadata.realmId` belongs to a sandbox — switch on an env flag
   `QUICKBOOKS_ENVIRONMENT=sandbox|production`, default production; add to the same env
   surface as Task C2), pinned `minorversion` query param (use `75`; constant in one place),
   `Accept: application/json`. Refresh flow: on 401, POST refresh_token grant to the bearer
   token URL, persist via the same `onTokenRefresh` callback pattern as Xero.
   `capabilities = { transport: "rest", supportsWebhooks: false, supportsJournalPush: true }`.
2. Query helper: QBO reads use `GET /query?query=<SQL-ish>` — implement
   `query<T>(entity, where, startPosition, maxResults)` with pagination (`STARTPOSITION`/
   `MAXRESULTS`, 1000 cap).
3. `models.ts` zod schemas (fields limited to what the syncers map): `Qbo.Customer`
   (`Id`, `SyncToken`, `DisplayName`, `PrimaryEmailAddr`, `BillAddr`, `PrimaryPhone`,
   `Active`, `MetaData.LastUpdatedTime`), `Qbo.Vendor` (same shape), `Qbo.Item` (`Type`:
   `Service|NonInventory`, `IncomeAccountRef`, `ExpenseAccountRef`), `Qbo.Invoice`
   (`CustomerRef`, `Line[]` with `SalesItemLineDetail`, `TxnDate`, `DocNumber`, `TotalAmt`),
   `Qbo.Bill` (`VendorRef`, `Line[]` with `AccountBasedExpenseLineDetail` or
   `ItemBasedExpenseLineDetail`), `Qbo.PurchaseOrder`, `Qbo.JournalEntry` (`Line[]` with
   `JournalEntryLineDetail { PostingType: "Debit"|"Credit", AccountRef }`, `DocNumber`,
   `PrivateNote`, `TxnDate`), `Qbo.Account` (`Id`, `Name`, `AcctNum`, `AccountType`,
   `Active`), `Qbo.CompanyInfo`.
4. `validate()` = `GET /companyinfo/{realmId}`; provider test covers refresh-on-401 with a
   mocked fetch and query pagination.

**Verify:**
```bash
pnpm --filter @carbon/ee test
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: provider tests pass; exit 0.
```

**Out of scope:** Webhooks; attachments; payments; tax models.

---

## Task C4: QBO chart-of-accounts fetch route

**Depends on:** C3
**Files:**
- Create: `apps/erp/app/routes/api+/integrations.quickbooks.accounts.ts`
- Copy from (precedent): `apps/erp/app/routes/api+/integrations.xero.accounts.ts`

**Steps:**
1. Mirror the Xero accounts route: `requirePermissions` same scope as the precedent, load the
   integration, instantiate `QboProvider`, `query("Account", "Active = true")`, map to the
   same `{ id, code, name }` shape the account-mapping UI consumes (`code` = `AcctNum ?? Id`
   — QBO account numbers are optional; when absent the mapping UI shows the name and stores
   `Id` as `externalId` regardless).
2. Point the account-mapping UI's chart fetch (Phase A+B Task 11) at the right route per
   integration id (`xero` → existing route, `quickbooks` → this one) — a two-entry lookup, not
   an abstraction.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0.
```

**Out of scope:** Creating QBO accounts; caching.

---

## Task C5: Customer + Vendor syncers

**Depends on:** C3 (parallel-safe with C6–C8)
**Files:**
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/customer.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/vendor.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/__tests__/customer.test.ts` (+ vendor cases)
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/index.ts` — register both in the C1 registry
- Copy from (precedent): `packages/ee/src/accounting/providers/xero/entities/contact.ts` — but SPLIT: QBO has separate Customer and Vendor objects; none of the dual-mapping IsCustomer/IsSupplier logic applies

**Steps:**
1. Each syncer extends `BaseEntitySyncer` with the standard abstract methods. Push maps
   Carbon customer/supplier → `DisplayName` (unique across QBO's shared name namespace —
   a `Duplicate Name Exists` (6240) error → `failOperation` with `warning: true`,
   errorCode `NAME_EXISTS`), email/phone/address fields per the models. Pull maps back the
   same fields (two-way per `DEFAULT_SYNC_CONFIG`, owner `accounting`).
2. Updates require `SyncToken` (QBO's EditSequence): read-modify-write with the latest
   `SyncToken`; a stale-token error triggers ONE refetch-and-retry, then `Failed`.
3. Store `Id` as `externalId`; `SyncToken` and `MetaData.LastUpdatedTime` in mapping
   `metadata` (`remoteUpdatedAt` column gets `LastUpdatedTime` — same as Xero pattern).
4. Tests: map-to-remote fixture, name-collision → Warning path, stale SyncToken retry-once.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: customer/vendor syncer tests pass.
```

**Out of scope:** Sub-customers/jobs; customer types; payment methods.

---

## Task C6: Item syncer (Service/Non-inventory)

**Depends on:** C3 (parallel-safe with C5, C7, C8)
**Files:**
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/item.ts` (+ test file alongside C5's)
- Copy from (precedent): `packages/ee/src/accounting/providers/xero/entities/item.ts`

**Steps:**
1. Push-only (owner `carbon`, direction `push-to-accounting` per defaults). Carbon items map
   to QBO `Item` with `Type: "NonInventory"` (physical) or `"Service"` (service items) —
   NEVER `Inventory` (spec: QBO item-level tracking stays off; double-COGS guard).
2. `IncomeAccountRef`/`ExpenseAccountRef`: resolve through the account-mapping service from
   the item's posting-group accounts (fall back to `accountDefault` sales/purchase accounts);
   unmapped → `Warning` `UNMAPPED_ACCOUNTS` (same errorCode as Phase B).
3. QBO `Name` max 100 chars; enforce with `NAME_TOO_LONG` Warning (no silent truncation).
4. Tests: mapping fixture with account resolution, unmapped-account Warning.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: item syncer tests pass.
```

**Out of scope:** Inventory-type items, quantities on hand, bundles/categories.

---

## Task C7: Invoice + Bill + PurchaseOrder syncers

**Depends on:** C3 (parallel-safe with C5, C6, C8; JIT-depends on C5/C6 at runtime via `ensureDependencySynced`)
**Files:**
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/invoice.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/bill.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/purchase-order.ts`
- Create: `__tests__` files alongside
- Copy from (precedent): `packages/ee/src/accounting/providers/xero/entities/invoice.ts`, `bill.ts`, `purchase-order.ts`

**Steps:**
1. Same `shouldSync` gates as the Xero counterparts (only posted invoices, etc. — copy each
   precedent's gate verbatim in behavior). Dependency JIT sync: customer/vendor + items
   before the document (`ensureDependencySynced`, exactly like Xero's).
2. Invoice lines → `SalesItemLineDetail` with `ItemRef` (synced item) + qty/rate; `DocNumber`
   = Carbon invoice readable id (21-char QBO cap → if longer, put the readable id in
   `PrivateNote` and let QBO auto-number, record which happened in mapping metadata).
   Bill lines: item lines → `ItemBasedExpenseLineDetail`; non-item lines →
   `AccountBasedExpenseLineDetail` with mapped account. Two-way pull mirrors Xero's field
   set (status/amounts back onto Carbon documents).
3. Tests: one mapping fixture per document type; DocNumber-overflow behavior.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: invoice/bill/PO syncer tests pass.
```

**Out of scope:** Payments/settlements; credit memos; attachments; e-invoicing fields.

---

## Task C8: QBO JournalEntrySyncer + closed-books pre-flight

**Depends on:** C3 (parallel-safe with C5–C7)
**Files:**
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/journal-entry.ts` (+ test)
- Modify: `apps/erp/app/modules/settings/ui/Integrations/PostingSyncSettings.tsx` — show the manual "Books close date" field when integration id is `quickbooks`
- Copy from (precedent): `packages/ee/src/accounting/providers/xero/entities/journal-entry.ts` (Phase B Task 9 — pre-flights, exclusion lists, reversal, consolidation awareness are IDENTICAL; only `mapToRemote` and the lock-date source differ)

**Steps:**
1. Reuse the Phase B pre-flight helpers as shared functions — if Task 9 left them Xero-local,
   extract them to `packages/ee/src/accounting/core/posting.ts` FIRST (pure move, no logic
   change) so both providers import one implementation. If the extraction reveals
   Xero-specific coupling in the pre-flights, STOP and report.
2. `mapToRemote`: `Qbo.JournalEntry` with one `Line` per journalLine — `Amount` =
   `abs(line.amount)`, `JournalEntryLineDetail.PostingType` = `Debit` when `line.amount > 0`
   else `Credit` (Carbon convention: positive = debit; VERIFY against one sandbox journal
   before finishing — if QBO rejects, document and invert), `AccountRef` from the account
   mapping, `DocNumber` = Carbon `journalEntryId` (21-char cap rule from C7), `PrivateNote` =
   `Carbon <journal.id>`, `TxnDate` = postingDate. Balance assert before push.
3. Closed-books pre-flight: lock date comes from
   `companyIntegration.metadata.settings.postingSync.lockDate` (manual — the QBO API cannot
   read it; the settings field from this task's UI change). QBO's closed-books rejection
   (error text "account period has closed", code 6210) also maps → `Warning` `PERIOD_LOCKED`
   as the backstop when the stored date is stale.
4. Reversal: negate PostingType per line (Debit↔Credit), `PrivateNote` references the
   original, idempotencyKey `<journal.id>:reversal` — same contract as Xero.
5. Register in the C1 registry; enable `journalEntry` in the provider's `getSyncConfig`.
6. Tests: mapping fixture (3 lines → Debit/Credit split), lock-date Warning, 6210 backstop
   mapping, reversal negation.

**Verify:**
```bash
pnpm --filter @carbon/ee test
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: QBO journal tests pass; exit 0.
```

**Out of scope:** QBO Classes/Departments (dimensions are v1-out); exchange-rate overrides.

---

## Task C9: CDC pull cron

**Depends on:** C5–C7
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/quickbooks-cdc.ts`
- Modify: `packages/jobs/src/inngest/functions/index.ts` — export + register

**Steps:**
1. Inngest cron every 30 min: for each company with an active `quickbooks` integration, call
   QBO **Change Data Capture** (`GET /cdc?entities=Customer,Vendor,Item,Invoice,Bill&changedSince=<cursor>`)
   with the cursor from `companyIntegration.metadata.settings.cdcCursor` (default: connect
   time). For each changed entity, `enqueueSyncOperation` with `direction:
   'pull-from-accounting'`, `trigger: 'webhook'` (reuse the existing trigger value — it means
   "remote-change-driven"), idempotencyKey `<entityType>:<remoteId>:<LastUpdatedTime>`.
   Advance the cursor ONLY after all enqueues succeed (Celigo pattern: cursor moves on
   success). Drain via the Task 6 machinery.
2. CDC covers 30 days max — if the cursor is older, fall back to per-entity
   `query(... WHERE MetaData.LastUpdatedTime > cursor)` pagination for that run, then resume
   CDC.
3. Respect the resolved syncConfig: only pull entities whose direction includes pull.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
pnpm --filter @carbon/jobs test
# Expected: exit 0; unit test for cursor-advance-only-on-success passes.
```

**Out of scope:** QBO webhooks (stretch, not v1); deleted-entity handling (DELETE sync
remains unimplemented — log + skip, house rule).

---

## Task C10: Activation, plan gating, gates + sandbox verification

**Depends on:** C1–C9
**Files:**
- Modify: `packages/ee/src/quickbooks/config.tsx` — `active: true`
- Modify: `packages/ee/src/plan.ts` (or wherever `FEATURE_PLANS` gates Xero — grep `FEATURE_PLANS` and mirror the Xero entry) — gate `quickbooks` identically
- Modify: `packages/ee/src/accounting/core/models.ts` — `ProviderID.QUICKBOOKS = "quickbooks"` (if not added earlier)

**Steps:**
1. Activate + gate; verify the integration card renders on `x+/settings+/integrations`.
2. Full scoped gates (below).
3. Sandbox e2e: requires an Intuit developer sandbox company + `QUICKBOOKS_CLIENT_ID`/
   `QUICKBOOKS_CLIENT_SECRET` (+ `QUICKBOOKS_ENVIRONMENT=sandbox`) in the local env. If
   available: connect via OAuth in the browser (`/test`), map accounts, push one customer +
   one invoice + one posted receipt journal; verify in the QBO sandbox UI. If credentials are
   NOT available, STOP the live pass, keep unit evidence, and report exactly which checks
   were skipped — do not fake the round-trip.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp && pnpm --filter @carbon/ee test && pnpm --filter @carbon/jobs test && pnpm run lint
# Expected: all exit 0.
```

**Out of scope:** Committing (explicit ask only); production Intuit app review/publishing;
docs-site updates (with the PR).

## Acceptance-criteria coverage map (spec Phase C)

- Xero-parity posting sync on QBO → C8 (+ C10 sandbox)
- Closed-books date captured + enforced → C8
- Provider registry proven by both providers side by side → C1 (test), C10 (live)
