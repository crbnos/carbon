# Invoicing Module

Five document families plus the AR/AP subledger: **sales invoices**, **purchase invoices**,
**memos** (credit/debit), **payments** (AR receipts, AP disbursements, employee reimbursement
payouts), **charges** (card transactions), and **reimbursements** — with settlement/
application, aging, tie-out, and the receivables/payables workbenches on top.

Largest module in the app: one `invoicing.service.ts` (4219 lines, 72 exports) and one
`invoicing.models.ts`, per the one-service-per-module rule. `index.ts` re-exports ONLY
`invoicing.models`, `invoicing.reports`, `invoicing.service`, `types`, `ui`. Two server-only
helpers stay OUTSIDE that barrel (client components import it, and a `.server` module reaching
the client graph fails the React Router build): `reimbursement.server.ts` — the ONE caller of
`post-reimbursement` (`postReimbursement`/`voidReimbursement`) plus `linesBalanceHeader` /
`REIMBURSEMENT_UNBALANCED_MESSAGE` — and `stripe-customer.server.ts` (+ the pure
`stripe-customer.mapper.ts`) for Stripe Connect customer resolution.

`invoicing.reports.ts` is pure calendar/aggregation math (`previousPeriod`, `aggregateSpend`)
with no route consumer yet — only its own test. `ui/SalesInvoice/` has no `index.ts` and is NOT
in `ui/index.ts`; `x+/sales-invoice+/` deep-imports it. Every other `ui/` folder (`Charge`,
`Dashboard`, `Memo`, `Payment`, `PurchaseInvoice`, `Reimbursement`, `Workbench`) is barrel-exported.

## Key Domain Concepts

- **Invoice status** — `salesInvoiceStatusType` / `purchaseInvoiceStatusType`;
  `is{Sales,Purchase}InvoiceLocked` = not Draft. **`Partially Paid` and `Overdue` are DERIVED**
  in the `salesInvoices`/`purchaseInvoices` views from `invoiceSettlement`. There is no
  manual status change: Mark as Paid / Mark as Unpaid, their `$invoiceId.status.tsx` routes
  and `update{Sales,Purchase}InvoiceStatus` are gone, so a payment (through
  `invoiceSettlement`) is the only way an invoice becomes paid. Base-status `Paid` remains on
  rows written before the change. <!-- UNVERIFIED: whether any sync path still writes a base `Paid` status; none found in packages/ee or packages/jobs -->
- **Due date** — `computeInvoiceDateDue` anchors `paymentTerm.daysDue` by `calculationMethod`
  (`Net` / `End of Month` / `Day of Month`, clamped). A missing term falls back to
  `DEFAULT_PAYMENT_TERM` (Net 30); a term *query failure* throws so the caller aborts instead
  of persisting a stale `dateDue`. The date math is `calculateDueDate` (`@carbon/utils`).
- **Memo** — ONE `memo` table, and `direction` (`Credit`/`Debit`) is **orthogonal to party**:
  all four combinations are legal (`memoDirection` carries both values; the table's only party
  constraint is customer-XOR-supplier). `credit-memos.tsx` / `supplier-credits.tsx` filter on
  the PARTY (`getMemos({ party })`) and offer direction as a separate filter;
  `vendor-credits.tsx` redirects old links. The readable id comes from the `creditMemo` or
  `debitMemo` sequence chosen by **direction**, not party.
- **Payment — THREE payee kinds.** `paymentValidator` requires exactly one of `customerId` /
  `supplierId` / `employeeId` (mirroring the DB `payment_party_check`). An `employeeId` payment
  is a **reimbursement payout**: always `Disbursement`, never AR, never a refund. In
  `replaceInvoiceSettlements` the `isReimbursement` arm targets `targetReimbursementId` ONLY and
  refuses any discount, write-off, invoice/memo target, or cash-in direction; `isRefund` is
  `!isReimbursement && cashIn !== isAR`, so a three-way party can't be misread as a refund.
  `totalAmount` may be 0 — a payment can be a pure credit application.
- **`invoiceSettlement`** — source is exactly one of `paymentId`/`memoId`; target exactly one of
  FOUR (`targetSalesInvoiceId`, `targetPurchaseInvoiceId`, `targetMemoId`,
  `targetReimbursementId` — the fourth added by `20260923231244`, which widened
  `invoiceSettlement_target_check`). **`appliedAmount`, `discountAmount` and `writeOffAmount` are
  company BASE currency; `sourceAmount` is the exact principal in the funding source's DOCUMENT
  currency** (per the `COMMENT ON COLUMN` statements in
  `20260908021155_accounting_posting_corrections.sql`) — getting that pair backwards is a live
  money bug. `fxGainLossAmount` is GENERATED
  (`appliedAmount * (sourceExchangeRate - targetExchangeRate)`); never write it.
- **Charge** — renamed from `cardTransaction` by `20260922195151` (tables, enums, triggers, RLS,
  sequence, and the `Card Transaction` journal-source label). Ramp-fed and **read-only in the
  ERP**: list, drawer, void (`charges{,.$id,.$id.void}.tsx`). No `chargeValidator` and no
  create/edit route — `post-charge` is invoked by
  `packages/jobs/.../integrations/ramp-sync-card.ts`; only the void goes through the ERP. The
  nav entry is NOT gated on a spend integration being connected.
- **Reimbursement** — first-class as of `20260923231244`: `reimbursement` / `reimbursementLine` /
  `reimbursementLineDimension`, Draft → Posted → Voided. **Imported from a spend tool, never
  hand-created** — `reimbursementUpdateValidator` has no create counterpart, and
  `check_reimbursement_draft_mutation` refuses a non-Draft INSERT, a non-Draft DELETE, and any
  content change during the Draft→Posted flip. `ReimbursementEditForm` shows `currencyCode` and
  `exchangeRate` **read-only on purpose**: they are the source transaction's facts, a
  reimbursement has no `*.exchange-rate` route, and re-denominating an imported expense is not a
  workflow. `linesBalanceHeader` (EPSILON — matching the server function's `requireLineSum`, NOT
  its 0.01 journal tolerance) is the only pre-posting guard against posting an unbalanced
  reimbursement; both `$reimbursementId.post.tsx` and `.edit.tsx` (`save-and-post`) call it.
- **Party-contact gate** — `checkPartyContactRequirement`
  (`~/modules/settings/party-contact.server`) runs at BOTH invoice post routes. The route's own
  party read is `companyId`-scoped and **fails CLOSED**: an error or a missing row refuses the
  post, because the helper returns `null` for a party with no id — so an unchecked read was the
  gate's own bypass. The helper's own internal reads fail OPEN, per-read, and log every
  degradation.

## Safety

### Always
- MUST build the Kysely client in the ROUTE (`getDatabaseClient()` from
  `~/services/database.server`) and pass it as `db` — `replaceInvoiceSettlements`,
  `applyCreditsToInvoices`, `upsertReimbursementLines` and both `update*InvoiceLineOrder`
  take `db: Kysely<KyselyDatabase>`. This service is barrel-exported to the browser
  (`no-db-client-in-service`).
- MUST re-assert Draft status inside every Kysely transaction with `forUpdate()` — Kysely
  bypasses RLS; `replaceInvoiceSettlements` and `upsertReimbursementLines` both do.
- MUST write `appliedAmount` in base currency and `sourceAmount` in the source document's
  currency, converting with `toBaseAmount` / `toDocumentAmount` (`@carbon/utils`).
- MUST recompute a balance or variance SERVER-side before acting on it —
  `$reimbursementId.pay.tsx` re-reads `getOpenReimbursementsForEmployee`;
  `{receivables,payables}.adjust.tsx` re-run the tie-out instead of trusting the form.
- MUST resolve currency decimals from data (`getPaymentCurrencyConfiguration` →
  `requireCurrencyDecimals`), never a literal scale.

### Ask First
- Changing the settlement columns or their XOR checks — `invoiceSettlement` is the only
  ledger of what has been paid, and the aging/tie-out RPCs read it directly.
- Adding a create path for a charge or a reimbursement — both are import-only by design and
  the DB draft-mutation triggers enforce it.
- Relaxing either invoice-post party-contact gate, or the `salesInvoicePostValidator` Stripe
  refinements — they are what make the customer-confirmation step structurally mandatory
  before a customer is created on a merchant's Stripe account.

### Never
- Derive `memo.direction` from the party. `MemoForm` did exactly that and force-submitted it
  with `<Hidden value>` (which prefers `value` over `defaultValue`), overwriting the stored
  direction on every save and making customer-Debit / supplier-Credit memos unauthorable.
  `invoicing.models.test.ts` → `describe("memoValidator")` pins the contract.
- Set `Partially Paid` or `Overdue` directly — they are view-derived from settlements.
- Give an employee payment a discount, a write-off, an invoice/memo target, or a Receipt
  direction — `replaceInvoiceSettlements` throws on each.
- Edit a posted document. `isMemoLocked` / `isPaymentLocked` / `isReimbursementLocked` are all
  "anything but Draft"; posting and voiding go through the `post-sales-invoice`,
  `post-purchase-invoice`, `post-memo`, `post-payment`, `post-charge`, `post-reimbursement`
  server functions — never a direct status write.
- Re-export `reimbursement.server.ts` or `stripe-customer.server.ts` from `index.ts`.

## Validation Commands

```bash
pnpm --filter erp exec vitest run app/modules/invoicing   # scoped: 9 files / 166 tests
pnpm exec turbo run typecheck --filter=erp
pnpm --filter erp test                                    # the whole app's vitest suite
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `salesInvoice` / `salesInvoices` (view) | AR header; view derives `balance`, `invoiceTotal`, `Partially Paid`/`Overdue`, `paymentTermName`. Invoice automation columns: `automationHoldReason` (a Draft a person must review before automation posts it), `sentAt` / `sentTo` / `sendError` (the manual post route stamps `sentAt` when the email is QUEUED, or `sentTo: "Stripe"` once the Stripe send succeeds, and `sendError` when anything after the post — the PDF, the contact, the email or the Stripe send — fails; the automation stamps when it is SENT, and a sent stamp that fails to write becomes a `sendError` rather than a clean send). The header shows "Emailed", or "Sent via Stripe" when `sentTo` is `Stripe`. The view's `needsReview` = held Draft, or posted with `sendError` and no `sentAt` — the Sales Invoices list shows an orange "Needs Review" badge beside the status (tooltip: the hold reason or send error) and filters on the hidden `needsReview` column (`?filter=needsReview:eq:true`, the link the digest notification uses). There is no sidebar entry for it. A posted invoice that failed to send has a Send action (`$invoiceId.send.tsx`, fires `carbon/invoice.automate` with `resend: true`: the job sends through Stripe when the invoice's source mode is `Post and Send via Stripe`, otherwise by email — including a manually posted invoice with no recurring source). The posted PDF is stored under `{companyId}/opportunity/{opportunityId}/`, or `{companyId}/sales-invoice/{invoiceId}/` when the invoice has no opportunity; it is rendered by `@carbon/lib/sales-invoice-document.server` (shared with the PDF route and the automation job) |
| `salesInvoiceLine` / `salesInvoiceLines` / `salesInvoiceLocations` (views) | AR lines (`salesInvoiceLineType` includes `Fixed Asset`). **Line discount** (migration `20261006221401`): `discountPercent` is a FRACTION 0–1 (CHECK, default 0) with generated `netUnitPrice` / `convertedNetUnitPrice`; it discounts the merchandise (`quantity × unitPrice`) only — add-ons and shipping never — and tax is charged on the discounted merchandise. `unitPrice` stays the LIST price. Every amount path applies it: the `salesInvoices` view totals, `calculateSalesPostingAmounts` (`@carbon/database`, `sales-posting-amounts.ts`), the PDF / email (`@carbon/documents` `utils/sales-invoice.ts`), `SalesInvoiceSummary`, Stripe (`toStripeInvoiceLines`) and the accounting providers (`sales-document-components.ts`). The form field "Discount (%)" posts percent POINTS; `$invoiceId.new` / `$invoiceId.$lineId.details` divide by 100 (`salesInvoiceLineValidator` accepts 0–100). `upsertSalesInvoiceLine` (an MCP tool) writes the value as given, so an MCP caller must send the fraction (20 is refused by the CHECK). Contract provenance: `customerContractId` / `customerContractLineId` / `customerContractInvoiceLineId` and `projectId` (written as the Project dimension on the line's revenue legs); `salesInvoice.customerContractId` and `memo.customerContractId` likewise. With these FKs, inferring a bare `salesInvoice(...)` embed from `salesInvoiceLine` exceeds TypeScript's instantiation depth (TS2589): name the FK, `salesInvoice!salesInvoiceLine_invoiceId_fkey(...)` |
| `salesInvoiceShipment` | Per-invoice shipping method/term/cost + incoterm, and the customer ship-to `customerLocationId` ("Ship To" on `SalesInvoiceShipmentForm`; copied from the order / contract / rental agreement when one drafts the invoice; sales rules evaluate standalone lines against it, never the bill-to — see sales `AGENTS.md` "Invoice ship-to") |
| `purchaseInvoice` / `purchaseInvoices` (view) | AP header; view derives `balance`, `orderTotal`, the derived statuses |
| `purchaseInvoiceLine` / `purchaseInvoiceLines` (view) | AP lines (`purchaseInvoiceLineType` includes `G/L Account`) |
| `purchaseInvoiceDelivery` | AP delivery terms |
| `memo` | Credit/debit memos; customer XOR supplier, `direction` orthogonal to party |
| `payment` | Receipts, disbursements, employee payouts (three-way `payment_party_check`) |
| `invoiceSettlement` | Applications: one source × one of four targets; base-currency reliefs + generated `fxGainLossAmount` |
| `charge` / `chargeLine` | Card charges (`chargeType`: Charge/Credit/Payment/Cashback/Repayment) |
| `reimbursement` / `reimbursementLine` / `reimbursementLineDimension` | Employee expense payable, coding lines, dimension tags |
| `paymentTerm`, `currency`, `company` | Due-date, decimals, and base-currency resolution |

RPCs: `get_ar_aging`, `get_ap_aging`, `get_ar_tie_out`, `get_ap_tie_out`,
`get_ar_open_by_customer`, `get_ap_open_by_supplier`, `get_next_sequence`.

## Validators → routes

| Validator | Used by |
|---|---|
| `salesInvoiceValidator` | `x+/sales-invoice+/{new,$invoiceId.details}.tsx` |
| `salesInvoiceLineValidator` / `salesInvoiceShipmentValidator` | `$invoiceId.new`, `$invoiceId.$lineId.details`, `$invoiceId.shipment` |
| `salesInvoicePostValidator` (+ `stripeCustomerActions`) | `x+/sales-invoice+/$invoiceId.post.tsx` |
| `purchaseInvoiceValidator` | `x+/purchase-invoice+/{new,$invoiceId.details}.tsx` |
| `purchaseInvoiceLineValidator` / `purchaseInvoiceDeliveryValidator` | `$invoiceId.new`, `$invoiceId.$lineId.details`, `$invoiceId.delivery` |
| `memoValidator` | `x+/credits+/{new,$memoId}.tsx` |
| `paymentValidator` | `x+/payments+/{new,$paymentId}.tsx` |
| `invoiceSettlementValidator` (+ `invoiceSettlementBase` for `.omit()`) | `x+/payments+/$paymentId.applications.set.tsx` |
| `reimbursementUpdateValidator` / `reimbursementLinesValidator` | `x+/reimbursements+/$reimbursementId.edit.tsx` |
| `reimbursementPaymentValidator` | `$reimbursementId.pay.tsx` — 1:1 with Rillet's `POST /reimbursements/{id}/payments` |

Charges have no validator; `x+/{sales,purchase}-invoice+/update.tsx` are bulk-field routes
guarded by `requireUnlockedBulk`, not validators.

## Key Service Functions

- `insertSalesInvoice` / `insertPurchaseInvoice` — allocate the sequence via
  `get_next_sequence`, mint the `opportunity`, copy party payment/shipping defaults. Use these,
  not a bare INSERT.
- `createSalesInvoiceFromSalesOrder` / `createSalesInvoiceFromShipment` /
  `createPurchaseInvoiceFromPurchaseOrder` — all three call the `convert` server function.
- `computeInvoiceDateDue` / `computeEarlyPaymentDiscounts` — terms math (the due date itself is
  `calculateDueDate` / `DEFAULT_PAYMENT_TERM` from `@carbon/utils`, shared with invoice posting);
  discounts batch-load their terms in one query, never per invoice.
- `replaceInvoiceSettlements` (Kysely) — replace-all for a Draft payment's applications; owns
  the AR / AP / refund / reimbursement arm rules and the balance ceilings.
- `applyCreditsToInvoices` (Kysely) — additive memo-sourced settlements, GL-neutral (the memos
  already posted their own journals); v1 requires equal source and target rates.
- `getAvailableCreditsForParty` / `getCompanyHasOpenCredits` / `getStagedCreditsForPayment` /
  `getAvailableOnAccountCredit(Sources)` — the credits half of the payment composer.
- `getInvoiceSettlementsForInvoice` / `getMemoApplications` — application history, fully paged.
- `getOpenSalesInvoicesForCustomer` / `getOpenPurchaseInvoicesForSupplier` /
  `getOpenReimbursementsForEmployee` — payable targets, one per payee kind.
- `getArAging` / `getApAging` / `getArTieOut` / `getApTieOut` / `getArOpenByCustomer` /
  `getApOpenBySupplier` — drive `x+/reports+/{ar,ap}-aging.tsx`,
  `x+/invoicing+/{receivables,payables}.tsx` (`ARAPWorkbench`) and `_index.tsx`
  (`InvoicingDashboard`).
- `updateReimbursement` (Draft-scoped UPDATE) / `upsertReimbursementLines` (Kysely,
  delete-then-reinsert; bind dimensions by `sequence`, never by returned row order) /
  `getPaymentCurrencyConfiguration` (base currency + `currency.decimalPlaces`; throws when the
  currency is not configured for the company group).

## Related Modules

- **accounting** — postings write `journal`/`journalLine`;
  `accountDefault.employeeReimbursementsPayableAccount` is the reimbursement control account;
  the AR/AP adjust routes seed a Draft journal via `saveJournalEntryWithLines`.
- **sales** / **purchasing** — invoices convert from sales orders, shipments and POs; sales
  rules gate the sales-invoice post; `getCustomerPayment`/`getCustomerShipping` (and the
  supplier equivalents) seed invoice headers.
- **settings** — `getNextSequence`, `getCompanySettings` (`accountingCutoverDate`, read through
  `hasAccountingCutover` from accounting: before the cutover the receivables / payables
  workbenches and the invoicing dashboard skip the GL tie-out, and the adjust routes refuse),
  `party-contact.server`.
- **shared** — `getCompanyTimeZone` (`timezone.server`); `incoterms`/`itemType`/`methodType` from
  `shared.models` imported DIRECTLY, never via the `../shared` barrel (which drags Lingui macros
  into plain unit tests).

## Rules References

- `.claude/rules/numeric-precision.md` — the two storage scales, `applyRate`/`round`,
  `toBaseAmount`/`toDocumentAmount`, and why `appliedAmount` vs `sourceAmount` matters
- `.claude/rules/accounting-sync-handlers.md` — how posted invoices, memos, payments, charges
  and reimbursements reach Xero / QuickBooks / Rillet
- `.claude/rules/ramp-integration.md` — where `charge` and `reimbursement` rows come from
- `.claude/rules/conventions-forms.md` — `ValidatedForm` + zod + route-action shape
- `packages/server-functions/AGENTS.md` — the `post-*` server functions these routes call
