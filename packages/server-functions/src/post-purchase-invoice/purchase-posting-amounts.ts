// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type ComponentTax, round, toBaseAmount } from "@carbon/utils";

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
  /** The supplier's tax (`taxAmount`) split by tax code component
   *  (`splitLineTax`, base). Its recoverable share goes to Tax Paid instead
   *  of cost. Empty or absent: all of `taxAmount` is cost, as before. */
  taxParts?: ComponentTax[];
  /** Tax the company self-assesses on a Reverse Charge code (the supplier
   *  charged none), split by component. Its recoverable share goes to Tax
   *  Paid, the rest to cost, and the whole to the reverse-charge account. */
  selfAssessedParts?: ComponentTax[];
};

export type PurchaseTaxLeg = {
  part: ComponentTax;
  /** Charged by the supplier (in AP) or self-assessed (reverse charge). */
  selfAssessed: boolean;
};

export type PurchasePostingAmounts = {
  id: string;
  inventoryQuantity: number;
  nominalBaseCost: number;
  headerShippingBase: number;
  /** Cost: net, shipping, header freight and the tax that is not
   *  recoverable. Inventory, expense and acquisition take this. */
  totalBaseCost: number;
  inventoryUnitCost: number;
  /** What AP owes: the cost plus the recoverable tax the supplier charged,
   *  less self-assessed tax (never owed to the supplier). */
  payableBaseCost: number;
  payableUnitCost: number;
  /** The recoverable tax, to Tax Paid. */
  recoverableTaxBase: number;
  /** All self-assessed tax, to the reverse-charge account. */
  selfAssessedTaxBase: number;
  taxLegs: PurchaseTaxLeg[];
  intercompanyDocumentAmount: number;
};

const sum = (values: number[]) => values.reduce((t, v) => t + v, 0);

/** Both the PO counter and invoice quantity are in purchase units. */
export function getInvoicedPurchaseQuantityAfterVoid(
  quantityInvoiced: number | null,
  invoicePurchaseQuantity: number
): number {
  return Math.max(0, (quantityInvoiced ?? 0) - invoicePurchaseQuantity);
}

export function calculatePurchasePostingAmounts(input: {
  lines: PurchasePostingLine[];
  exchangeRate: number;
  supplierShippingCost: number;
}): PurchasePostingAmounts[] {
  const lines = input.lines.filter(
    (line) => line.invoiceLineType !== "Comment"
  );
  const headerBase = toBaseAmount(
    input.supplierShippingCost,
    input.exchangeRate
  );
  const costs = lines.map((line) => {
    const factor = line.conversionFactor ?? 1;
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(
        `Purchase line ${line.id} conversion factor must be positive and finite`
      );
    }
    const nominal = line.quantity * (line.unitPrice ?? 0);
    const charged = line.taxParts ?? [];
    const selfAssessed = line.selfAssessedParts ?? [];
    const recoverableCharged = sum(charged.map((p) => p.recoverableAmount));
    const recoverableSelf = sum(selfAssessed.map((p) => p.recoverableAmount));
    const nonRecoverableSelf = sum(
      selfAssessed.map((p) => p.nonRecoverableAmount)
    );
    // Header freight is weighted on the gross line, as before recoverable tax
    // existed, so a company with no recoverable code allocates exactly as
    // today.
    const gross = nominal + (line.shippingCost ?? 0) + (line.taxAmount ?? 0);
    const cost = gross - recoverableCharged + nonRecoverableSelf;
    const inventoryQuantity = line.quantity * factor;
    const intercompanyDocumentAmount =
      line.quantity * (line.supplierUnitPrice ?? 0) +
      (line.supplierShippingCost ?? 0);
    if (
      ![nominal, cost, inventoryQuantity, intercompanyDocumentAmount].every(
        Number.isFinite
      )
    ) {
      throw new Error(`Purchase line ${line.id} amounts must be finite`);
    }
    return {
      nominal,
      gross,
      cost,
      inventoryQuantity,
      intercompanyDocumentAmount,
      recoverableCharged,
      recoverableSelf,
      nonRecoverableSelf,
      selfAssessedTotal: sum(selfAssessed.map((p) => p.taxAmount)),
      taxLegs: [
        ...charged.map((part) => ({ part, selfAssessed: false })),
        ...selfAssessed.map((part) => ({ part, selfAssessed: true }))
      ]
    };
  });
  const totalLinesCost = costs.reduce((total, row) => total + row.gross, 0);
  let allocatedHeader = 0;
  return lines.map((line, index) => {
    const {
      nominal,
      gross,
      cost,
      inventoryQuantity,
      intercompanyDocumentAmount,
      recoverableCharged,
      recoverableSelf,
      nonRecoverableSelf,
      selfAssessedTotal,
      taxLegs
    } = costs[index]!;
    const weight =
      totalLinesCost === 0 ? 1 / lines.length : gross / totalLinesCost;
    // Reconcile the final share to the converted header, so all posted shares
    // retain the total even when an equal allocation crosses internal precision.
    const headerShippingBase = round(
      index === lines.length - 1
        ? headerBase - allocatedHeader
        : headerBase * weight
    );
    allocatedHeader += headerShippingBase;
    // Generated line fields are already base; only supplier header freight is
    // converted. These same amounts fund AP, inventory/expense and acquisition.
    const totalBaseCost = round(cost + headerShippingBase);
    const payableBaseCost = round(
      totalBaseCost + recoverableCharged - nonRecoverableSelf
    );
    return {
      id: line.id,
      inventoryQuantity,
      nominalBaseCost: round(nominal),
      headerShippingBase,
      totalBaseCost,
      inventoryUnitCost:
        inventoryQuantity === 0 ? 0 : totalBaseCost / inventoryQuantity,
      payableBaseCost,
      payableUnitCost:
        inventoryQuantity === 0 ? 0 : payableBaseCost / inventoryQuantity,
      recoverableTaxBase: round(recoverableCharged + recoverableSelf),
      selfAssessedTaxBase: round(selfAssessedTotal),
      taxLegs,
      intercompanyDocumentAmount
    };
  });
}
