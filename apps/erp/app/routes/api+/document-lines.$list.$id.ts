// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { getListDefinition } from "~/utils/list-registry/index.server";
import {
  type DocumentLineList,
  documentLineLists,
  loadedSearchLines,
  type SearchLine
} from "~/utils/search";

const logger = getLogger("erp", "document-lines");

// The view a list's rows come from, by list key.
const views = {
  "purchase-orders": "purchaseOrders",
  "supplier-quotes": "supplierQuotes",
  "purchasing-rfqs": "purchasingRfqs",
  "purchase-invoices": "purchaseInvoices",
  "sales-orders": "salesOrders",
  quotes: "quotes",
  "sales-rfqs": "salesRfqs",
  "sales-invoices": "salesInvoices"
} as const satisfies Record<DocumentLineList, string>;

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
  const definition = getListDefinition(list);
  if (!definition) throw new Error(`No list registry entry for ${list}`);
  const { client, companyId } = await authorize(request, definition.gate);

  const result = await client
    .from(views[list])
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
