import type { Violation } from "./storage-rules";

export type OverReceiptReceiptLine = {
  lineId: string | null;
  receivedQuantity: number | null;
  conversionFactor: number | null;
};

export type OverReceiptPurchaseOrderLine = {
  id: string;
  purchaseQuantity: number | null;
  quantityReceived: number | null;
  itemReadableId?: string | null;
};

/**
 * Receipt lines are in inventory units; purchase order lines are in purchase
 * units. Incoming quantity is converted with `receivedQuantity /
 * conversionFactor` (the same math post-receipt uses when advancing
 * `quantityReceived`) before comparing against the ordered quantity. Returns
 * `severity: "warn"` violations so the post action's acknowledge flow lets the
 * user confirm and proceed.
 */
export function getOverReceiptViolations(
  receiptLines: OverReceiptReceiptLine[],
  purchaseOrderLines: OverReceiptPurchaseOrderLine[]
): { violations: Violation[]; ruleNames: Record<string, string> } {
  const incomingByLine = new Map<string, number>();
  for (const line of receiptLines) {
    if (!line.lineId) continue;
    const quantityInPurchaseUnits =
      (line.receivedQuantity ?? 0) / (line.conversionFactor || 1);
    incomingByLine.set(
      line.lineId,
      (incomingByLine.get(line.lineId) ?? 0) + quantityInPurchaseUnits
    );
  }

  const round = (value: number) => Math.round(value * 100000) / 100000;

  const violations: Violation[] = [];
  const ruleNames: Record<string, string> = {};
  for (const poLine of purchaseOrderLines) {
    const incoming = incomingByLine.get(poLine.id);
    if (!incoming || incoming <= 0) continue;

    const ordered = poLine.purchaseQuantity ?? 0;
    const alreadyReceived = poLine.quantityReceived ?? 0;
    const total = alreadyReceived + incoming;
    // Small tolerance so float artifacts from unit conversion don't flag an
    // exact receipt as over.
    if (total > ordered + 1e-6) {
      const ruleId = `over-receipt:${poLine.id}`;
      violations.push({
        ruleId,
        severity: "warn",
        message: `${poLine.itemReadableId ?? "Line"}: receiving ${round(
          incoming
        )} would bring the total received to ${round(total)} of ${round(
          ordered
        )} ordered`
      });
      ruleNames[ruleId] = "Over Receipt";
    }
  }

  return { violations, ruleNames };
}
