// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { quoteLinePriceTraceValidator } from "~/modules/sales";
import { getQuoteLinePriceTraces } from "~/modules/sales/sales.server";

const logger = getLogger("erp", "api-sales-quote-line-price-trace");

// Read-only: explains how each quantity break of a quote line is priced.
// Nothing is persisted, so `view` is sufficient.
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const payload = quoteLinePriceTraceValidator.safeParse(await request.json());

  if (!payload.success) {
    return data({ traces: null, error: "Invalid request" }, { status: 400 });
  }

  const { quoteId, quoteLineId, rollupPrices } = payload.data;

  const traces = await getQuoteLinePriceTraces(
    client,
    companyId,
    quoteId,
    quoteLineId,
    Object.fromEntries(
      Object.entries(rollupPrices).map(([quantity, price]) => [
        Number(quantity),
        price
      ])
    )
  );

  if (traces.error) {
    logger.error("Failed to trace quote line prices", {
      companyId,
      quoteId,
      quoteLineId,
      error: traces.error
    });
    return data(
      { traces: null, error: "Failed to explain quote line prices" },
      { status: 500 }
    );
  }

  return data({ traces: traces.data, error: null });
}
