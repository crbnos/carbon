# Supplier Payment Requests — implementation plan

**Spec:** .ai/specs/2026-11-23-supplier-payment-requests.md
**Research:** .ai/research/supplier-prepayments-progress-billing.md
**Closest sibling:** `contractFinancingRequest` (customer contract financing). It is a numbered request on a document, with a status lifecycle, that ends in a payment.
**Branch:** spec/supplier-payment-requests

## Decisions this plan uses

| Decision | Source |
|----------|--------|
| Posting does not apply prepayments. The user applies them by hand. | User answer, spec "Prepayments are applied by hand" |
| A PO with unapplied prepayments gets a Planned automatic request. | User answer |
| Ramp work waits for a sandbox test. Phases A to D do not touch Ramp. | User answer, Gate G1 |
| The operations publish as MCP tools (`@mcp`). | User answer |
| No database trigger enforces the lifecycle. No event trigger. | Spec, backend preferences |
| The UI is community code (AGPL). Copy the sibling's shape, not its `.ee` license. | Spec, Closest Sibling |

## Progress
- [ ] Task 1: Create the payment request migration
- [ ] Task 2: Add the RLS rule to the authz manifest
- [ ] Task 3: Apply the migration and regenerate types
- [ ] Task 4: Add demo data and the parent CHECK entry
- [ ] Task 5: Check the backup catalog
- [ ] Task 6: Add the zod validator
- [ ] Task 7: Add the allowance, transition and settle building blocks
- [ ] Task 8: Create the automatic request in the posting transaction
- [ ] Task 9: Add the operations in `invoicing.server.ts`
- [ ] Task 10: Test the allowance, transitions and settlement
- [ ] Task 11: Build the request card and the request form
- [ ] Task 12: Mount the card on the purchase invoice detail page
- [ ] Task 13: Mount the card on the purchase order detail page
- [ ] Task 14: Add the create and edit modal routes
- [ ] Task 15: Add the payment requests list page
- [ ] Task 16: Show the planned-request message in the post dialog
- [ ] Task 17: Extract Lingui strings
- [ ] Task 18: Run the scoped checks (main agent only, once)
- [ ] Task 19: Verify the non-Ramp flows in the browser
- [ ] Gate G1: Run the Ramp sandbox test (stop point)
- [ ] Task 20: Add the Ramp outbound entity and candidate selection
- [ ] Task 21: Add the retry lookup by `remote_id`
- [ ] Task 22: Route inbound bills that match a request
- [ ] Task 23: Apply inbound payments to requests
- [ ] Task 24: Apply Ramp deposit payments as PO prepayments
- [ ] Task 25: Update the rules and module guides
- [ ] Task 26: Verify the Ramp flows in the sandbox
- [ ] Task 27: Write the changelog entry and run the commit gate

## Dependencies
- Task 2 needs Task 1. Task 3 needs Tasks 1 and 2.
- Task 4 needs Task 3. Task 5 needs Task 3.
- Task 6 needs Task 3. Task 7 needs Tasks 3 and 6.
- Task 8 needs Task 7. Task 9 needs Tasks 7 and 8. Task 10 needs Task 7.
- Tasks 11 and 15 need Task 9. They are independent of each other.
- Tasks 12, 13 and 14 need Task 11. Task 16 needs Task 12.
- Task 17 needs Tasks 11 to 16. Task 18 needs Tasks 1 to 17. Task 19 needs Task 18.
- Gate G1 needs Task 19. Tasks 20 to 24 need Gate G1 passed. Task 25 needs Tasks 20 to 24. Task 26 needs Task 25. Task 27 needs Task 26.
- Tasks 20 and 21 can run in parallel. Tasks 22 and 23 need Task 21.

---

## Task 1: Create the payment request migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_payment-requests.sql` (made by the command below)
- Copy from (precedent): `packages/database/supabase/migrations/20261021012500_contract-financing.sql`

**Steps:**
1. Run `pnpm db:migrate:new payment-requests`. Do not pick the timestamp by hand.
2. Open the new file. Replace its content with the SQL in the block below.
3. Do not add `CREATE POLICY`, `ENABLE ROW LEVEL SECURITY` or any trigger. Task 2 covers RLS.

```sql
DO $$ BEGIN
  CREATE TYPE "paymentRequestStatus" AS ENUM ('Planned', 'Ready', 'Sent', 'Paid', 'Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "paymentRequest" (
  "id" TEXT NOT NULL DEFAULT id('preq'),
  "companyId" TEXT NOT NULL,
  "purchaseInvoiceId" TEXT,
  "purchaseOrderId" TEXT,
  "requestNumber" INTEGER NOT NULL,
  "status" "paymentRequestStatus" NOT NULL DEFAULT 'Planned',
  "amount" NUMERIC,
  "currencyCode" TEXT NOT NULL,
  "dueDate" DATE,
  "description" TEXT,
  "documentPath" TEXT,
  "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
  "paymentId" TEXT,
  "idempotencyKey" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("purchaseInvoiceId", "companyId") REFERENCES "purchaseInvoice"("id", "companyId") ON DELETE CASCADE,
  FOREIGN KEY ("purchaseOrderId", "companyId") REFERENCES "purchaseOrder"("id", "companyId") ON DELETE CASCADE,
  FOREIGN KEY ("paymentId", "companyId") REFERENCES "payment"("id", "companyId"),
  CONSTRAINT "paymentRequest_target_check" CHECK (num_nonnulls("purchaseInvoiceId", "purchaseOrderId") = 1),
  CONSTRAINT "paymentRequest_amount_check" CHECK ("amount" IS NULL OR "amount" > 0),
  CONSTRAINT "paymentRequest_ready_check" CHECK (
    "status" IN ('Planned', 'Cancelled') OR ("amount" IS NOT NULL AND "dueDate" IS NOT NULL)
  ),
  CONSTRAINT "paymentRequest_paid_check" CHECK (("status" = 'Paid') = ("paymentId" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "paymentRequest_companyId_idx" ON "paymentRequest" ("companyId");
CREATE INDEX IF NOT EXISTS "paymentRequest_createdBy_idx" ON "paymentRequest" ("createdBy");
CREATE INDEX IF NOT EXISTS "paymentRequest_updatedBy_idx" ON "paymentRequest" ("updatedBy");
CREATE INDEX IF NOT EXISTS "paymentRequest_paymentId_idx" ON "paymentRequest" ("paymentId");
CREATE INDEX IF NOT EXISTS "paymentRequest_purchaseInvoiceId_idx" ON "paymentRequest" ("purchaseInvoiceId");
CREATE INDEX IF NOT EXISTS "paymentRequest_purchaseOrderId_idx" ON "paymentRequest" ("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "paymentRequest_status_idx" ON "paymentRequest" ("companyId", "status", "dueDate");

CREATE UNIQUE INDEX IF NOT EXISTS "paymentRequest_invoice_number_key"
  ON "paymentRequest" ("purchaseInvoiceId", "requestNumber", "companyId")
  WHERE "purchaseInvoiceId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "paymentRequest_order_number_key"
  ON "paymentRequest" ("purchaseOrderId", "requestNumber", "companyId")
  WHERE "purchaseOrderId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "paymentRequest_idempotency_key"
  ON "paymentRequest" ("companyId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;
```

**Verify:**
```bash
grep -c "CREATE POLICY\|ENABLE ROW LEVEL\|CREATE TRIGGER\|attach_event_trigger" packages/database/supabase/migrations/*_payment-requests.sql
# Expected: 0 for the new file
```

**Out of scope:** `purchaseInvoice`, `purchaseOrder` and `payment` tables. No change to their columns or triggers. No backfill of existing invoices.

**Escape hatch:** If `pnpm db:migrate:new` names a migration older than the newest file on `main`, STOP and report. Do not rename it.

---

## Task 2: Add the RLS rule to the authz manifest

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/authz/manifest.ts` — add one entry for `paymentRequest`
- Copy from (precedent): the `payment` entry in the same file

**Steps:**
1. Open `packages/database/src/authz/manifest.ts`. Find the `payment` entry.
2. Add `paymentRequest` beside it, with the same form and the module `"invoicing"`.
3. Run `pnpm --filter @carbon/database authz migration payment-requests`.
4. Confirm the command wrote a new migration file. Its name ends in `payment-requests`.

**Verify:**
```bash
grep -n "paymentRequest" packages/database/src/authz/manifest.ts
# Expected: one line that names the module "invoicing"
ls packages/database/supabase/migrations | grep payment-requests
# Expected: two files, the table migration and the RLS migration
```

**Out of scope:** Other entries in the manifest. Do not hand-write `CREATE POLICY`.

**Escape hatch:** If the authz command asks for a different module name, STOP and report. Do not guess.

---

## Task 3: Apply the migration and regenerate types

**Depends on:** Tasks 1 and 2
**Files:**
- Modify: generated DB types (made by the command, never by hand)

**Steps:**
1. Run `pnpm db:migrate`. It applies the pending migrations and regenerates types.
2. Run `pnpm run generate:types`.
3. Do not hand-edit the generated types.

**Verify:**
```bash
pnpm run generate:types && grep -rln "paymentRequest" packages/database/src | head -5
# Expected: at least one generated types file lists paymentRequest
```

**Escape hatch:** If `pnpm db:migrate` fails because the local stack is not running, STOP. Tell the user to run `crbn up`. Never rebuild the database.

---

## Task 4: Add demo data and the parent CHECK entry

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/src/datasets/wipe.ts` — add `"paymentRequest"` to `PARENT_CHECK_TABLES`
- Modify: `packages/database/src/datasets/coverage.ts` — add a floor for `paymentRequest`
- Modify: the tier data under `packages/database/src/datasets/tiers/` and `data/` — add realistic rows to all four datasets
- Copy from (precedent): the existing purchase invoice rows in the same tier

**Steps:**
1. Open `wipe.ts`. Add `"paymentRequest"` to the `PARENT_CHECK_TABLES` array. Reason: its `target_check` needs one of two nullable FKs.
2. Open `coverage.ts`. Add a floor of 2 rows for `paymentRequest`.
3. In each of the four datasets, add 2 requests to an existing purchase invoice. One is Ready. One is Planned.
4. Add 1 request to an existing purchase order, with status Planned.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets apply and roll back with no error
```

**Out of scope:** Sales-side data. Existing purchase invoice numbers.

**Escape hatch:** If a dataset has no purchase invoice to attach to, STOP and report which dataset.

---

## Task 5: Check the backup catalog

**Depends on:** Task 3
**Files:**
- Modify (only if the check names it): `packages/jobs/src/backups/renames.ts` or `packages/jobs/src/backups/id-refs.ts`

**Steps:**
1. Run `pnpm db:check:backups`.
2. If it passes, make no change.
3. If it names `paymentRequest`, add the entry the message asks for, in the same commit.

**Verify:**
```bash
pnpm db:check:backups
# Expected: exit code 0
```

**Escape hatch:** If the check names a table this plan did not create, STOP and report.

---

## Task 6: Add the zod validator

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` — add `paymentRequestValidator` and `paymentRequestStatusTypes`
- Copy from (precedent): `packages/ee/src/contract-financing/models.ts` (the request validator, around lines 100 to 119)

**Steps:**
1. Add `paymentRequestStatusTypes = ["Planned", "Ready", "Sent", "Paid", "Cancelled"] as const`.
2. Add `paymentRequestValidator` as a `z.object`. Fields: `id` (optional), `purchaseInvoiceId` (optional), `purchaseOrderId` (optional), `amount` (positive, optional), `currencyCode`, `dueDate` (optional), `description` (optional), `status` (`"Planned"` or `"Ready"`).
3. Add `.refine` so exactly one of `purchaseInvoiceId` and `purchaseOrderId` is set.
4. Add `idempotencyKey` (optional string) to the create input only.
5. Use `zfd` from `zod-form-data` for the amount field, as other validators do.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in invoicing.models.ts
```

**Out of scope:** Existing validators in the file.

---

## Task 7: Add the allowance, transition and settle building blocks

**Depends on:** Tasks 3 and 6
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — add building blocks
- Copy from (precedent): the existing `replaceInvoiceSettlements` function, which takes `db` and uses `forUpdate()`

**Steps:**
1. Add `getRequestAllowance(db, { companyId, target, excludeRequestId? })`. It returns the amount a request may still use.
2. For a purchase invoice target: read the `balance` column of the `purchaseInvoices` view. Subtract the amounts of requests that are not Paid or Cancelled.
3. For a purchase order target: read the order total the PO detail shows. Subtract the unapplied prepayments that have no request. Subtract the deposit requests that are not Paid or Cancelled.
4. Add `transitionPaymentRequest(db, { companyId, requestId, from, to, patch })`. It runs one `UPDATE ... WHERE id = ? AND companyId = ? AND status IN (from)`.
5. If the update changes no row, throw `InvalidInputError` with the message "This request changed. Reload and try again."
6. Add `settlePaymentRequest(db, { companyId, requestId, paymentId })`. Allowed from Planned, Ready, Sent and Cancelled. It sets `paymentId` and status Paid.
7. Add `createPaymentRequest(db, input)`. It locks the parent document row with `forUpdate()`. It takes the next `requestNumber` as the maximum plus one. It uses `ON CONFLICT (companyId, idempotencyKey) DO NOTHING`, then reads the row back.
8. Every query filters by `companyId`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in invoicing.service.ts
```

**Out of scope:** Existing building blocks. The posting body. Ramp code.

**Escape hatch:** If the PO total or the prepayment amount has no column in its view, STOP and report the name of the figure the PO page shows. Do not compute it from line items.

---

## Task 8: Create the automatic request in the posting transaction

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — inside `postPurchaseInvoice`, in its `db.transaction()` block
- Copy from (precedent): the journal insert step in the same transaction

**Steps:**
1. Find the transaction in `postPurchaseInvoice`. It starts near `db.transaction().execute` (around line 19428 at the time of planning).
2. Inside that transaction, after the journal insert, read the invoice's open balance.
3. Read three conditions in the same transaction:
   1. A spend integration with bill push is active. Find the existing check with `grep -rn "pushInvoices" packages/ee/src apps/erp/app/modules | head`.
   2. The supplier type is not `EMPLOYEE_SUPPLIER_TYPE` (from `packages/ee/src/spend/gates.ts`).
   3. The invoice has no request that is not Cancelled.
4. If all three hold, insert one request. Use `requestNumber` 1, `isAutomatic` true, the open balance as `amount`, and `dueDate` from the invoice.
5. Set status Planned if the PO has unapplied prepayments. Otherwise set status Ready.
6. Do not call Ramp inside the transaction.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/invoicing
# Expected: existing posting tests pass
```

**Out of scope:** The posting journal. Tax and inventory steps. The existing Ramp push for invoices. Task 20 handles that.

**Escape hatch:** If no spend integration check exists, STOP and report. The automatic request depends on it. If the open balance read is ambiguous inside the transaction, STOP and report.

---

## Task 9: Add the operations in `invoicing.server.ts`

**Depends on:** Tasks 7 and 8
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.server.ts` — add these operations, each with `@mcp`
- Copy from (precedent): `createPayment` (around line 1610) and `postPayment` for the TSDoc and wrapper shape

**Steps:**
1. Add `getPaymentRequests`. Permission `{ view: "invoicing" }`. Read operation. Paged list with `status`, `supplier`, `document` and `dueDate` filters.
2. Add `getPaymentRequestsForDocument`. Permission `{ view: "invoicing" }`. Read operation. Returns the requests of one invoice or one PO, plus the allowance.
3. Add `createPaymentRequest`. Permission `{ create: "invoicing" }`. It takes an `idempotencyKey`. Runs the allowance check. Calls `createPaymentRequest` in Task 7.
4. Add `updatePaymentRequest`. Permission `{ update: "invoicing" }`. Edits a Planned or Ready request. Runs the allowance check.
5. Add `markPaymentRequestReady`. Permission `{ update: "invoicing" }`. Moves Planned to Ready. Requires an amount and a due date.
6. Add `markPaymentRequestPlanned`. Permission `{ update: "invoicing" }`. Moves Ready to Planned. Refuses a Sent request.
7. Add `cancelPaymentRequest`. Permission `{ update: "invoicing" }`. Sets Cancelled. If the request was Sent, return a message that says to discard the draft in Ramp by hand.
8. Add `linkPaymentRequestPayment`. Permission `{ update: "invoicing" }`. Calls `settlePaymentRequest`.
9. Tag each operation with `@mcp`. Use the `@mcp read` or `@mcp destructive` tag that matches the operation, as `postPayment` does.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in invoicing.server.ts
grep -c "@mcp" apps/erp/app/modules/invoicing/invoicing.server.ts
# Expected: the count rises by 8 from its value before this task
```

**Out of scope:** Existing operations. Ramp operations. Route files (Tasks 11 to 15).

**Escape hatch:** If the MCP generator rejects a tag, STOP and report the operation name.

---

## Task 10: Test the allowance, transitions and settlement

**Depends on:** Task 7
**Files:**
- Create: `apps/erp/app/modules/invoicing/invoicing.payment-requests.test.ts` — unit tests for the pure transition table
- Create: `apps/erp/test/database/payment-requests.test.ts` — live database test for the allowance and the settle path
- Copy from (precedent): `apps/erp/app/modules/invoicing/invoicing.settlements.test.ts`

**Steps:**
1. In the unit test file, test each allowed transition in the spec's "Status lifecycle" table. Test each refused transition.
2. In the live test, create one invoice with an open balance of 100. Add a request of 60. Then try to add a request of 50. Expect a refusal.
3. In the live test, call `settlePaymentRequest` twice with the same id. Expect the second call to change no row.
4. Add the file header from `pnpm --filter @carbon/checks license-headers` after you create each file.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/invoicing/invoicing.payment-requests.test.ts
# Expected: all tests pass
```

**Out of scope:** Existing settlement tests.

**Escape hatch:** If the live database test cannot run here, STOP and report. Do not rebuild the database.

---

## Task 11: Build the request card and the request form

**Depends on:** Task 9
**Files:**
- Create: `apps/erp/app/modules/invoicing/ui/PaymentRequest/PaymentRequests.tsx` — the card
- Create: `apps/erp/app/modules/invoicing/ui/PaymentRequest/PaymentRequestForm.tsx` — the form
- Modify: `apps/erp/app/modules/invoicing/ui/index.ts` — add an export line for the new folder
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Contracts/ContractFinancing.ee.tsx` (request table and actions). Do not copy its `.ee` license.
- Copy from (precedent): `apps/erp/app/modules/invoicing/ui/Payment/InvoicePaymentsPanel.tsx` (card placement)

**Steps:**
1. Build the card with `Card` and `Table` from `@carbon/react`. Grep `packages/react/src/` first for an existing row component.
2. Show one row per request: number, status, due date, amount, PDF link and Ramp link.
3. Show the open balance and the allowance that the API returns. Do not compute them in the UI.
4. Add actions: add, mark Ready, mark Planned, cancel. Show each action only when `can("update", "invoicing")` is true.
5. Build the form with `ValidatedForm` and `paymentRequestValidator` from `~/modules/invoicing/invoicing.models`.
6. Show the allowance as the form's maximum. The API still refuses an amount above it.
7. Use `useLingui` and `Trans` for every string.
8. Use no `useEffect`. Refresh data after an action through the action hook in `packages/query`.
9. Add the export line to `ui/index.ts`, in the same form as the other folders.
10. Run `pnpm --filter @carbon/checks license-headers` on the new files.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in the PaymentRequest folder
grep -rn "useEffect" apps/erp/app/modules/invoicing/ui/PaymentRequest/
# Expected: no output
```

**Out of scope:** Existing Payments panel. Sales contract screens.

**Escape hatch:** If `ContractFinancing.ee.tsx` has no table row component to copy, grep `packages/react/src/` for a `Table` row used by `PurchaseInvoice`. Use that and say so in the run log.

---

## Task 12: Mount the card on the purchase invoice detail page

**Depends on:** Task 11
**Files:**
- Modify: `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.details.tsx` — add the call to `getPaymentRequestsForDocument` in the loader, and render the card above the payments panel
- Copy from (precedent): the same file's existing loader `Promise.all`

**Steps:**
1. In the loader, add one call to `getPaymentRequestsForDocument` for this invoice. Add it to the existing `Promise.all`.
2. Return its result under one key. Do not load request data anywhere else.
3. In the component, render `PaymentRequests` above `InvoicePaymentsPanel`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in $invoiceId.details.tsx
```

**Out of scope:** `InvoicePaymentsPanel`. The sales invoice detail page.

---

## Task 13: Mount the card on the purchase order detail page

**Depends on:** Task 11
**Files:**
- Modify: `apps/erp/app/routes/x+/purchase-order+/$orderId.details.tsx` — add the loader call and render the card as "Deposit requests"
- Copy from (precedent): Task 12's change

**Steps:**
1. In the loader, add one call to `getPaymentRequestsForDocument` with the PO target.
2. Render `PaymentRequests` with the title "Deposit requests" and the PO target.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in $orderId.details.tsx
```

**Out of scope:** `PurchaseOrderPaymentForm.tsx`. The PO payment route.

---

## Task 14: Add the create and edit modal routes

**Depends on:** Task 11
**Files:**
- Create: `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.payment-requests.new.tsx`
- Create: `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.payment-requests.$requestId.tsx`
- Create: `apps/erp/app/routes/x+/purchase-order+/$orderId.payment-requests.new.tsx`
- Create: `apps/erp/app/routes/x+/purchase-order+/$orderId.payment-requests.$requestId.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/contract+/$id.financing.$requestId.tsx`

**Steps:**
1. In each route's action, validate with `validator(paymentRequestValidator).request(args, ...)`.
2. Call one operation through `carbon(request)`. Use `createPaymentRequest` or `updatePaymentRequest`.
3. Return the result for a fetcher form, or use `respond(request, result).redirect(...)` for a navigating form.
4. Render `<RecordOutlet />`, not `<Outlet />`.
5. Export a `meta` function with `newRecordMeta("Payment Request")` or `recordMeta(...)`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in the four route files
```

**Out of scope:** Route actions that call Ramp.

---

## Task 15: Add the payment requests list page

**Depends on:** Task 9
**Files:**
- Create: `apps/erp/app/routes/x+/invoicing+/payment-requests.tsx` — the list page
- Modify: `apps/erp/app/modules/invoicing/ui/useInvoicingSubmodules.tsx` — add a "Payment requests" entry
- Copy from (precedent): the purchase invoice list page under `apps/erp/app/routes/x+/invoicing+/`. Run `ls` on that folder to find it.

**Steps:**
1. Read `.claude/rules/table-infinite-scroll.md` before you write the table.
2. Build the list with cursor paging. Use the `getPaymentRequests` operation.
3. Show Planned and Ready requests first, sorted by due date.
4. Add filters for status, supplier and due date.
5. Add the submodule entry in `useInvoicingSubmodules.tsx`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in the list route
```

**Out of scope:** Other list pages. Shared table components.

---

## Task 16: Show the planned-request message in the post dialog

**Depends on:** Task 12
**Files:**
- Modify: the post dialog for purchase invoices. Read `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.post.tsx` first to find the component it renders.

**Steps:**
1. When the invoice has one or more Planned requests, show this message in the post dialog: "No automatic request: this invoice has {count} planned requests."
2. Take `{count}` from the data that Task 12 loads. Do not add a second call.
3. Use `useLingui` and `Trans` for the string.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in the post dialog
```

---

## Task 17: Extract Lingui strings

**Depends on:** Tasks 11 to 16
**Files:**
- Modify: `packages/locale/locales/*/erp.po` (made by the command)

**Steps:**
1. Run `pnpm lingui:extract`.
2. Do not run `/translate` here. The commit gate runs it.

**Verify:**
```bash
pnpm lingui:extract && git diff --stat -- packages/locale/locales
# Expected: the erp.po files list new message ids
```

---

## Task 18: Run the scoped checks (main agent only, once)

**Depends on:** Tasks 1 to 17
**Files:** none

**Steps:**
1. Run the checks below in order, once, from the main agent. No subagent runs them.
2. If a check fails, fix the cause and run that check again.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm --filter erp exec vitest run app/modules/invoicing
# Expected: all tests pass
pnpm run lint
# Expected: exit 0
pnpm run generate:mcp
# Expected: exit 0, and the new invoicing_* tools appear
pnpm check:manifest
# Expected: exit 0
```

---

## Task 19: Verify the non-Ramp flows in the browser

**Depends on:** Task 18
**Files:** none. Follow the `/test` skill.

**Steps:**
1. Sign in with the `/auth` skill.
2. Check spec acceptance 3: add a request above the allowance. Expect a refusal that names the most allowed.
3. Check acceptance 6: add two Planned requests to a Draft invoice and post it. Expect no automatic request.
4. Check acceptance 5 as changed in the spec: post a $20,000 invoice from a PO with an $8,000 prepayment. Expect a Planned request, and no applied prepayment.
5. Check the list page: Planned and Ready requests appear by due date.
6. Check the cancel action on a Ready request. Expect status Cancelled.

**Verify:** Each check above has a screenshot at device scale 2 in the run log. State pass or fail for each.

---

## Gate G1: Run the Ramp sandbox test (stop point)

**Depends on:** Task 19
**Files:** none

**Steps:**
1. Stop here and ask the user for Ramp sandbox access if you do not have it.
2. In the sandbox, create a draft bill with `remote_id` set to a request id. Use an AP-coded line.
3. Record whether Ramp accepts the bill. Record whether Ramp accepts `-R1` and `-R2` on one vendor.
4. Record the result in the run log before you start Task 20.

**Escape hatch:** If Ramp refuses the AP-coded line, STOP. The user chooses between a clearing account and another design. Do not start Tasks 20 to 24.

---

## Task 20: Add the Ramp outbound entity and candidate selection

**Depends on:** Gate G1 passed
**Files:**
- Create: `packages/ee/src/ramp/entities/payment-request.ts` — the outbound syncer
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync-outbound.ts` — add the Ready-request candidate query
- Modify: `packages/ee/src/spend/gates.ts` — stop the `purchaseInvoice` push for new invoices only
- Copy from (precedent): `packages/ee/src/ramp/entities/bill.ts` (`RampBillSyncer`, `createDraftBill` around line 252)

**Steps:**
1. Build the candidate query as one SQL read. Select Ready requests with no mapping. Use `NOT EXISTS` on `externalIntegrationMapping`. Do not query per request.
2. Do not use a posting-date window in the query.
3. Build the draft bill payload from the spec's table. Set `remote_id` to the request id.
4. Set the invoice number to the supplier reference or the readable id, with the suffix `-R{requestNumber}`.
5. Code an invoice request to `accountDefault.payablesAccount`. Code a deposit request to `accountDefault.supplierPrepaymentAccount`.
6. Save the mapping and set the request to Sent in one transaction, as Task 21 describes.
7. Do not add `paymentRequest` to `REQUIRED_SYNC_SUBSCRIPTIONS`. The sweep finds Ready requests.
8. Send the outbound job after the commit of the operation that readies a request. Find the existing sync event name with `grep -rn "ramp-outbound-reconcile" packages/jobs/src | head`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
# Expected: exit 0
pnpm --filter @carbon/jobs exec vitest run ramp
# Expected: all Ramp tests pass
```

**Out of scope:** Subscriptions for `purchaseOrder`. Existing bills mapped before this change.

**Escape hatch:** If the sync event name cannot be found, STOP and report.

---

## Task 21: Add the retry lookup by `remote_id`

**Depends on:** Task 20
**Files:**
- Modify: `packages/ee/src/ramp/lib/client.ts` — add a lookup of bills by `remote_id`
- Modify: `packages/ee/src/ramp/entities/payment-request.ts` — call the lookup before create

**Steps:**
1. Add a method that calls `GET /developer/v1/bills?remote_id=<id>`.
2. Before each `createDraftBill`, call the lookup. If a bill exists, skip the create.
3. Keep the mapping write and the Sent update in one transaction.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run ramp
# Expected: a test shows that a second run creates no second bill
```

**Out of scope:** Other Ramp endpoints.

---

## Task 22: Route inbound bills that match a request

**Depends on:** Task 21
**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync-bill-stage.ts` — add a branch for a bill that maps to a request
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync-bill.ts` — confirm the bill and create no invoice

**Steps:**
1. In the stage function, check the mapping for the Ramp bill id first. It already exists for a request bill.
2. If the mapping points to a request, return the request branch.
3. In `syncBill`, for the request branch, confirm the bill. Create no purchase invoice.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run ramp-sync-bill
# Expected: a test shows a request bill creates no invoice
```

**Out of scope:** The legacy lookup by supplier reference.

---

## Task 23: Apply inbound payments to requests

**Depends on:** Task 22
**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync-payment.ts` — add the request branch
- Copy from (precedent): the existing `upsertLocalPaymentDraft` call in the same file (`packages/ee/src/accounting/core/payment-application.ts`, function at line 113)

**Steps:**
1. For an invoice request, call `upsertLocalPaymentDraft` against the request's invoice.
2. Call `settlePaymentRequest` with the new payment id. Run it in the same transaction as the payment write.
3. If the Ramp amount differs from the request amount, record the Ramp amount. Write a Sync Activity `Warning`.
4. Change the split-payment refusal message to say: add requests in Carbon instead.
5. A repeated sync of the same payment finds the request Paid and changes nothing.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run ramp-sync-payment
# Expected: a test shows a repeated sync changes nothing
```

**Out of scope:** `syncRampBillPayments` filters (marked TODO in the code). Split payments stay refused.

---

## Task 24: Apply Ramp deposit payments as PO prepayments

**Depends on:** Task 23
**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync-payment.ts` — add the deposit branch
- Copy from (precedent): `createPayment` and `postPayment` in `invoicing.server.ts`, which take `purchaseOrderId`

**Steps:**
1. For a deposit request, create a payment with `purchaseOrderId` set. Use the PO's supplier.
2. Post the payment through `postPayment`.
3. Call `settlePaymentRequest` with the new payment id.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run ramp-sync-payment
# Expected: a deposit test shows a posted prepayment on account 1150
```

**Escape hatch:** If `postPayment` refuses a prepayment with no invoice, STOP and report the message.

---

## Task 25: Update the rules and module guides

**Depends on:** Tasks 20 to 24
**Files:**
- Modify: `apps/erp/app/modules/invoicing/AGENTS.md` — add the payment request operations and the building blocks
- Modify: `.claude/rules/ramp-integration.md` — describe the request path. Fix the card-paid text to match the code.

**Steps:**
1. In `invoicing/AGENTS.md`, add the new operations under "Operations". Add the building blocks under "Key Service Functions".
2. In `ramp-integration.md`, read `ramp-sync-payment.ts` lines 382 to 394 first.
3. Rewrite the card-paid sentence to match what the code does. Mark anything you cannot check with `<!-- UNVERIFIED: ... -->`.

**Verify:**
```bash
grep -n "getPaymentRequests\|settlePaymentRequest" apps/erp/app/modules/invoicing/AGENTS.md
# Expected: each name appears once
```

---

## Task 26: Verify the Ramp flows in the sandbox

**Depends on:** Task 25
**Files:** none. Follow the `/test` skill.

**Steps:**
1. Check spec acceptance 1: a $20,000 request sends one draft bill, coded to the AP account, with `INV-7731-R1`.
2. Check acceptance 2: the sandbox payment makes the request Paid, with no new invoice.
3. Check acceptance 4: a $5,000 invoice creates one automatic request and one bill.
4. Check acceptance 7: a deposit request sends a bill, and the PO shows a prepayment on 1150.
5. Check acceptance 8: a 60-day-old invoice's request goes out at the next sync.
6. Check acceptance 9: an old mapped bill still pays its invoice.
7. Check acceptance 10: a cancelled Sent request shows the Ramp discard message.
8. Check acceptance 11: a partial payment writes a Warning.

**Verify:** State pass or fail for each check in the run log.

---

## Task 27: Write the changelog entry and run the commit gate

**Depends on:** Task 26
**Files:**
- Create: the changelog entry (made by the `changelog-entry` skill)

**Steps:**
1. Load the `changelog-entry` skill and write the entry.
2. Run the `check-and-commit` skill. It runs the gates and commits. It pushes only when the branch tracks a remote.

**Verify:**
```bash
git status --short
# Expected: no uncommitted files
```
