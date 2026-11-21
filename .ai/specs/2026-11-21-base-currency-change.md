# Change the base currency before the first transaction

Linear: ENG-200.

## TLDR

A company can change its base currency until it records its first transaction. The change keeps every stored number and reads it in the new currency; it never converts. One SQL function lists why a change is refused. The `company` trigger enforces it, and the form and the API read it.

## Problem

- A company that picks the wrong base currency at signup cannot correct it, even with no data.
- Settings → Company shows the field read-only for every company (#1556).
- After the accounting enable, the database refuses the change (#1888).
- Before the enable, the API, the subsidiary form and a direct write change it with no check and convert nothing.
- Onboarding defaults the base currency to USD whatever the country, so the mistake is easy to make.

## Rule

The base currency can change while `base_currency_change_blockers(companyId)` returns no row:

| Reason | Holds when |
|---|---|
| `ledger-has-amounts` | a `journalLine` with a non-zero amount, any journal status (Draft opening trial balance, Provisional, Posted, Reversed, Superseded) |
| `has-documents` | a quote, sales order, sales invoice, sales return order, supplier quote, purchase order, purchase invoice, purchase return order, receipt, shipment, payment, memo, charge, reimbursement, customer contract, rental agreement, lease or intercompany transaction, any status |
| `has-stock-or-costs` | an `itemLedger`, `costLedger`, `supplierLedger` or `projectLedger` row |
| `has-fixed-assets` | a `fixedAsset` |
| `group-has-data` | the company is a parent and another company of its group fails one of the four checks above |
| `accounting-integration` | an active Xero, QuickBooks Online, Rillet or Ramp connection, their `externalIntegrationMapping` rows, or `accountingSyncOperation` / `accountingSyncTieOut` rows |

- `accountingActivatedAt` no longer locks the base currency. An activated company with an empty ledger can change; one with a journal line cannot.
- A subsidiary needs only its own checks: consolidation reads its base live, and its history is empty.

## What a change writes (one transaction)

1. The `company` row; the trigger checks the blockers. The old base is read under the row lock; a save that finds it already moved writes nothing else.
2. Deletes the company's `exchangeRateOverride` rows.
3. Makes the new base active in the group's `currency` rows (inserts it with its ISO decimals when missing).
4. Moves `itemUnitSalePrice`, `itemRentalRate` and `customerItemRentalRate` to the new code; a rate that already exists in the new code (same item, and same customer or customer type) keeps both.
5. Unless `keepRecordCurrencies`, moves `customer`, `supplier`, `supplierPart`, `customerBankAccount` and `supplierBankAccount` rows set to the old base.
6. Moves a parent's elimination entity.

Rows with a NULL currency code mean base and follow the new one.

Kept as entered (shown in the form before saving): item costs, item prices, work center rates, approval rule bounds, and every other base amount with no currency column.

## Surfaces

- `getBaseCurrencyChange` (settings, `view`, published): blockers and the counts the form shows. Another company of the group needs multi-company management, as its update does.
- `updateCompanyDetails` and `updateSubsidiaryDetails` refuse with the reasons (`rule`) instead of a failed write, and take `keepRecordCurrencies`.
- A save that keeps the base leaves `baseCurrencyCode` out of its write. So it cannot undo a change that commits after its read.
- Settings → Company takes the form's base from `getBaseCurrencyChange`, which reads the row on every load. The root loader's copy can lag.
- Settings → Company and Settings → Companies → edit: `BaseCurrencyField` is editable when nothing blocks, lists the reasons otherwise, and states what a change keeps and moves. The keep switch counts customers, suppliers, supplier parts and bank accounts set to the old base, and shows when the count is above 0.
- The Companies edit page has no link from the Companies list yet; it opens by URL (`/x/settings/companies/:id`). `updateSubsidiaryDetails` refuses a company as its own parent.

## Out of scope

- Converting a company that holds documents (re-rating documents, scaling base amounts).
- An audit log entry: `company` is not in `audit.config.ts`.
- Defaulting the onboarding currency from the country.

## Tests

- `packages/database/supabase/tests/base-currency-change.test.sql`: no data changes (before and after the enable), a zero journal line does not block, a journal line, a quote, a stock movement, a fixed asset, a provider mapping and a connected provider block, an item or a customer alone does not, a parent blocks on its group's data, a subsidiary with no data changes.
- `apps/erp/test/database/base-currency-change.test.ts`: a change moves records, prices, rental rates and the elimination entity and keeps every amount; `keepRecordCurrencies` keeps customers, suppliers, supplier parts and bank accounts; rates already in the new base keep both; a save that keeps the base deletes no override; the preview counts bank accounts.
- `accounting-cutover-guards.test.sql`: the dataset-apply bypass leaves a base currency its data locks locked.
