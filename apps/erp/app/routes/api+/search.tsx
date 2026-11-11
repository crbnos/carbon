// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  anyOf,
  type ExpandedClaims,
  holdsGate,
  ownersOf,
  widenReads
} from "@carbon/database/access";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";

const logger = getLogger("erp", "search");

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
 * list could be read.
 */
function searchableTypes(
  permissions: ExpandedClaims | null | undefined,
  companyId: string
): string[] {
  return Object.entries(ENTITY_TABLES)
    .filter(([, table]) =>
      holdsGate(
        permissions,
        widenReads(anyOf(ownersOf(table), "View")),
        companyId
      )
    )
    .map(([entityType]) => entityType);
}

export type SearchResult = {
  id: number;
  entityType: string;
  entityId: string;
  title: string;
  description: string | null;
  link: string;
  tags: string[];
  metadata: Record<string, unknown>;
};

export type SearchResponse = {
  results: SearchResult[];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId, permissions } = await authorize(request);

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  const typeFilter = url.searchParams.get("type")?.trim();

  if (!query || query.length < 2) {
    return Response.json({ results: [] } satisfies SearchResponse);
  }

  let allowedEntityTypes = searchableTypes(permissions, companyId);
  if (typeFilter && typeFilter !== "all") {
    allowedEntityTypes = allowedEntityTypes.filter((t) => t === typeFilter);
  }

  if (allowedEntityTypes.length === 0) {
    return Response.json({ results: [] } satisfies SearchResponse);
  }

  const serviceRole = getCarbonServiceRole();

  try {
    const { data, error } = await serviceRole.rpc("search_company_index", {
      p_company_id: companyId,
      p_query: query,
      p_entity_types: allowedEntityTypes,
      p_limit: 20
    });

    if (error) {
      logger.error("Search error", { error: error });
      return Response.json({ results: [] } satisfies SearchResponse);
    }

    return Response.json({
      results: (data ?? []) as SearchResult[]
    } satisfies SearchResponse);
  } catch (err) {
    logger.error("Search error", { error: err });
    return Response.json({ results: [] } satisfies SearchResponse);
  }
}
