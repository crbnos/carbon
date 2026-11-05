// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PurchasingRfqData } from "./types";

/**
 * Merge-field variable map for a purchasing RFQ. Tokens mirror
 * `PURCHASING_RFQ_MERGE_FIELDS` in template/merge.ts.
 */
export function buildPurchasingRfqVars(
  data: Pick<PurchasingRfqData, "purchasingRfq" | "shipToAddress" | "company">
): Record<string, string> {
  const rfq = data.purchasingRfq;
  const str = (v: unknown): string => (v == null ? "" : String(v));

  return {
    "rfq.number": str(rfq?.rfqId),
    "rfq.date": str(rfq?.rfqDate),
    "rfq.dueDate": str(rfq?.expirationDate),
    "rfq.location": str(data.shipToAddress?.name ?? rfq?.locationName),
    "company.name": str(data.company?.name),
    "company.city": str(data.company?.city),
    "company.country": str(data.company?.countryCode),
    "company.taxId": str(data.company?.taxId),
    "company.eori": str(data.company?.eori),
    "company.vatNumber": str(data.company?.vatNumber),
    "company.registrationNumber": str(data.company?.registrationNumber)
  };
}
