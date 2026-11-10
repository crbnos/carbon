// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import type { PageId } from "@carbon/database/access";
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

// The list view a row comes from, and the page that list is on.
const sources = {
  "purchase-orders": {
    view: "purchaseOrders",
    page: "purchasing.purchaseOrders"
  },
  "supplier-quotes": {
    view: "supplierQuotes",
    page: "purchasing.supplierQuotes"
  },
  "purchasing-rfqs": { view: "purchasingRfqs", page: "purchasing.rfqs" },
  "purchase-invoices": {
    view: "purchaseInvoices",
    page: "invoicing.purchaseInvoices"
  },
  "sales-orders": { view: "salesOrders", page: "sales.salesOrders" },
  quotes: { view: "quotes", page: "sales.quotes" },
  "sales-rfqs": { view: "salesRfqs", page: "sales.rfqs" },
  "sales-invoices": { view: "salesInvoices", page: "invoicing.salesInvoices" }
} as const satisfies Record<DocumentLineList, { view: string; page: PageId }>;

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
  const { client, companyId } = await authorize(request, {
    [source.page]: "View"
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
