// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { data } from "react-router";
import {
  getQuoteLinePriceTraces,
  QuoteLockedError,
  repriceQuoteLineFromRules
} from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "quoteid-lineid-price-trace");

// Today's calculation is expensive (a cost rollup and a price resolution per
// quantity); the pricing grid loads it when it needs it rather than after
// every action on the page.
export const shouldRevalidate: ShouldRevalidateFunction = () => false;

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Read-only: explains the stored prices, writes nothing.
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const traces = await getQuoteLinePriceTraces(
    client,
    companyId,
    quoteId,
    lineId
  );
  if (traces.error) {
    logger.error("Failed to load quote line price traces", {
      companyId,
      quoteId,
      lineId,
      error: traces.error
    });
    return data(
      { traces: [], error: "Failed to load pricing trace" },
      { status: 500 }
    );
  }
  if (!traces.data) throw new Response(null, { status: 404 });

  return data({ traces: traces.data, error: null });
}

// Reprice: store what today's rules give, with the trace that explains it.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales",
    role: "employee"
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const repriced = await repriceQuoteLineFromRules(
    client,
    getDatabaseClient(),
    companyId,
    quoteId,
    lineId,
    userId
  );
  if (repriced.error instanceof QuoteLockedError) {
    return data({ error: repriced.error.message }, { status: 400 });
  }
  if (repriced.error) {
    logger.error("Failed to reprice quote line", {
      companyId,
      quoteId,
      lineId,
      error: repriced.error
    });
    return data({ error: "Failed to reprice quote line" }, { status: 500 });
  }

  return data({ error: null });
}
