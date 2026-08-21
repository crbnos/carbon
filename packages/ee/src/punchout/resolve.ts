import type { PunchoutCart } from "./types";

export type ResolvedCartLine = {
  purchaseOrderLineType: "Part" | "G/L Account";
  itemId: string | null;
  accountId: string | null;
  description: string;
  purchaseQuantity: number;
  supplierUnitPrice: number;
  supplierPartId: string;
  supplierPartAuxiliaryId: string | null;
  purchaseUnitOfMeasureCode: string;
  inventoryUnitOfMeasureCode: string | null;
  conversionFactor: number;
  issues: string[];
};

export type SupplierPartCrossReference = {
  supplierPartId: string;
  itemId: string;
  supplierUnitOfMeasureCode: string | null;
  conversionFactor: number | null;
  inventoryUnitOfMeasureCode?: string | null;
};

/**
 * Resolve a punchout cart into purchase-order line inputs. Pure — no DB — so the
 * whole resolution matrix is unit-testable.
 *
 * - `supplierPartId` matches a cross-reference (case-insensitive) → Part line
 *   carrying the cross-reference's UOM/conversion.
 * - No match → G/L Account line against `defaultExpenseAccountId` with the cart
 *   description; the `supplierPartId` is still carried on the line.
 * - A cart UOM code not present in `uomCodes` falls back to "EA" and records an
 *   issue on the line.
 *
 * Prices pass through untouched — rounding happens at persist (internal scale).
 */
export function resolveCartLines(input: {
  cart: PunchoutCart;
  supplierParts: SupplierPartCrossReference[];
  uomCodes: string[];
  defaultExpenseAccountId: string;
}): ResolvedCartLine[] {
  const { cart, supplierParts, uomCodes, defaultExpenseAccountId } = input;

  const byPartId = new Map<string, SupplierPartCrossReference>();
  for (const part of supplierParts) {
    byPartId.set(part.supplierPartId.toLowerCase(), part);
  }
  const uomSet = new Set(uomCodes);

  return cart.lines.map((line) => {
    const issues: string[] = [];

    // Map the cart's UOM code to a company code, defaulting to EA when unknown.
    let purchaseUnitOfMeasureCode = line.unitOfMeasureCode;
    if (!uomSet.has(purchaseUnitOfMeasureCode)) {
      issues.push(
        `Unmapped unit of measure "${line.unitOfMeasureCode}" — defaulted to EA`
      );
      purchaseUnitOfMeasureCode = "EA";
    }

    const match = byPartId.get(line.supplierPartId.toLowerCase());
    if (match) {
      return {
        purchaseOrderLineType: "Part",
        itemId: match.itemId,
        accountId: null,
        description: line.description,
        purchaseQuantity: line.quantity,
        supplierUnitPrice: line.unitPrice,
        supplierPartId: line.supplierPartId,
        supplierPartAuxiliaryId: line.supplierPartAuxiliaryId,
        purchaseUnitOfMeasureCode: match.supplierUnitOfMeasureCode
          ? match.supplierUnitOfMeasureCode
          : purchaseUnitOfMeasureCode,
        inventoryUnitOfMeasureCode: match.inventoryUnitOfMeasureCode ?? null,
        conversionFactor: match.conversionFactor ?? 1,
        issues
      };
    }

    return {
      purchaseOrderLineType: "G/L Account",
      itemId: null,
      accountId: defaultExpenseAccountId,
      description: line.description,
      purchaseQuantity: line.quantity,
      supplierUnitPrice: line.unitPrice,
      supplierPartId: line.supplierPartId,
      supplierPartAuxiliaryId: line.supplierPartAuxiliaryId,
      purchaseUnitOfMeasureCode,
      inventoryUnitOfMeasureCode: null,
      conversionFactor: 1,
      issues
    };
  });
}
