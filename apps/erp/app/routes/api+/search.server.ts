// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  anyOf,
  type ExpandedClaims,
  holdsGate,
  ownersOf,
  widenReads
} from "@carbon/database/access";

/** The table behind each `searchIndex` entity type. */
const ENTITY_TABLES = {
  employee: "employee",
  customer: "customer",
  supplier: "supplier",
  issue: "nonConformance",
  gauge: "gauge",
  item: "item",
  job: "job",
  purchaseOrder: "purchaseOrder",
  salesInvoice: "salesInvoice",
  purchaseInvoice: "purchaseInvoice",
  quote: "quote",
  salesRfq: "salesRfq",
  salesOrder: "salesOrder",
  supplierQuote: "supplierQuote"
} as const;

/**
 * The entity types the person may search: View on a page that owns the
 * type's table, widened as a data read is, so a type shows iff its records'
 * list could be read. A `typeFilter` other than "all" narrows to that one
 * type, and only if it is allowed.
 */
export function searchableTypes(
  permissions: ExpandedClaims | null | undefined,
  companyId: string,
  typeFilter?: string
): string[] {
  return Object.entries(ENTITY_TABLES)
    .filter(
      ([entityType]) =>
        !typeFilter || typeFilter === "all" || entityType === typeFilter
    )
    .filter(([, table]) =>
      holdsGate(
        permissions,
        widenReads(anyOf(ownersOf(table), "View")),
        companyId
      )
    )
    .map(([entityType]) => entityType);
}
