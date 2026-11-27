// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { fetchAllByIds, fetchAllRecords } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

const logger = getLogger("erp", "planning-open-lines");

const planningOpenLinesQueryValidator = z.object({
  itemId: z.string().min(1),
  locationId: z.string().min(1)
});

// The purchasing planning drawer's Open Orders: one item's open PO lines at
// one location, with each line's purchase quantity and conversion factor —
// the view reports quantities in INVENTORY units, and the drawer edits the
// line's own purchase quantity. Read as the caller, so RLS applies. The
// drawer maps the rows to its weeks.
export async function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).searchParams;
  const parsed = planningOpenLinesQueryValidator.safeParse({
    itemId: search.get("itemId"),
    locationId: search.get("locationId")
  });
  if (!parsed.success) {
    logger.warning("Planning open PO lines read refused: bad query", {
      issues: parsed.error.issues
    });
    throw data(
      { error: "itemId and locationId are required" },
      { status: 400 }
    );
  }
  const { itemId, locationId } = parsed.data;

  const { client, companyId } = await authorize(request, {
    "purchasing.materialPlanning": "View"
  });

  // The view keeps only the statuses MRP counts as supply (Planned, To
  // Receive, To Receive and Invoice), so no status filter here. Paged: a bare
  // select stops at PostgREST's max_rows, and the drawer would show a partial
  // list as the whole.
  const lines = await fetchAllRecords(() =>
    client
      .from("openPurchaseOrderLines")
      .select("*")
      .eq("companyId", companyId)
      .eq("itemId", itemId)
      // this page's location only: the rows are editable and charted there
      .eq("locationId", locationId)
      .order("id", { ascending: true })
  );
  if (lines.error) {
    logger.error("Failed to read the item's open purchase order lines", {
      itemId,
      locationId,
      error: lines.error
    });
    throw data(
      { error: "Failed to load the open purchase order lines" },
      { status: 500 }
    );
  }

  const lineIds = lines.data.flatMap((line) => (line.id ? [line.id] : []));
  const details = await fetchAllByIds(lineIds, (batch) =>
    client
      .from("purchaseOrderLine")
      .select(
        "id, purchaseQuantity, quantityToReceive, quantityReceived, conversionFactor"
      )
      .in("id", batch)
      .eq("companyId", companyId)
      .order("id", { ascending: true })
  );
  if (details.error) {
    logger.error("Failed to read the open purchase order lines' quantities", {
      itemId,
      locationId,
      lineCount: lineIds.length,
      error: details.error
    });
    throw data(
      { error: "Failed to load the open purchase order lines" },
      { status: 500 }
    );
  }

  return { lines: lines.data, details: details.data };
}

export const clientLoader = cachedClientLoader<typeof loader>();
