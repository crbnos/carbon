// Pure inbound-resolution helpers. No DB access, no fetch — the caller pre-fetches
// the cross-reference rows and passes them in. Every miss becomes an EdiIssue so
// the document lands in the review queue with an actionable list.

import type { EdiIssue, EdiOrderPayload } from "./types";

type PartMapping = {
  customerPartId: string;
  customerPartRevision: string;
  itemId: string;
};

/**
 * Resolve each inbound order line to a Carbon item via the resolution ladder:
 *   per-customer part cross-reference (customerPartId + revision) →
 *   exact item readableId → unresolved (issue naming the buyer part).
 */
export function resolveOrderLines(
  payload: EdiOrderPayload,
  args: {
    partMappings: PartMapping[];
    itemsByReadableId: Record<string, string>;
  }
): {
  lines: Array<{
    line: EdiOrderPayload["lines"][number];
    itemId: string | null;
  }>;
  issues: EdiIssue[];
} {
  const issues: EdiIssue[] = [];
  const lines = payload.lines.map((line) => {
    const revision = line.partnerPartRevision ?? "";
    const mapping = args.partMappings.find(
      (m) =>
        m.customerPartId === line.partnerPartId &&
        (m.customerPartRevision ?? "") === revision
    );
    let itemId: string | null = mapping?.itemId ?? null;
    if (!itemId) {
      itemId = args.itemsByReadableId[line.partnerPartId] ?? null;
    }
    if (!itemId) {
      issues.push({
        code: "unknown-part",
        message: `Unknown buyer part ${line.partnerPartId}`,
        path: `lines.${line.partnerLineNumber}`,
        context: { partnerPartId: line.partnerPartId }
      });
    }
    return { line, itemId };
  });
  return { lines, issues };
}

/**
 * Flag any line whose document unit price deviates from Carbon's expected price
 * beyond the per-partner tolerance. Boundary rule: exactly at tolerance passes;
 * tolerance 0 means any deviation fails.
 */
export function checkPrices(
  lines: Array<{
    itemId: string;
    unitPrice: number;
    expectedPrice: number | null;
  }>,
  tolerancePercent: number
): EdiIssue[] {
  const issues: EdiIssue[] = [];
  for (const line of lines) {
    if (line.expectedPrice != null) {
      const allowed = line.expectedPrice * tolerancePercent;
      if (Math.abs(line.unitPrice - line.expectedPrice) > allowed) {
        issues.push({
          code: "price-mismatch",
          message: `Unit price ${line.unitPrice} deviates from expected ${line.expectedPrice}`,
          context: {
            itemId: line.itemId,
            unitPrice: line.unitPrice,
            expectedPrice: line.expectedPrice
          }
        });
      }
    }
  }
  return issues;
}

/** Resolve the buyer ship-to code to a Carbon customer location. */
export function checkShipTo(
  code: string,
  locationMappings: Array<{ externalCode: string; customerLocationId: string }>
): { customerLocationId: string | null; issues: EdiIssue[] } {
  const match = locationMappings.find((m) => m.externalCode === code);
  if (match) {
    return { customerLocationId: match.customerLocationId, issues: [] };
  }
  return {
    customerLocationId: null,
    issues: [
      {
        code: "unknown-ship-to",
        message: `Unknown ship-to location code ${code}`,
        context: { code }
      }
    ]
  };
}

/** Flag a buyer PO number that has already been received (a different transaction id). */
export function checkDuplicateReference(
  partnerReference: string,
  existingReferences: string[]
): EdiIssue[] {
  if (existingReferences.includes(partnerReference)) {
    return [
      {
        code: "duplicate-reference",
        message: `A document with reference ${partnerReference} already exists`,
        context: { partnerReference }
      }
    ];
  }
  return [];
}
