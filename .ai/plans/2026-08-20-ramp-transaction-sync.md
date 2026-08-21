# Ramp Transaction Sync — implementation plan

**Spec:** .ai/specs/2026-08-20-ramp-transaction-sync.md
**Research:** .ai/research/ramp-transaction-sync.md
**Branch:** ramp-transaction-sync-integration

Read the spec's Design Decisions table and the research file's "Answers to Research
Questions" before starting — they are the source of truth for every mapping below.
Ramp API base: `https://demo-api.ramp.com` (sandbox) / `https://api.ramp.com` (prod);
all endpoints under `/developer/v1/`. Auth v1 = OAuth client-credentials (token endpoint
`POST /developer/v1/token`, HTTP Basic `clientId:clientSecret`, body
`grant_type=client_credentials&scope=<space-separated>`, 10-day tokens).

## Progress
- [ ] Task 1: Verify Ramp sandbox endpoints and record findings
- [ ] Task 2: Migration — integration row, enums, cardTransaction tables, sequences, RLS
- [x] Task 3: Ramp API client, payload models, webhook signature verify (@carbon/ee)
- [x] Task 4: Integration config, registration, secrets, settings-drawer wiring
- [x] Task 5: Ramp service (connection, CoA/cost-center push, queues, confirms) + server hooks
- [ ] Task 6: post-card-transaction edge function + pure journal builder + tests
- [ ] Task 7: ramp-sync Inngest function (card family inbound) + ramp-sweep cron + registration
- [ ] Task 8: Bills + bill-payments inbound
- [ ] Task 9: Reimbursements + repayments inbound
- [ ] Task 10: Outbound — PO push, invoice draft-bill push, archive-on-settlement
- [ ] Task 11: Invoicing module models/service + path helpers
- [ ] Task 12: UI — card transactions list/drawer, nav, invoice Ramp badge
- [ ] Task 13: Docs + rule file
- [ ] Task 14: Browser verification (/test) with sandbox

## Dependencies
- Task 1 needs sandbox credentials from the user (STOP and ask at task start).
- Tasks 2 and 3 are independent of each other and of Task 1.
- Task 4 needs Task 3 (models). Task 5 needs Tasks 3, 4. Task 6 needs Task 2.
- Task 7 needs Tasks 2, 5, 6. Task 8 needs Tasks 1, 7. Task 9 needs Tasks 1, 8.
- Task 10 needs Tasks 1, 5. Task 11 needs Task 2. Task 12 needs Task 11.
- Task 13 needs Task 12. Task 14 last.
- Parallelizable: {2, 3} together; {8, 9, 10} after 7 if separate agents; {11, 12} alongside 7–10.

---

## Task 1: Verify Ramp sandbox endpoints and record findings

**Depends on:** none (blocked on user-provided sandbox `clientId`/`clientSecret` — STOP
and ask the user for them at task start; do not proceed with placeholders)
**Files:**
- Create: `.ai/research/ramp-sandbox-verification.md`

**Steps:**
1. Export creds as shell vars (never commit them). Mint a token:
   `curl -s -X POST https://demo-api.ramp.com/developer/v1/token -H "Authorization: Basic $(printf '%s:%s' "$RAMP_CLIENT_ID" "$RAMP_CLIENT_SECRET" | base64)" -H "Content-Type: application/x-www-form-urlencoded" -d "grant_type=client_credentials&scope=accounting:read accounting:write transactions:read bills:read bills:write vendors:read vendors:write reimbursements:read purchase_orders:read transfers:read statements:read cashbacks:read receipts:read entities:read business:read"`
   Record: token lifetime, granted scopes (some may be refused — record which).
2. With `Authorization: Bearer <token>`, verify each of these and paste trimmed JSON
   (one example object each) into the findings file:
   - `GET /developer/v1/transactions?sync_status=SYNC_READY&page_size=5` — confirm
     `accounting_field_selections[].external_id`, `line_items`, `sync_status`, amount shape.
   - `GET /developer/v1/transfers?page_size=5` and `?sync_status=SYNC_READY` — confirm the
     transfer object fields (`amount`, `bank_account_id`, `statement_id`, `sync_status`).
   - `GET /developer/v1/cashbacks?page_size=5`.
   - `GET /developer/v1/bills?sync_ready=true&page_size=5` — confirm `sync_status`,
     `remote_id`, `payment` nested object, `line_items[].accounting_field_selections`.
   - `GET /developer/v1/reimbursements?page_size=5` — confirm `sync_status`, `updated_after`
     filter works (`?updated_after=2020-01-01T00:00:00Z`).
   - `GET /developer/v1/repayments?page_size=5` — confirm object shape, whether any
     sync-status field exists, and which filters work (`from_repaid_at`).
   - `POST /developer/v1/accounting/connection` body
     `{"remote_provider_name":"Carbon (verification)"}` — record `connection_id` and
     response shape. Then `GET /accounting/all-connections`.
   - `POST /developer/v1/accounting/accounts` with 2 test accounts
     `{"gl_accounts":[...]}` per the API reference (check the exact body key in the
     OpenAPI: https://docs.ramp.com/openapi/developer-api.json) — record request/response.
   - `POST /developer/v1/accounting/syncs` with an idempotency key and an EMPTY/invalid id
     to observe the error shape (record `error_v2`).
   - `POST /developer/v1/bills/drafts` minimal body — **record whether `remote_id` (or any
     external-reference field) is accepted**, then `POST /developer/v1/bills/drafts/{id}/submit`
     and `GET` it back — **record the resulting approval status** (expect Pending approval,
     NOT auto-approved).
   - `GET /developer/v1/purchase-orders?page_size=5` and `POST /developer/v1/purchase-orders`
     minimal body with `remote_id` — record accepted fields.
   - `POST /developer/v1/webhooks` with a placeholder public URL (e.g. a webhook.site URL) —
     record the returned `secret`, the challenge delivery shape on that URL, and the
     `X-Ramp-Signature` format (HMAC-SHA256 of raw body — confirm by recomputing).
     Delete the webhook afterwards.
3. Write `.ai/research/ramp-sandbox-verification.md` with a VERIFIED/REFUTED line per
   item above, each with the observed evidence. Explicitly answer:
   (a) drafts accept an external reference? (b) draft→submit lands in Pending approval?
   (c) repayments: any confirm path? (d) `POST /accounting/syncs` body key names.
   (e) accounting/accounts + field-options exact body key names.
4. Clean up: delete the verification connection only if a delete endpoint works
   (`DELETE /accounting/connection`); otherwise leave it inactive and note it.

**Verify:**
```bash
test -f .ai/research/ramp-sandbox-verification.md && grep -c "VERIFIED\|REFUTED" .ai/research/ramp-sandbox-verification.md
# Expected: file exists; count >= 12 (one verdict per probed surface)
```

**Out of scope:** any Carbon code changes; committing credentials anywhere (env vars in
the shell session only).

---

## Task 2: Migration — integration row, enums, cardTransaction tables, sequences, RLS

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_ramp-integration.sql` (via `pnpm db:migrate:new ramp-integration`)
- Modify: `packages/database/supabase/functions/lib/seed.data.ts` — add `cardTransaction` sequence template
- Copy from (precedent): `packages/database/supabase/migrations/20260630093809_ar-ap-payments.sql` (payment table L194–290, sequence insert L560–563), `20260731073327_rillet-integration.sql`

**Steps:**
1. `pnpm db:migrate:new ramp-integration`. If the generated HHMMSS is `000000`, rename the
   file with a randomized HHMMSS. Confirm the timestamp is newer than the newest migration
   on `main` (`ls packages/database/supabase/migrations | tail -1`).
2. Write the SQL, all idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING` /
   `DO $$ ... EXCEPTION WHEN duplicate_object` for enums where needed):
   a. Integration registry row (clone rillet):
      `INSERT INTO "integration" ("id", "jsonschema") VALUES ('ramp', '{"type": "object", "properties": {}}'::json) ON CONFLICT ("id") DO NOTHING;`
   b. `ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Card Transaction';`
      `ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Card Transaction';`
      (Top of file, NOT used by any DML in this same migration — enum values added in a
      transaction cannot be used in that transaction.)
   c. `CREATE TYPE "cardTransactionType" AS ENUM ('Charge','Credit','Payment','Cashback','Repayment');`
      `CREATE TYPE "cardTransactionStatus" AS ENUM ('Draft','Posted','Voided');`
      (wrap each in the standard `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` guard).
   d. `cardTransaction` table — follow the `payment` sibling EXACTLY (single-column
      `"id" TEXT NOT NULL PRIMARY KEY DEFAULT xid()`, NOT the composite-PK template; this
      is the deliberate sibling-consistency choice recorded in the spec changelog):
      columns `id`, `cardTransactionId TEXT NOT NULL` (readable), `type "cardTransactionType" NOT NULL DEFAULT 'Charge'`,
      `status "cardTransactionStatus" NOT NULL DEFAULT 'Draft'`, `integration TEXT NOT NULL DEFAULT 'ramp'`,
      `cardAccountId TEXT NOT NULL REFERENCES "account"("id")`,
      `offsetAccountId TEXT REFERENCES "account"("id")`,
      `merchantName TEXT`, `cardHolderName TEXT`, `cardLast4 TEXT`, `memo TEXT`,
      `transactionDate DATE NOT NULL`, `postingDate DATE`,
      `currencyCode TEXT NOT NULL REFERENCES "currencyCode"("code")`,
      `exchangeRate NUMERIC NOT NULL DEFAULT 1 CHECK ("exchangeRate" > 0)`,
      `amount NUMERIC NOT NULL CHECK ("amount" >= 0)`,
      `journalId TEXT REFERENCES "journal"("id")`,
      `postedAt TIMESTAMPTZ`, `postedBy TEXT REFERENCES "user"("id")`,
      `voidedAt TIMESTAMPTZ`, `voidedBy TEXT REFERENCES "user"("id")`,
      `companyId TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE`,
      `createdBy TEXT NOT NULL REFERENCES "user"("id")`, `createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
      `updatedBy TEXT REFERENCES "user"("id")`, `updatedAt TIMESTAMPTZ`, `customFields JSONB`,
      `CONSTRAINT "cardTransaction_cardTransactionId_companyId_key" UNIQUE ("cardTransactionId","companyId")`,
      `CONSTRAINT "cardTransaction_offset_check" CHECK ("type" IN ('Charge','Credit') OR "offsetAccountId" IS NOT NULL)`
      (Payment/Cashback/Repayment need an offset account; Charge/Credit use lines).
      Indexes: `companyId`, `(companyId, status)`, `(companyId, transactionDate)`, `journalId`, `createdBy`.
   e. `cardTransactionLine` — `"id" TEXT NOT NULL PRIMARY KEY DEFAULT xid()`,
      `cardTransactionId TEXT NOT NULL REFERENCES "cardTransaction"("id") ON DELETE CASCADE`,
      `companyId TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE`,
      `accountId TEXT NOT NULL REFERENCES "account"("id")`,
      `costCenterId TEXT` (FK to `"costCenter"("id")` if that table exists — check
      `\d "costCenter"` via the newest migration referencing it; if the column on
      `purchaseInvoiceLine` has no FK, match that),
      `description TEXT`, `amount NUMERIC NOT NULL`, `sequence INTEGER NOT NULL DEFAULT 0`,
      audit columns as above. Indexes: `cardTransactionId`, `companyId`, `accountId`, `createdBy`.
   f. RLS on both tables — clone the `payment` policy shape verbatim (policy names
      `SELECT`/`INSERT`/`UPDATE`/`DELETE`, schema-qualified `"public"."cardTransaction"`):
      SELECT via `get_companies_with_employee_role()`, INSERT/UPDATE/DELETE via
      `get_companies_with_employee_permission('invoicing_create'|'invoicing_update'|'invoicing_delete')`,
      DELETE additionally requires `"status" = 'Draft'` on the header; `cardTransactionLine`
      write policies additionally require the parent to be Draft via
      `EXISTS (SELECT 1 FROM "cardTransaction" ct WHERE ct."id" = "cardTransactionId" AND ct."status" = 'Draft')`
      (mirror `invoiceSettlement` L500–540 of the precedent).
   g. Sequence backfill for existing companies (clone L560–563):
      `INSERT INTO "sequence" ("table","name","prefix","suffix","next","size","step","companyId") SELECT 'cardTransaction','Card Transaction','CARD-%{yyyy}-%{mm}-',NULL,0,6,1,c.id FROM "company" c ON CONFLICT DO NOTHING;`
3. In `packages/database/supabase/functions/lib/seed.data.ts`, find the `payment` sequence
   template entry (grep `'PAY-'`) and add the sibling `cardTransaction` entry with prefix
   `'CARD-%{yyyy}-%{mm}-'`, size 6, step 1 — same shape as payment's.
4. Apply: `pnpm db:migrate` (applies + regenerates types). If the local stack is not
   running, STOP and report — do not hand-edit generated types.

**Verify:**
```bash
pnpm db:migrate
# Expected: migration applies without error; output mentions regenerating types
grep -c "cardTransaction" packages/database/src/types.ts || grep -rc "cardTransaction" packages/database/src/ | head -3
# Expected: nonzero — generated types now include cardTransaction tables
psql "$(grep -o 'postgres[^"]*' .env.local | head -1)" -c 'SELECT 1 FROM "integration" WHERE id = '"'"'ramp'"'"';' 2>/dev/null || true
# Expected (when DB reachable): one row
```

**Out of scope:** any `itemLedger`/`costLedger` enum changes (card transactions never touch
inventory ledgers); a `bankAccount` table (belongs to the bank-reconciliation spec);
posting-immutability DB triggers (the payment sibling has none — app + RLS enforce it).

---

## Task 3: Ramp API client, payload models, webhook signature verify (@carbon/ee)

**Depends on:** none
**Files:**
- Create: `packages/ee/src/ramp/lib/models.ts`, `packages/ee/src/ramp/lib/client.ts`,
  `packages/ee/src/ramp/lib/webhook.ts`, `packages/ee/src/ramp/lib/index.ts`,
  `packages/ee/src/ramp/lib/__tests__/client.test.ts`, `.../__tests__/webhook.test.ts`
- Modify: `packages/ee/package.json` — add export `"./ramp.server": "./src/ramp/lib/index.ts"`
- Copy from (precedent): `packages/ee/src/accounting/providers/rillet/provider.ts`
  (constructor/request/pagination L360–501), `packages/ee/src/accounting/core/utils.ts`
  (`HTTPClient`, `RatelimitError`), `packages/ee/src/accounting/providers/rillet/webhook.ts`

**Steps:**
1. `models.ts` — zod schemas (all `.passthrough()`, parse-never-trust) for exactly the
   fields Carbon consumes (full field lists: research file §Answers Q1; verify names
   against Task 1 findings when available — if a field name differs, the Task 1 doc wins):
   - `RampCurrencyAmountSchema` `{ amount: z.number().int(), currency_code: z.string() }`
     + helper `fromMinorUnits(amount, currencyCode, decimals): number` (divide by
     `10^decimals` — use the `currency.decimalPlaces` value passed in, then
     `round(value, decimals)` from the shared precision module; NEVER a bare division at
     call sites).
   - `RampTransactionSchema`: `id, state, sync_status, amount fields, merchant_name,
     merchant_id, card_holder{first_name,last_name}, card_id, memo, user_transaction_time,
     accounting_date, settlement_date, currency, entity_id, original_transaction_id,
     statement_id, receipts (string[]), accounting_field_selections[{id, external_id, type,
     name, category_info}], line_items[{amount, memo, accounting_field_selections}]`.
   - `RampBillSchema`, `RampBillPaymentSchema` (nested `payment`), `RampTransferSchema`,
     `RampCashbackSchema`, `RampReimbursementSchema`, `RampRepaymentSchema`,
     `RampVendorSchema`, `RampPurchaseOrderSchema`, `RampEntitySchema`,
     `RampAccountingConnectionSchema`, `RampWebhookEventSchema`
     (`{id, type, created_at, business_id, object}`), `RampSyncResultSchema`.
   - `RampCredentialsSchema` = discriminated union on `type`:
     `client_credentials {clientId, clientSecret, environment: "production"|"sandbox"}` |
     `oauth2 {accessToken, refreshToken?, expiresAt?, environment}`.
   - `RampIntegrationMetadataSchema`: `{ credentials, cardLiabilityAccountId?,
     statementBankAccountId?, cashbackIncomeAccountId?, reimbursementBankAccountId?,
     entityId?, connectionId?, webhookId?, webhookSecret?, cursors?: { repaymentsRepaidAt?,
     purchaseOrderPushUpdatedAt?, invoicePushUpdatedAt? }, sync?: { pullTransactions?,
     pullBills?, pullReimbursements?, pushPurchaseOrders?, pushInvoices? } }` (all sync
     flags default `true` via `.default(...)`).
2. `client.ts` — `class RampClient`:
   - `constructor(credentials: RampCredentials)`; hosts
     `RAMP_PRODUCTION_HOST = "https://api.ramp.com"`, `RAMP_SANDBOX_HOST = "https://demo-api.ramp.com"`.
   - Private `getAccessToken()`: for `client_credentials`, POST `/developer/v1/token`
     (Basic auth, form body, scope list from a `RAMP_SCOPES` const matching the spec's
     Auth section); cache token in-instance with `expiresAt` and re-mint when < 60 s
     remain. For `oauth2`, return stored token (refresh flow is a later phase — throw a
     clear `"OAuth refresh not implemented — use client_credentials"` error if expired).
   - `request<T>(method, path, opts?: { body?, searchParams?, idempotencyKey? })` — fetch
     wrapper; JSON in/out; on 429 read `Retry-After` and throw a `RampRateLimitError`
     carrying it; on non-2xx parse `error_v2` and throw `RampApiError(status, code, message)`.
   - `listPaginated<T>(path, params, schema): AsyncGenerator<T[]>` — follows `page.next`
     until null, `page_size=100`, parses each row with the given zod schema.
   - Endpoint methods (thin, typed): `listTransactions(params)`, `listBills(params)`,
     `listTransfers(params)`, `listCashbacks(params)`, `listReimbursements(params)`,
     `listRepayments(params)`, `getReceipt(id)`, `createAccountingConnection(body)`,
     `getAccountingConnections()`, `deleteAccountingConnection()`, `postAccountingAccounts(batch)`,
     `patchAccountingAccount(id, body)`, `postAccountingFields(body)`, `postAccountingFieldOptions(body)`,
     `patchAccountingFieldOption(id, body)`, `postAccountingSyncs(body)`, `postReadyToSync(body)`,
     `createVendor(body)`, `listVendors(params)`, `createPurchaseOrder(body)`,
     `patchPurchaseOrder(id, body)`, `archivePurchaseOrder(id)`, `createDraftBill(body)`,
     `submitDraftBill(id)`, `archiveBill(id)`, `createWebhook(body)`, `deleteWebhook(id)`,
     `verifyWebhook(id, challenge)`, `getBusiness()`.
   - `buildRampIdempotencyKey({companyId, operation, scope}): string` — sha256 join,
     clone of `buildRilletIdempotencyKey` (provider.ts L218–226).
3. `webhook.ts` — `verifyRampWebhookSignature({ signature, body, secret }): boolean`:
   HMAC-SHA256 of the RAW body string keyed by the webhook `secret` (per Task 1 findings
   on encoding — hex vs base64; implement per the recorded evidence, default base64),
   `timingSafeEqual` compare, false on any decode error. Model on rillet/webhook.ts but
   WITHOUT the composite signed payload (Ramp signs the body only). If Task 1 showed a
   different signing scheme, follow Task 1 — and note it in the file header comment.
4. `index.ts` barrel exporting all of the above. Add `"./ramp.server": "./src/ramp/lib/index.ts"`
   to `packages/ee/package.json` exports (this module uses `node:crypto` — server-only,
   named with the `.server` convention like `./jira.server`). Restart note: new export
   subpaths 500 until dev servers restart (lessons.md) — mention in the task commit message.
5. Tests (vitest, colocated `__tests__/` like rillet):
   - webhook: valid signature passes, tampered body fails, malformed base64 fails.
   - client: `fromMinorUnits(4000, "USD", 2) === 40`, `fromMinorUnits(63, "JPY", 0) === 63`;
     token cache re-mints when expired (mock fetch); 429 → `RampRateLimitError` with
     retry-after; pagination follows `page.next` twice then stops (mock fetch).

**Verify:**
```bash
pnpm --filter @carbon/ee test -- ramp
# Expected: all ramp client + webhook tests pass
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** any `SyncFactory`/`ProviderID` registration (Ramp is NOT an accounting
provider); OAuth authorization-code flow implementation (schema supports it; flow is a
follow-up); retry loops inside the client (retries live at the job layer).

---

## Task 4: Integration config, registration, secrets, settings-drawer wiring

**Depends on:** Task 3
**Files:**
- Create: `packages/ee/src/ramp/config.tsx`
- Modify: `packages/ee/src/index.ts` — import `Ramp`, add to `integrations` array, re-export
- Modify: `packages/ee/src/integrations/secrets.ts` — add `ramp` to `SECRET_KEYS`
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` — fold/unfold + `FORM_SECRET_INTEGRATIONS` + `dynamicOptions`
- Copy from (precedent): `packages/ee/src/rillet/config.tsx` (defineIntegration shape, inline SVG Logo, SetupInstructions webhook URL), `integrations.$id.tsx` L108–169 (`foldRilletCredentials`/`unfoldRilletCredentials`), L664–674 (loader unfold + dynamicOptions), L1396–1446 (fold + secret-presence check)

**Steps:**
1. `config.tsx` — `export const Ramp = defineIntegration({...})`:
   - `id: "ramp"`, `name: "Ramp"`, `active: true`, `category: "Spend Management"`,
     inline `function Logo(props: ComponentProps<"svg">)` (draw the Ramp wordmark as a
     simple path or a text-free mark; height-clamped like Rillet's L140–146),
     `SetupInstructions` showing the webhook URL
     `${window.location.origin}/api/webhook/ramp/${companyId}` (isBrowser guard, clone Rillet's).
   - `settingGroups`: `Connection`, `Accounts`, `Sync`.
   - `settings` (types per `IntegrationSetting`):
     - `clientId` — `type: "text"`, group Connection, required.
     - `clientSecret` — `type: "secret"`, group Connection, required.
     - `environment` — `type: "options"`, listOptions production (api.ramp.com) /
       sandbox (demo-api.ramp.com), required, default "production".
     - `entityId` — `type: "text"`, group Connection, optional, description "Limit sync
       to one Ramp entity (leave blank for all)".
     - `cardLiabilityAccountId` — `type: "options"`, group Accounts, required,
       `listOptions: []` (filled by loader `dynamicOptions`).
     - `statementBankAccountId` — `type: "options"`, group Accounts, required, `listOptions: []`.
     - `cashbackIncomeAccountId` — `type: "options"`, group Accounts, optional, `listOptions: []`.
     - `reimbursementBankAccountId` — `type: "options"`, group Accounts, optional, `listOptions: []`.
     - `pullTransactions`, `pullBills`, `pullReimbursements`, `pushPurchaseOrders`,
       `pushInvoices` — `type: "switch"`, group Sync, default `"true"`.
   - `schema`: zod object with those flat fields (`clientId: z.string().min(1)`,
     `clientSecret: z.string().optional()` (empty = unchanged on re-save),
     `environment: z.enum(["production","sandbox"]).default("production")`, account ids
     `z.string().optional()` except `cardLiabilityAccountId`/`statementBankAccountId`
     required non-empty, switches `z.string().optional()`).
2. `packages/ee/src/index.ts`: `import { Ramp } from "./ramp/config";` + add `Ramp,` to the
   `integrations` array (alphabetical position after QuickBooks/before Rillet is fine) +
   `export { Ramp } from "./ramp/config";`.
3. `secrets.ts`: add `ramp: ["credentials.clientSecret", "credentials.accessToken", "credentials.refreshToken", "webhookSecret"],`.
4. `integrations.$id.tsx`:
   - Add `foldRampCredentials(metadata)` beside `foldRilletCredentials` (L108): pull flat
     `clientId`/`clientSecret`/`environment` into
     `metadata.credentials = { type: "client_credentials", clientId, clientSecret, environment }`
     (preserve an existing stored `clientSecret` when the form field arrives empty —
     mirror Rillet's empty-means-unchanged handling), delete the flat keys, keep the
     account-mapping/switch fields flat at metadata root. Add `unfoldRampCredentials` for
     the loader prefill. Branch both where Rillet branches (`if (integrationId === "ramp")`,
     L1396–1399 and L664–666).
   - Add `"ramp"` to `FORM_SECRET_INTEGRATIONS` (L1422–1427).
   - In the loader where `dynamicOptions` is returned empty (L671–674): when
     `params.id === "ramp"`, populate it from the chart of accounts — fetch leaf accounts
     (the same source `useAccounts` hits; server-side use the accounts service the
     `api.accounts` route uses — grep `path.to.api.accounts` for its loader, reuse its
     service call `getAccountsList(client, companyId)` or equivalent) and build
     `{ cardLiabilityAccountId: liabilityOptions, statementBankAccountId: assetOptions,
       cashbackIncomeAccountId: incomeOptions, reimbursementBankAccountId: assetOptions }`
     where each option is `{ value: account.id, label: `${number} ${name}` }`, filtered by
     account class (`Liability` / `Asset` / `Revenue` respectively), `isGroup = false`.
     If the account list exceeds 5 options the drawer automatically renders a Select
     (CHOICE_CARD_MAX_OPTIONS) — no extra work.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: exit 0
grep -n '"ramp"' packages/ee/src/integrations/secrets.ts apps/erp/app/routes/x+/settings+/integrations.$id.tsx | head -5
# Expected: SECRET_KEYS entry + FORM_SECRET_INTEGRATIONS entry + fold branches present
```

**Out of scope:** OAuth callback route; the Account Mapping/Posting/Dimensions tabs (those
are accounting-provider tabs — Ramp uses plain settings fields); any change to
`IntegrationSetting` type union.

---

## Task 5: Ramp service (connection, CoA/cost-center push, queues, confirms) + server hooks

**Depends on:** Tasks 3, 4
**Files:**
- Create: `packages/ee/src/ramp/lib/service.ts` (add to the Task 3 barrel)
- Create: `packages/ee/src/ramp/hooks.server.ts`
- Modify: `packages/ee/src/hooks.server.ts` — register ramp hooks
- Modify: `packages/ee/package.json` — add `"./ramp/hooks.server": "./src/ramp/hooks.server.ts"`
- Copy from (precedent): `packages/ee/src/rillet/hooks.server.ts`, `packages/ee/src/hooks.server.ts` L60–65

**Steps:**
1. `service.ts` — functions all take `(serviceRole: SupabaseClient<Database>, companyId: string, ...)`
   and load metadata via `getIntegration` + `resolveIntegrationSecrets` (import from
   `../../integrations/secrets`), then construct `RampClient`:
   - `getRampIntegration(serviceRole, companyId)` → `{ client: RampClient, metadata: RampIntegrationMetadata } | null`
     (null when not installed/active). Parse metadata with `RampIntegrationMetadataSchema`.
   - `ensureRampConnection(serviceRole, companyId)` — if `metadata.connectionId` unset:
     `createAccountingConnection({ remote_provider_name: "Carbon" })` (reactivate path per
     Task 1 findings), store `connectionId` back into `companyIntegration.metadata` via a
     raw read-merge-update (clone `storePullCursor`'s read-modify-write shape from
     `accounting-pull-sweep.ts` L379–407).
   - `pushChartOfAccounts(serviceRole, companyId)` — fetch active non-group accounts
     (`client.from("account").select("id, number, name, class").eq("companyId", companyId).eq("isGroup", false).eq("active", true)`
     — check the actual column names in the generated types; `active` may be `active` or
     absent — match reality), map class → Ramp `classification`
     (Asset→ASSET, Liability→LIABILITY, Equity→EQUITY, Revenue→REVENUE, Expense→EXPENSE;
     the account mapped as `cardLiabilityAccountId` → CREDCARD), batch ≤500 →
     `postAccountingAccounts`. Re-push is an upsert per Ramp semantics (POST with existing
     id reactivates/updates — confirm per Task 1; if POST duplicates instead, use PATCH
     for existing ids tracked via a `coaPushedAt` metadata stamp).
   - `pushCostCenters(serviceRole, companyId)` — if a `costCenter` table exists with rows
     for the company: `postAccountingFields({ id: "carbon-cost-center", name: "Cost Center",
     input_type: "SINGLE_CHOICE", is_splittable: true })` then `postAccountingFieldOptions`
     with `{ field_id, options: [{ id: costCenter.id, value: name }] }`. If the table does
     not exist, skip silently (function returns `{ pushed: 0 }`).
   - `ensureRampWebhook(serviceRole, companyId, originUrl)` — create webhook
     (`endpoint_url: ${originUrl}/api/webhook/ramp/${companyId}`, event_types per spec §Install
     step 5), persist `webhookId` to metadata and the returned `secret` via
     `persistIntegrationSecrets` (it lives under the `webhookSecret` SECRET_KEYS path).
     `originUrl` comes from the caller (the install hook reads the app origin —
     grep how Onshape's `ensureOnshapeReleaseWebhook` obtains it and copy that mechanism;
     if it uses an env var like `VERCEL_URL`/app URL, use the same one).
   - `completeWebhookVerification(serviceRole, companyId, challenge)` — calls
     `verifyWebhook(webhookId, challenge)`.
   - `confirmSyncs(serviceRole, companyId, args: { syncType, successful: Array<{id, referenceId, deepLinkUrl?}>, failed: Array<{id, message}> })`
     — builds `postAccountingSyncs` body with
     `idempotency_key = buildRampIdempotencyKey({companyId, operation: syncType, scope: sha256(sortedIds)})`.
   - `resolveRampSupplier(serviceRole, companyId, vendor: {id?, name}, userId)` —
     mapping-first (`createMappingService(db, companyId).getEntityId("ramp", vendor.id, "vendor")`
     — Kysely handle via `getJobDatabaseClient` is jobs-side; HERE accept a Kysely handle
     param instead so the job passes its own), then case-insensitive exact name match on
     `supplier.name`, then `insertSupplier(client, { name, companyId, createdBy: userId })`
     + `link(...)`. Returns `supplierId`.
2. `hooks.server.ts` — clone rillet's shape:
   - `rampOnInstall(companyId)`: serviceRole = `getCarbonServiceRole()`; validate creds
     (`client.getBusiness()` — throw with a clear message on 401), `ensureRampConnection`,
     `pushChartOfAccounts`, `pushCostCenters`, `ensureRampWebhook`, then
     `trigger("ramp-sync", { companyId, reason: "install" })` (lazy-import `trigger` from
     `@carbon/jobs` like the rillet webhook route does).
   - `rampOnUpdate = rampOnInstall` semantics BUT skip webhook re-create when `webhookId`
     already set (idempotent re-converge).
   - `rampOnUninstall(companyId)`: delete webhook (`deleteWebhook(webhookId)`, tolerate 404),
     `deleteAccountingConnection()` (tolerate error — record log), no event-system
     subscriptions to clean (Ramp uses none).
   - `rampHealthcheck(companyId, metadata)`: construct client from metadata, `getBusiness()`
     + `getAccountingConnections()` — healthy only if a connection with status `linked`/
     active exists.
   - Register in `packages/ee/src/hooks.server.ts`:
     `ramp: { onInstall: rampOnInstall, onUpdate: rampOnUpdate, onUninstall: rampOnUninstall, onHealthcheck: rampHealthcheck },`.
3. Unit-test the pure mapping bits (class→classification map, batch chunking ≤500) in
   `__tests__/service.test.ts`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- ramp
# Expected: service tests pass alongside client/webhook tests
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** the Inngest functions (Task 7); accounting-vendor upload (excluded by
user decision 4); pushing customers/items/suppliers as coding fields.

---

## Task 6: post-card-transaction edge function + pure journal builder + tests

**Depends on:** Task 2
**Files:**
- Create: `packages/database/supabase/functions/post-card-transaction/index.ts`
- Create: `packages/database/supabase/functions/post-card-transaction/build-card-transaction-journal.ts`
- Create: `packages/database/supabase/functions/post-card-transaction/post-card-transaction.test.ts`
- Modify: `packages/database/supabase/config.toml` — add `[functions.post-card-transaction]` entry
- Copy from (precedent): `packages/database/supabase/functions/post-payment/index.ts` +
  `build-payment-journal.ts` + `post-payment.test.ts` (the exact split-file pattern)

**Steps:**
1. `build-card-transaction-journal.ts` — PURE (no DB/IO/clock). Input:
   `{ transaction: { type, amount, cardAccountId, offsetAccountId, currencyCode, exchangeRate },
      lines: Array<{ accountId, amount, costCenterId?, description? }>,
      accounts: Record<accountId, { class: "Asset"|"Liability"|"Equity"|"Revenue"|"Expense" }>,
      documentId, documentReadableId }`.
   Output: `{ journalLines: Array<{ accountId, amount, description, documentType: 'Card Transaction',
   documentId, costCenterId? }> }`. Amounts are NATURAL-BALANCE-SIGNED via the `credit()`/
   `debit()` helpers from `../lib/utils.ts` (lessons.md: journal amounts are natural-signed;
   `credit("liability", x)` stores `+x`). Per type:
   - `Charge`: for each line `debit(lineClass, line.amount)` on `line.accountId`;
     `credit("liability", total)` on `cardAccountId`.
   - `Credit`: mirror image (debit card account, credit each line account).
   - `Payment`: `debit("liability", amount)` on `cardAccountId`; `credit(offsetClass, amount)`
     on `offsetAccountId` (offset is an Asset bank account → `credit("asset", x)` = −x).
   - `Cashback`: `debit("liability", amount)` on `cardAccountId`; `credit("revenue", amount)`
     on `offsetAccountId`.
   - `Repayment`: `debit(offsetClass, amount)` on `offsetAccountId` (bank asset or card
     liability per funding); for each line `credit(lineClass, line.amount)`.
   End with the same balanced assertion post-payment uses (`assertBalanced` from
   `../shared/precision.ts`, label "Card transaction journal").
   Validate: line sum equals header amount for line-bearing types (Charge/Credit/Repayment);
   throw a typed error naming the mismatch otherwise.
2. `index.ts` — clone post-payment's driver shape: pool `getConnectionPool(1)` at module
   scope; payload `z.object({ type: z.enum(["post","void"]).default("post"),
   cardTransactionId: z.string(), userId: z.string(), companyId: z.string() })`;
   `getSupabaseServiceRole(...)` client; read `companySettings.accountingEnabled` — when
   false, flip status only (no journal), matching other post-* functions; fetch the
   `cardTransaction` + `cardTransactionLine` rows + the referenced `account` rows (id,
   class); resolve the accounting period with `getAccountingPeriodForDate(client, companyId,
   db, postingDate)` from `../shared/get-accounting-period.ts` — if it throws
   Locked/Closed, catch and retry with the first day of the next open period, writing the
   shifted date back to `cardTransaction.postingDate` (spec: period-shift behavior);
   in ONE `db.transaction()`: lock the row `FOR UPDATE`, re-assert `status = 'Draft'`
   (post) / `'Posted'` (void), `getNextSequence(trx, "journalEntry", companyId)`, insert
   `journal` (`sourceType: 'Card Transaction'`, `status: 'Posted'`) + `journalLine` rows +
   `journalLineDimension` rows for lines with `costCenterId` (copy exactly how post-payment
   writes dimensions — if post-payment writes none, copy the dimension-insert shape from
   `post-purchase-invoice`), update `cardTransaction` → `status 'Posted'`, `journalId`,
   `postingDate`, `postedAt/postedBy`. Void: build the reversing journal (negate every
   line), insert, set `status 'Voided'`, `voidedAt/voidedBy`.
3. `post-card-transaction.test.ts` — deno tests for the PURE builder only (like
   post-payment.test.ts): one golden case per type (Charge with 2 split lines, Credit,
   Payment, Cashback, Repayment), assert exact signed line sets and the imbalance throw.
4. `config.toml`: append
   `[functions.post-card-transaction]` / `enabled = true` / `verify_jwt = true` /
   `entrypoint = "./functions/post-card-transaction/index.ts"` (matching the
   post-inventory-adjustment entry shape). Note: several post-* functions are absent from
   config.toml yet deployed — the entry is harmless and satisfies the documented deploy
   rule; do not remove others.

**Verify:**
```bash
cd packages/database/supabase/functions/post-card-transaction && deno test build-card-transaction-journal* post-card-transaction.test.ts 2>/dev/null || deno test .
# Expected: all builder tests pass (5 types + imbalance case)
```
(deno check is not gated — edge functions aren't deno-check-clean repo-wide; gate on
own-file test pass, per lessons.md.)

**Out of scope:** `itemLedger`/`costLedger` writes (never — card transactions carry no
inventory); `requirePermissions` inside the function (service-role invoked; the caller
authorizes — same as post-payment).

---

## Task 7: ramp-sync Inngest function (card family inbound) + ramp-sweep cron + registration

**Depends on:** Tasks 2, 5, 6
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync.ts`
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sweep.ts`
- Modify: `packages/jobs/src/inngest/functions/integrations/index.ts` — export both
- Modify: `packages/jobs/src/inngest/index.ts` — import + add to `functions` array
- Modify: `packages/lib/src/trigger.ts` — add `"ramp-sync": "carbon/ramp-sync",`
- Modify: `packages/lib/src/events.ts` — add `"carbon/ramp-sync": { data: { companyId: string; reason?: string } }`
- Copy from (precedent): `packages/jobs/src/inngest/functions/integrations/accounting-pull-sweep.ts`
  (integration listing L409–434, metadata read-modify-write L379–407),
  `scheduled/update-exchange-rates.ts` (cron skeleton), `accounting-outbound-sweep.ts`
  L339–357 (notification), `packages/ee/src/accounting/core/payment-syncer.ts` L248–260
  (edge-fn invoke)
- Copy from (attachments): `packages/jobs/src/inngest/functions/integrations/onshape-attach.ts`
  (private-bucket upload + document row, L128–166)

**Steps:**
1. `ramp-sync.ts` — `inngest.createFunction({ id: "ramp-sync", retries: 2, concurrency:
   { key: "event.data.companyId", limit: 1 } }, { event: "carbon/ramp-sync" }, handler)`.
   Handler: `getCarbonServiceRole()`; `getRampIntegration(...)` (Task 5) — return early if
   null; `createMappingService(getJobDatabaseClient(5), companyId)`. Then one `step.run`
   per family, each independent (a family's failure must never abort the others — wrap
   each in its own try/catch and continue; lessons.md: one family's listing failure must
   not discard another's):
   a. **Card transactions** (`metadata.sync.pullTransactions`): drain
      `listTransactions({ sync_status: "SYNC_READY", ...(entityId && { entity_id: entityId }) })`.
      Per transaction: skip if `mapping.getEntityId("ramp", tx.id, "cardTransaction")`
      exists → add to `successful` re-confirm batch. Otherwise: resolve coding — every
      `accounting_field_selections` of `type: "GL_ACCOUNT"` on each line (or the
      body-level selections when no line_items) maps via `external_id` → Carbon account id;
      verify the account exists (`.from("account").select("id, class").in("id", ids)`);
      a missing/unknown account → `failed` with message
      `"Line is coded to an account Carbon doesn't recognize — recode the transaction"`
      and CREATE NOTHING. Cost-center selections (`external_id` → costCenter id) map to
      line `costCenterId`. Build amount via `fromMinorUnits` + the company currency
      decimals (`.from("currencyCode")` lookup, cache per run). `type` = `Credit` when the
      amount is negative or `original_transaction_id` set (use absolute amount), else
      `Charge`. Insert `cardTransaction` (readable id via
      `client.rpc("get_next_sequence", ...)` — copy the exact rpc call shape from
      `invoicing.service.ts` L527) + `cardTransactionLine` rows (one per Ramp line item;
      single synthetic line from body coding when unsplit), `cardAccountId` =
      `metadata.cardLiabilityAccountId`, `transactionDate` = date part of
      `user_transaction_time`, `postingDate` = `accounting_date` date part,
      `createdBy: "system"`. Invoke
      `serviceRole.functions.invoke("post-card-transaction", { body: { type: "post", cardTransactionId, userId: "system", companyId } })`
      — on error: delete the Draft row + add to `failed`. On success: `mapping.link(...)`,
      fetch receipts (`getReceipt(id)` → download `receipt_url` bytes → upload to
      `private` bucket at `${companyId}/card-transaction/${id}/${sanitized}` + `document`
      row, clone onshape-attach; receipt failure is non-fatal — log and continue), add to
      `successful` with `referenceId = cardTransactionId` readable id and `deepLinkUrl`
      pointing at the card-transactions list route.
      After the page loop: `confirmSyncs(..., { syncType: "TRANSACTION_SYNC", successful, failed })`.
   b. **Transfers**: same drain with `listTransfers({ sync_status: "SYNC_READY" })` →
      `cardTransaction` type `Payment`, no lines, `offsetAccountId = metadata.statementBankAccountId`,
      amount from transfer amount; post; confirm `TRANSFER_SYNC`.
   c. **Cashbacks**: only when `metadata.cashbackIncomeAccountId` set (else skip family
      silently — spec decision); type `Cashback`, `offsetAccountId = cashbackIncomeAccountId`;
      confirm `STATEMENT_CREDIT_SYNC`.
   d. Placeholder step names for bills/reimbursements/repayments/outbound are NOT added
      here — Tasks 8–10 add their own `step.run` blocks to this same function.
   e. Final step: when any family had `failed.length > 0`, fire the notification —
      clone accounting-outbound-sweep L339–357: `trigger("notify", { event:
      NotificationEvent.IntegrationSync, companyId, documentId: "ramp", title:
      "Ramp sync needs attention", body: "<n> item(s) failed to sync — review the
      Accounting tab in Ramp", recipient: { type: "user", userId: integration.updatedBy } })`
      guarded for `"system"`.
2. `ramp-sweep.ts` — `inngest.createFunction({ id: "ramp-sweep", retries: 2 },
   { cron: "0 * * * *" }, handler)`: list
   `.from("companyIntegration").select("companyId").eq("id", "ramp").eq("active", true)`,
   then `step.sendEvent` (or `trigger`) one `carbon/ramp-sync` per company with
   `reason: "sweep"`.
3. Register: exports in `integrations/index.ts`; `packages/jobs/src/inngest/index.ts`
   import block + `functions` array (Integrations group); `taskToEvent` + `Events` entries.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/lib
# Expected: exit 0
pnpm --filter @carbon/jobs test -- ramp 2>/dev/null || echo "no ramp jobs tests yet (ok)"
# Expected: typecheck green; any added unit tests pass
```

**Out of scope:** bills/reimbursements/repayments families (Tasks 8–9); outbound (Task 10);
`debounce` on the Inngest function (local dev server can't handle it — lessons.md);
event-system subscriptions (SYNC handler is ProviderID-locked).

---

## Task 8: Bills + bill-payments inbound

**Depends on:** Tasks 1, 7
**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync.ts` — add two `step.run` families
- Modify: `packages/ee/src/ramp/lib/service.ts` — add `resolveRampSupplier` consumers as needed
- Copy from (precedent): `packages/ee/src/accounting/core/payment-application.ts`
  (`upsertLocalPaymentDraft` Draft-payment + settlement shape),
  `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.post.tsx` L36–46 (post invoke + revert),
  `apps/erp/app/modules/invoicing/invoicing.service.ts` L130–145 (`createPurchaseInvoiceFromPurchaseOrder`),
  L527 (`get_next_sequence` rpc), L1676 (`upsertPayment` insert shape)

**Steps:**
1. **Bills family** (`metadata.sync.pullBills`), drain
   `listBills({ sync_ready: true, sync_status: "NOT_SYNCED" })`:
   - Mapping short-circuit: `mapping.getEntityId("ramp", bill.id, "bill")` exists → add to
     `successful` for `BILL_SYNC` re-confirm.
   - Carbon-born short-circuit: `bill.remote_id` (or the draft-mapping from Task 10) maps
     to an existing `purchaseInvoice` → `mapping.link("bill", invoiceId, "ramp", bill.id)`
     + confirm — do NOT create a second invoice.
   - Supplier: `resolveRampSupplier` (mapping → name → `insertSupplier` auto-create).
   - Duplicate guard: an existing invoice with same `supplierId` +
     `supplierReference = bill.invoice_number` (non-empty) → link + confirm, skip create.
   - PO-linked: when `bill.purchase_order_ids` contains an id whose mapping
     (`mapping.getEntityId("ramp", rampPoId, "purchaseOrder")`) resolves to a Carbon PO →
     invoke `convert` (`{ type: "purchaseOrderToPurchaseInvoice", id: carbonPoId, companyId, userId: "system" }`
     via `serviceRole.functions.invoke`), then update the created invoice's header
     (`supplierReference = invoice_number`, `dateIssued`/`dateDue` from bill) and
     reconcile line amounts: for each invoice line whose `purchaseOrderLineId` maps to a
     Ramp `purchase_order_line_item_id` matched on the bill, set `quantity`/`unitPrice`
     so the line total equals the bill line amount; delete created lines the bill doesn't
     cover. If reconciliation cannot reach the bill total exactly, add a G/L Account
     adjustment line coded to the bill's line coding. If `convert` errors, fall through to
     the standalone path below and note it in the failed message? NO — a convert error is
     a real failure: add to `failed` with its message, create nothing.
   - Standalone (no PO): insert `purchaseInvoice`
     (`invoiceId` via `client.rpc("get_next_sequence", { sequence_name: "purchaseInvoice", company_id })`
     — copy the EXACT rpc arg names from invoicing.service.ts L527; `status 'Draft'`,
     `supplierId`, `supplierReference = invoice_number`, `currencyCode`,
     `dateIssued = issued_at`, `dateDue = due_at`) + `purchaseInvoiceLine` rows of
     `invoiceLineType 'G/L Account'` with `accountNumber`/`accountId` from the line coding
     (check which column post-purchase-invoice reads for G/L lines — grep
     `"G/L Account"` in `post-purchase-invoice/index.ts` and set the column it reads),
     quantity 1, unitPrice = line amount, `costCenterId` when coded.
   - Post: set `status 'Pending'`, invoke `post-purchase-invoice`
     (`{ invoiceId, userId: "system", companyId }`), revert to `'Draft'` + `failed` on
     error (clone the route's revert). On success `mapping.link` + `successful`
     (`referenceId` = readable invoiceId, `deepLinkUrl` = invoice route URL).
   - Attach `invoice_urls` PDFs like receipts in Task 7 (non-fatal).
   - Confirm `BILL_SYNC`.
2. **Bill payments family**, drain `listBills({ sync_ready: true, sync_status: "BILL_SYNCED" })`
   filtered client-side to `status === "PAID"`:
   - Guard: `payment.payment_method` in `CARD`/`ONE_TIME_CARD`/`AUTOMATIC_CARD_PAYMENT` →
     confirm as successful WITHOUT posting (Ramp routes card-paid bills through card
     accounting; assert-and-skip per spec) and log.
   - Resolve the Carbon invoice via mapping (`"bill"` entityType). Missing → `failed`
     ("Bill was never synced to Carbon — sync the bill first").
   - Idempotency: existing mapping for `("payment", ramp payment.id)` → re-confirm only.
   - Create Draft `payment` row (clone `upsertPayment` insert fields: `paymentId` via
     `get_next_sequence` `"payment"`, `paymentType 'Disbursement'`, `supplierId`,
     `paymentDate = payment.effective_date ?? payment_date`, `currencyCode`,
     `totalAmount`, `bankAccount = metadata.statementBankAccountId`, `memo`,
     `companyId`, `createdBy: "system"`) + one `invoiceSettlement`
     (`paymentId`, `targetPurchaseInvoiceId`, `appliedAmount`, source/target exchange
     rates 1 unless invoice carries one — copy the column set from
     `payment-application.ts` `upsertLocalPaymentDraft`), then invoke `post-payment`
     (`{ type: "post", paymentId, userId: "system", companyId }`). Error → delete draft
     rows + `failed`.
   - `mapping.link("payment", paymentRowId, "ramp", bill.payment.id)`; confirm
     `BILL_PAYMENT_SYNC`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
# Manual (dev stack + sandbox): create+approve+pay a sandbox bill (⌘J "pay current bill"),
# run: curl -s -X POST localhost:<inngest-dev-port>/... or wait for the sweep, then
psql <local-db> -c 'SELECT "invoiceId", status FROM "purchaseInvoice" ORDER BY "createdAt" DESC LIMIT 3;'
# Expected: the Ramp bill's invoice present; after payment pull, purchaseInvoices view shows Paid
```

**Out of scope:** vendor-credit application (`applied_vendor_credits` — v1 ignores; a bill
carrying them fails with an actionable message "vendor credits not supported yet");
multi-PO bills beyond the first mapped PO (post standalone with a note in memo);
`inventory_line_items` as item-typed lines (always G/L lines in v1).

---

## Task 9: Reimbursements + repayments inbound

**Depends on:** Tasks 1, 8
**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync.ts` — add two families
- Modify: `packages/ee/src/ramp/lib/service.ts` — add `resolveEmployeeSupplier`
- Copy from (precedent): supplier creation `purchasing.service.ts` `insertSupplier` L981–990,
  `upsertSupplierType` L2410–2436; payment creation from Task 8

**Steps:**
1. `resolveEmployeeSupplier(client, kyselyDb, companyId, rampUser: {user_id, first_name,
   last_name, email})`: mapping `("vendor", ramp user_id)` → done. Else ensure the
   "Employee" `supplierType` exists (select by `name = 'Employee'` + companyId; create via
   `upsertSupplierType` when missing), `insertSupplier({ name: "<First> <Last> (<email>)",
   supplierTypeId, companyId, createdBy: "system" })`, link mapping.
2. **Reimbursements family** (`metadata.sync.pullReimbursements`), drain
   `listReimbursements({ sync_status: "SYNC_READY" })`:
   - Mapping short-circuit on `("bill", reimbursement.id)` (reuse `bill` entityType with
     the Ramp reimbursement id — distinct id space, same document class) → re-confirm.
   - Employee supplier via step 1. Build `purchaseInvoice` exactly like Task 8's
     standalone path: G/L lines from `line_items[].accounting_field_selections` (or
     body-level), `supplierReference = "RAMP-REIMB-" + id`, dates from
     `transaction_date`/`approved_at`. Post it.
   - Ramp-paid (state REIMBURSED / payment fields present): create + post the `payment` +
     `invoiceSettlement` against it (Task 8 shape; `bankAccount =
     metadata.reimbursementBankAccountId ?? metadata.statementBankAccountId`).
     Manual-pay (state APPROVED but payout manual — per Task 1 findings on which field
     distinguishes): leave the invoice Open, no payment.
   - Confirm `REIMBURSEMENT_SYNC` with the invoice as `reference_id`.
3. **Repayments family**, cursor-based (no queue):
   - Read `metadata.cursors.repaymentsRepaidAt` (default: integration row `updatedAt`, the
     connect time — clone `getPullCursorDecision`'s default logic inline, simplified).
   - `listRepayments({ from_repaid_at: cursor })` client-filtered to `status === "REPAID"`.
   - Per repayment: mapping short-circuit `("cardTransaction", "repayment:" + id)`.
     Resolve the ORIGINAL card transaction via `("cardTransaction", original_transaction_id)`
     mapping → load its posted `cardTransaction` + lines. Missing → `failed`-style log
     (no Ramp confirm exists) + skip WITHOUT advancing past it permanently: collect its
     `repaid_at`; the cursor advance below uses the MINIMUM of failed items' repaid_at
     minus 1s, so it retries next sweep (Celigo cursor rule — only advance over provably
     covered work).
   - Create `cardTransaction` type `Repayment`: `offsetAccountId` =
     `statementBankAccountId` for bank funding, `cardLiabilityAccountId` for
     statement-credit funding (branch on `funding_method` per Task 1 findings);
     lines = the original's lines scaled by `repayment_amount / original.amount`, each
     amount rounded at the currency's decimals, with any residual cent added to the
     largest line so the sum equals the header exactly. Post via edge fn. Link mapping.
   - If Task 1 found a working confirm path for repayments, confirm with that sync_type;
     otherwise none (mapping is the idempotency).
   - Advance `metadata.cursors.repaymentsRepaidAt` to
     `min(max(processed repaid_at), min(failed repaid_at) - 1s)` via the read-merge-update
     helper.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/ee
# Expected: exit 0
pnpm --filter @carbon/ee test -- ramp
# Expected: scaling/rounding unit test passes (add one: 3-line original, repayment of half,
# line sum equals header exactly with residual on largest line)
```

**Out of scope:** mileage/per-diem special handling (they arrive as ordinary reimbursement
line items); batch payout grouping (one invoice+payment per reimbursement, matching Ramp
first-party); USER_TO_BUSINESS reimbursement direction beyond repayments.

---

## Task 10: Outbound — PO push, invoice draft-bill push, archive-on-settlement

**Depends on:** Tasks 1, 5
**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync.ts` — add outbound step
- Modify: `packages/ee/src/ramp/lib/service.ts` — `pushPurchaseOrder`, `pushInvoiceDraftBill`, `archiveRampBillForInvoice`
- Copy from (precedent): cursor read-merge-update from Task 7/9; Ramp vendor creation via `createVendor`

**Steps:**
1. **PO push** (`metadata.sync.pushPurchaseOrders`), cursor
   `metadata.cursors.purchaseOrderPushUpdatedAt`:
   - Query `purchaseOrder` rows with `updatedAt > cursor` (Kysely; include `status`,
     joined `purchaseOrderPayment.currencyCode`, supplier name, lines with amounts) whose
     status is NOT in (`Draft`, `Needs Approval`, `Rejected`, `Planned`).
   - Per PO: ensure a Ramp vendor exists for the supplier — mapping
     `("vendor" reversed: getExternalId("vendor", supplierId... )` NOTE: mapping stores
     Carbon→external; use `getExternalId("vendor", supplierId, "ramp")`; when null,
     `createVendor({ name: supplier.name })` + `link` with `allowDuplicateExternalId`
     default. Then create or update the Ramp PO:
     existing mapping `getExternalId("purchaseOrder", poId, "ramp")` → `patchPurchaseOrder`;
     else `createPurchaseOrder({ purchase_order_number: readable purchaseOrderId,
     vendor_id, entity_id (metadata.entityId when set), remote_id: po.id,
     line_items: lines.map(l => ({ description, quantity, unit_price, remote_id: l.id })) })`
     (exact accepted body fields per Task 1 findings — if `remote_id` is rejected there,
     STOP and report; the matching flow depends on it). Link mapping.
   - Completed/Closed POs with a mapping → `archivePurchaseOrder`.
   - Advance the cursor (max processed `updatedAt`; failures hold it back as in Task 9).
2. **Invoice draft push** (`metadata.sync.pushInvoices`), cursor
   `metadata.cursors.invoicePushUpdatedAt`:
   - Query posted purchase invoices with `updatedAt > cursor`, view-status in
     (`Open`, `Partially Paid` — exclude `Paid`/`Voided`/`Draft`/`Pending`), no existing
     `("bill", invoiceId)` mapping, AND not created by the Ramp sync itself (skip when a
     mapping exists in either direction — the Task 8 dedupe key).
   - Skip invoices whose supplier is the "Employee" type (reimbursement invoices never push).
   - Per invoice: ensure Ramp vendor (as above); `createDraftBill({ vendor_id,
     invoice_number: supplierReference ?? readable invoiceId, invoice_currency,
     issued_at, due_at, line_items: [...amounts + memo], ...(remote_id accepted per Task 1
     ? { remote_id: invoice.id } : {}) })`, attach the invoice PDF if one exists in
     storage (locate via the invoice's supplier-interaction document path; skip silently
     when absent), then `submitDraftBill(id)`. Link `("bill", invoiceId, "ramp", draftBillOrBillId)`
     — per Task 1, record WHICH id (draft id vs bill id) the submit returns and store that.
   - Advance cursor.
3. **Archive-on-settlement**: same step, query mapped invoices (`getAllByIntegration`
   filtered `entityType 'bill'`) whose view-status is now `Paid` or `Voided` AND whose
   mapping metadata lacks `rampPaid: true` (set that flag when Task 8's payment pull
   settles it — meaning Ramp itself paid): call `archiveBill(externalId)` (tolerate
   "already paid/archived" errors by logging), stamp mapping metadata `archived: true`
   via `link(...)` merge so it never re-fires.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/ee
# Expected: exit 0
# Manual (dev stack + sandbox): release a Carbon PO; after the next ramp-sync run:
# GET /developer/v1/purchase-orders?remote_id=<carbon po id> returns it (curl with sandbox token).
# Post a Carbon purchase invoice; verify a SUBMITTED draft bill appears in demo.ramp.com Bill Pay
# in Pending approval (NOT auto-approved).
```

**Out of scope:** change orders on pushed POs beyond field PATCH; pushing PO attachments;
bill payment method/date selection (chosen in Ramp); any automatic `POST /bills`
(auto-approved path — never).

---

## Task 11: Invoicing module models/service + path helpers

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` — card-transaction types/validators
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — reads + void
- Modify: `apps/erp/app/modules/invoicing/index.ts` — barrel exports (match existing style)
- Modify: `apps/erp/app/utils/path.ts` — `cardTransactions`, `cardTransaction(id)` helpers
- Copy from (precedent): the payment blocks — `invoicing.models.ts` L356–396,
  `invoicing.service.ts` `getPayments` L1256 / `getPayment` L1252

**Steps:**
1. `invoicing.models.ts`: `cardTransactionType = ["Charge","Credit","Payment","Cashback","Repayment"] as const`,
   `cardTransactionStatus = ["Draft","Posted","Voided"] as const`, derived types
   `CardTransactionType`/`CardTransactionStatusType`, `isCardTransactionLocked(status) =>
   status !== "Draft"` — mirroring the payment block shape exactly.
2. `invoicing.service.ts`:
   - `getCardTransactions(client, companyId, args: GenericQueryFilters & { search: string | null; type: CardTransactionType | null; status: CardTransactionStatusType | null })`
     — clone `getPayments` (setGenericQueryFilters, default sort `cardTransactionId desc`,
     search on `cardTransactionId`/`merchantName`).
   - `getCardTransaction(client, id)` — single row with lines
     (`.select("*, cardTransactionLine(*)")`).
   - `voidCardTransaction` is NOT a service mutation — voiding invokes the edge function
     from the route action (like payments' `$paymentId.void.tsx`); no service change needed
     beyond reads.
3. `path.ts`: add `cardTransactions: \`${x}/invoicing/card-transactions\`` and
   `cardTransaction: (id: string) => ...\`${x}/invoicing/card-transactions/${id}\`` next to
   the payments entries (grep `payments:` in path.ts and mirror the exact style).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** create/edit validators (card transactions are sync-created, never
user-created in v1); MES.

---

## Task 12: UI — card transactions list/drawer, nav, invoice Ramp badge

**Depends on:** Task 11
**Files:**
- Create: `apps/erp/app/modules/invoicing/ui/CardTransaction/CardTransactionsTable.tsx`,
  `.../CardTransactionStatus.tsx`, `.../index.ts`
- Create: `apps/erp/app/routes/x+/invoicing+/card-transactions.tsx` (list),
  `apps/erp/app/routes/x+/invoicing+/card-transactions.$id.tsx` (detail Drawer via Outlet),
  `apps/erp/app/routes/x+/invoicing+/card-transactions.$id.void.tsx` (action)
- Modify: `apps/erp/app/modules/invoicing/ui/useInvoicingSubmodules.tsx` — nav entry
- Modify: `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceHeader.tsx` — Ramp badge
- Modify: the purchase-invoice detail loader that feeds the header (the route rendering
  `PurchaseInvoiceHeader` — grep `PurchaseInvoiceHeader` under `apps/erp/app/routes/x+/purchase-invoice+/`)
- Copy from (precedent): `apps/erp/app/routes/x+/invoicing+/payments.tsx` +
  `apps/erp/app/modules/invoicing/ui/Payment/PaymentsTable.tsx` +
  `.../Payment/PaymentStatus.tsx`; Drawer detail precedent:
  `apps/erp/app/routes/x+/workflows+/runs.$runId.tsx` (loader-fed Drawer over an Outlet)

**Steps:**
1. `card-transactions.tsx` list route: loader `requirePermissions({ view: "invoicing" })`,
   `getCardTransactions(...)` with `getGenericQueryFilters(request)` (copy payments.tsx
   verbatim, swapping service + table), handle
   `{ breadcrumb: "Card Transactions", to: path.to.cardTransactions, module: "invoicing" }`,
   render `<CardTransactionsTable data count />` + `<Outlet />`.
2. `CardTransactionsTable.tsx`: clone PaymentsTable column pattern — columns:
   `cardTransactionId` (link to `path.to.cardTransaction(id)`), `type` (Badge), `status`
   (`<CardTransactionStatus>` cloned from PaymentStatus with colors Draft=gray,
   Posted=green, Voided=red), `transactionDate` (`formatDate` from `@carbon/utils` —
   NEVER `new Date`), `merchantName`, `cardHolderName`, `amount`
   (`useCurrencyFormatter` money kind), `journalId`. Lingui `<Trans>` for headers matching
   PaymentsTable's i18n usage. ERP default sizes (no `size="lg"`), counts never in
   parentheses.
3. `card-transactions.$id.tsx`: loader fetches `getCardTransaction`; render a `Drawer`
   (open, onClose → navigate to list — copy the drawer mechanics from `runs.$runId.tsx`)
   showing header fields, a simple lines table (account number+name via a join in the
   select, amount, cost center, description), receipt `document` links (query `document`
   rows by path prefix `${companyId}/card-transaction/${id}/`), and a Void action button
   (permission `invoicing_update`, visible when Posted) posting to the void route.
4. `card-transactions.$id.void.tsx`: action `requirePermissions({ update: "invoicing" })`,
   invoke `post-card-transaction` `{ type: "void", cardTransactionId, userId, companyId }`
   via `getCarbonServiceRole()` (clone `x+/payments+/$paymentId.void.tsx` exactly),
   flash success/failure, redirect to the drawer route.
5. Nav: in `useInvoicingSubmodules.tsx` Payments group add
   `{ name: t\`Card Transactions\`, to: path.to.cardTransactions, icon: <LuCreditCard />,
   table: "cardTransaction", permission: "invoicing" }` — and change the Credits & Debits
   icon if `LuCreditCard` is now ambiguous (pick `LuReceipt` for Card Transactions if so;
   keep icons distinct).
6. Ramp badge: in the purchase-invoice route loader feeding the header, query
   `externalIntegrationMapping` for `{ entityType: "bill", entityId: invoiceId,
   integration: "ramp" }` via the user-scoped client `.maybeSingle()`; if RLS denies
   (empty/error), pass `null` silently. In `PurchaseInvoiceHeader.tsx` add
   `{rampMapping && <Status color="blue"><Trans>Ramp</Trans></Status>}` in the badge
   HStack (L318–326 area). Deep link when `metadata.deepLink` exists on the mapping.
7. New UI strings: run `pnpm lingui:extract` if that's the repo script (grep package.json
   scripts for `lingui`) — missing translations are filled at the check-and-commit gate.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm run lint
# Expected: no new errors in changed files
```

**Out of scope:** manual card-transaction creation forms; editing lines; MES; a dedicated
Ramp dashboard.

---

## Task 13: Docs + rule file

**Depends on:** Task 12
**Files:**
- Create: `.claude/rules/ramp-integration.md` (with `paths:` frontmatter covering
  `packages/ee/src/ramp/**`, `packages/jobs/src/inngest/functions/integrations/ramp-*.ts`,
  `apps/erp/app/routes/api+/webhook.ramp.$companyId.ts`,
  `packages/database/supabase/functions/post-card-transaction/**`)
- Modify: root `AGENTS.md` Task Router — add a "Ramp integration" row pointing at the rule
- Modify: `apps/erp/app/modules/invoicing/AGENTS.md` (if it exists — check) — cardTransaction addition
- Copy from (precedent): `.claude/rules/linear-integration.md` (shape/length of an integration rule)

**Steps:**
1. Write the rule grounded ONLY in the committed code: architecture (Carbon as Ramp's
   accounting provider), the five cardTransaction types + their journals, the sync loop +
   confirm semantics, cursor locations in metadata, dedupe rules (mapping-first,
   supplier+invoice_number, card-paid-bill skip), the draft-bill-only outbound rule
   (never `POST /bills`), sandbox notes (demo-api host, ⌘J demo actions), and the
   one-active-connection caveat.
2. Add the Task Router row under Integrations. Update the invoicing module AGENTS.md
   service/table lists if that file exists (per keep-sources-in-sync).
3. User-facing docs (`docs/` via carbon-docs skill) are a separate follow-up PR — note it
   in the run record, do not block this branch on it.

**Verify:**
```bash
test -f .claude/rules/ramp-integration.md && head -5 .claude/rules/ramp-integration.md
# Expected: file exists with paths: frontmatter
grep -n "Ramp" AGENTS.md | head -3
# Expected: Task Router row present
```

**Out of scope:** the docs-site page (follow-up); glossary changes.

---

## Task 14: Browser verification (/test) with sandbox

**Depends on:** all prior tasks
**Files:** none (verification only; playbooks land in `.ai/playbooks/`)

**Steps:**
1. Boot the stack with plain `crbn up` (portless). Log in via the `/auth` skill.
2. Invoke the `/test` skill against this branch's diff with the sandbox credentials,
   covering the spec's acceptance criteria that are reachable locally:
   - Install the Ramp integration in Settings → Integrations with sandbox creds +
     account mappings; verify install succeeds, secrets absent from
     `companyIntegration.metadata` (psql check), health badge OK.
   - Seed sandbox activity (⌘J demo panel: add transactions; mark ready in the Ramp UI),
     trigger `ramp-sync` (wait for sweep or fire the event via the Inngest dev UI), then
     verify in the browser: Card Transactions list shows the posted Charge; drawer shows
     lines + journal link; journal debits/credits correct (accounting → journal entry).
   - Bills: create+pay a sandbox bill; verify purchase invoice created → Paid; supplier
     auto-created.
   - Outbound: post a Carbon purchase invoice; verify the submitted draft appears in
     demo.ramp.com pending approval; verify a released PO appears in Ramp.
   - Failure path: code a sandbox transaction to a bogus category (or delete the mapped
     account) and verify the failed sync message appears in Ramp's Accounting tab and
     nothing was created in Carbon.
3. Record pass/fail per criterion in the run record; cache playbooks.

**Verify:**
```bash
# The /test skill's pass/fail table is the verification artifact; all attempted criteria pass.
```

**Out of scope:** production Ramp; load testing; the `accountingEnabled=false` criterion
can be checked via psql toggling company settings if quick, else marked env-gated.
