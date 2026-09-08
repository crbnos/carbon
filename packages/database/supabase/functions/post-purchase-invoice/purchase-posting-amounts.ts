export type PurchasePostingLine = {
  id: string;
  invoiceLineType: string;
  quantity: number;
  conversionFactor: number | null;
  /** Generated company-base amount per purchase unit. */
  unitPrice: number | null;
  /** Generated company-base line freight and nonrecoverable tax. */
  shippingCost: number | null;
  taxAmount: number | null;
  /** Supplier-currency fields used only for the existing pretax IC matching basis. */
  supplierUnitPrice?: number | null;
  supplierShippingCost?: number | null;
};

export type PurchasePostingAmounts = {
  id: string;
  inventoryQuantity: number;
  nominalBaseCost: number;
  headerShippingBase: number;
  totalBaseCost: number;
  inventoryUnitCost: number;
  intercompanyDocumentAmount: number;
};

/** Both the PO counter and invoice quantity are in purchase units. */
export function getInvoicedPurchaseQuantityAfterVoid(
  quantityInvoiced: number | null,
  invoicePurchaseQuantity: number,
): number {
  return Math.max(0, (quantityInvoiced ?? 0) - invoicePurchaseQuantity);
}

export function calculatePurchasePostingAmounts(input: {
  lines: PurchasePostingLine[];
  exchangeRate: number;
  supplierShippingCost: number;
}): PurchasePostingAmounts[] {
  const lines = input.lines.filter((line) =>
    line.invoiceLineType !== "Comment"
  );
  const headerBase = toBaseAmount(
    input.supplierShippingCost,
    input.exchangeRate,
  );
  const costs = lines.map((line) => {
    const factor = line.conversionFactor ?? 1;
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(
        `Purchase line ${line.id} conversion factor must be positive and finite`,
      );
    }
    const nominal = line.quantity * (line.unitPrice ?? 0);
    const cost = nominal + (line.shippingCost ?? 0) + (line.taxAmount ?? 0);
    const inventoryQuantity = line.quantity * factor;
    const intercompanyDocumentAmount =
      line.quantity * (line.supplierUnitPrice ?? 0) +
      (line.supplierShippingCost ?? 0);
    if (
      ![nominal, cost, inventoryQuantity, intercompanyDocumentAmount].every(
        Number.isFinite,
      )
    ) {
      throw new Error(`Purchase line ${line.id} amounts must be finite`);
    }
    return { nominal, cost, inventoryQuantity, intercompanyDocumentAmount };
  });
  const totalLinesCost = costs.reduce((sum, row) => sum + row.cost, 0);
  let allocatedHeader = 0;
  return lines.map((line, index) => {
    const { nominal, cost, inventoryQuantity, intercompanyDocumentAmount } =
      costs[index];
    const weight = totalLinesCost === 0
      ? 1 / lines.length
      : cost / totalLinesCost;
    // Reconcile the final share to the converted header, so all posted shares
    // retain the total even when an equal allocation crosses internal precision.
    const headerShippingBase = round(
      index === lines.length - 1
        ? headerBase - allocatedHeader
        : headerBase * weight,
    );
    allocatedHeader += headerShippingBase;
    // Generated line fields are already base; only supplier header freight is
    // converted. These same amounts fund AP, inventory/expense and acquisition.
    const totalBaseCost = round(cost + headerShippingBase);
    return {
      id: line.id,
      inventoryQuantity,
      nominalBaseCost: round(nominal),
      headerShippingBase,
      totalBaseCost,
      inventoryUnitCost: inventoryQuantity === 0
        ? 0
        : totalBaseCost / inventoryQuantity,
      intercompanyDocumentAmount,
    };
  });
}
import { toBaseAmount } from "../shared/accounting-currency.ts";
import { round } from "../shared/precision.ts";
