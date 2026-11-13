// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type ExpandedClaims,
  holdsGate,
  tableReadGate
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
 * The entity types the person may search, as RLS would admit the read
 * (`tableReadGate`): the search itself reads as the service role.
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
      holdsGate(permissions, tableReadGate(table), companyId)
    )
    .map(([entityType]) => entityType);
}
