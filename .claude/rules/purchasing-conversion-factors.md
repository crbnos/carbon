---
paths:
  - "apps/erp/app/modules/purchasing/**"
  - "apps/erp/app/components/Form/ConversionFactor.tsx"
  - "packages/database/supabase/functions/{create,convert,update-purchased-prices}/index.ts"
  - "packages/database/supabase/migrations/*conversion*.sql"
---

# Purchasing Conversion Factors

Lets an item be **purchased in one unit of measure and stocked in another**. The
`conversionFactor` is the number of **inventory units per one purchase unit**:

```
inventoryQuantity = purchaseQuantity * conversionFactor
inventoryUnitCost = purchaseUnitPrice  / conversionFactor
```

When purchase UoM == inventory UoM the factor is `1` (the UI disables the input).

## Where the factor is stored (schema)

The physical column is named `conversionFactor` on every table below (the column
is **not** abbreviated; the planning views use a separate `ln` alias internally,
not the base column). Verify against the newest migration before relying on a default.

| Table | Column | Type / default | Migration |
|---|---|---|---|
| `purchaseOrderLine` | `conversionFactor` | `NUMERIC(10,2) DEFAULT 1` | `20240402052512_purchasing-conversion-factors.sql` |
| `purchaseInvoiceLine` | `conversionFactor` | `NUMERIC(10,2) DEFAULT 1` | `20240402052512_purchasing-conversion-factors.sql` |
| `receiptLine` | `conversionFactor` | `NUMERIC(10,2) DEFAULT 1` | `20240402052512_purchasing-conversion-factors.sql` |
| `supplierQuoteLine` | `conversionFactor` | `NUMERIC(10,5) DEFAULT 1`, NOT NULL | `20241202192419_supplier-quotes.sql` |
| `supplierPart` (was `buyMethod`) | `conversionFactor` | `NUMERIC(15,5) DEFAULT 1`, NOT NULL | `20230330024716_parts.sql` |

`supplierPart` is the **source default** (`buyMethod` was renamed in
`20241202145357_rename-buyMethod-to-supplierPart.sql`). It also has
`supplierUnitOfMeasureCode` — it does **not** split into purchase/inventory UoM
columns. The line tables (`purchaseOrderLine`, `supplierQuoteLine`, etc.) carry
both `inventoryUnitOfMeasureCode` and `purchaseUnitOfMeasureCode` (FKs to
`unitOfMeasure`). `receiptLine` stores only a denormalized `unitOfMeasure` text.

Quote/sales-order lines (`quoteLine`, `salesOrderLine`) have **no**
`conversionFactor` — they only have a single `unitOfMeasureCode`.

## Where it's applied

**Auto-load on item select.** Forms hydrate `conversionFactor` from the supplier
part, with a fallback chain:
- `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderLineForm.tsx`:
  `supplierPart?.data?.conversionFactor ?? itemReplenishment?.conversionFactor ?? 1`
- `SupplierQuoteLineForm.tsx`: `supplierPart.data?.conversionFactor ?? 1`

**Validators** (`apps/erp/app/modules/purchasing/purchasing.models.ts`,
`apps/erp/app/modules/items/items.models.ts`): the field is
`conversionFactor: zfd.numeric(z.number().optional())` on the purchasing line
validators, and `zfd.numeric(z.number().min(0))` on `supplierPartValidator`.
(`>0` is not enforced in zod; `supplierPart` allows `0`.)

**Receipt / inventory posting — the real conversion happens here.** When a PO is
received, the `create` edge function converts purchase quantities to inventory
quantities and unit cost to inventory unit cost
(`packages/database/supabase/functions/create/index.ts`):

```ts
orderQuantity:    d.purchaseQuantity * (d.conversionFactor ?? 1),
receivedQuantity: outstandingQuantity * (d.conversionFactor ?? 1),
unitPrice:        unitPrice / (d.conversionFactor ?? 1) + shippingAndTaxUnitCost,
unitOfMeasure:    d.inventoryUnitOfMeasureCode ?? "EA",
```

`shippingAndTaxUnitCost` is also spread over inventory units
(`(taxAmount + shippingCost) / (purchaseQuantity * conversionFactor)`).
The `convert` (quote→PO) and `update-purchased-prices` functions carry the factor
forward likewise (`update-purchased-prices` uses the planning `ln` alias).

**Reverse direction (planning → purchase qty).** MRP/planning has an inventory
requirement and computes the purchase quantity, rounding up:
`Math.ceil(inventoryQuantity / conversionFactor)` (when factor > 0) — see
`PurchasingPlanningOrderDrawer.tsx` and `items/ui/Item/ItemReorderPolicy.tsx`.

**Display-only conversions** multiply purchase qty by the factor to show derived
inventory qty (e.g. `PurchaseOrderSummary.tsx`, `SupplierQuoteSummary.tsx`) and
divide price by it for inventory unit price (`SupplierQuoteLinePricing.tsx`).

## Gotchas

- The generated price columns (`unitPrice`, `extendedPrice`, etc.) on
  `purchaseOrderLine` / `supplierQuoteLinePrice` are `GENERATED ALWAYS` and only
  divide by **`exchangeRate`** — they do **NOT** divide by `conversionFactor`
  (`20250807094441_fix-purchasing-conversion-factor.sql`). The conversion-factor
  division is applied in **app/edge-function code**, not in those DB columns.
- Exchange-rate direction: `supplierUnitPrice / exchangeRate` (supplier→base
  currency), guarded against divide-by-zero.
- Precision differs by table (`supplierPart` 15,5 vs line tables 10,2) — a
  factor like `10.764` is rounded to 2 dp once it lands on a PO/invoice/receipt line.

## UI component

`apps/erp/app/components/Form/ConversionFactor.tsx` — modal input showing both
directions ("There are N {inventory} in one {purchase}" and the inverse
`1 / conversionFactor`). Disabled when `inventoryCode === purchasingCode`.
Props: `name`, `label?`, `inventoryCode`, `purchasingCode`, `value`, `onChange`,
`isReadOnly`, `isRequired`. Used by `SupplierPartForm`, PO and supplier-quote line forms.
