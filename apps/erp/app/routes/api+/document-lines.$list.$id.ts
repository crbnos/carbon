// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import {
  type DocumentLineList,
  documentLineLists,
  loadedSearchLines,
  type SearchLine
} from "~/utils/search";

const logger = getLogger("erp", "document-lines");

// The list view a row comes from, and the permission that list needs.
const sources = {
  "purchase-orders": { view: "purchaseOrders", module: "purchasing" },
  "supplier-quotes": { view: "supplierQuotes", module: "purchasing" },
  "purchasing-rfqs": { view: "purchasingRfqs", module: "purchasing" },
  "purchase-invoices": { view: "purchaseInvoices", module: "invoicing" },
  "sales-orders": { view: "salesOrders", module: "sales" },
  quotes: { view: "quotes", module: "sales" },
  "sales-rfqs": { view: "salesRfqs", module: "sales" },
  "sales-invoices": { view: "salesInvoices", module: "invoicing" }
} as const satisfies Record<
  DocumentLineList,
  { view: string; module: "purchasing" | "sales" | "invoicing" }
>;

function isDocumentLineList(
  list: string | undefined
): list is DocumentLineList {
  return (documentLineLists as readonly string[]).includes(list ?? "");
}

// The lines of one document, read when its row is opened on a list.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { list, id } = params;
  if (!isDocumentLineList(list) || !id) {
    throw new Response("The document could not be found.", { status: 404 });
  }
  const source = sources[list];
  const { client, companyId } = await requirePermissions(request, {
    view: source.module
  });

  const result = await client
    .from(source.view)
    .select("id, searchLines")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();

  if (result.error) {
    logger.error("Failed to load the document lines", {
      companyId,
      list,
      id,
      error: result.error
    });
    return { lines: null as SearchLine[] | null };
  }
  return { lines: result.data ? (loadedSearchLines(result.data) ?? []) : [] };
}

// Lines change when the document is edited: show the cached lines at once and
// read them again.
export const clientLoader = cachedClientLoader<typeof loader>({ staleTime: 0 });
