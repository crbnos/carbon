// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { resolveItemIdFromExtractedText } from "~/modules/items/items.service";
import { mapSalesRfqLines } from "~/modules/sales/sales.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("rfqId required");

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");

  const { data: lines } = await client
    .from("salesRfqLine")
    .select("id, customerPartId, description, quantity")
    .eq("salesRfqId", rfqId)
    .is("itemId", null);

  if (!lines || lines.length === 0) {
    return { data: [] };
  }

  const suggestions = [];

  // Try every extracted string for a line — part number and description alike —
  // the classification doesn't matter; we just want the best chance of a match.
  for (const line of lines) {
    const suggestedItemId = await resolveItemIdFromExtractedText(
      client,
      companyId,
      { type: "customer", id: customerId },
      [line.customerPartId, line.description]
    );

    suggestions.push({
      lineId: line.id,
      customerPartId: line.customerPartId,
      description: line.description,
      quantity: line.quantity,
      suggestedItemId,
      action: suggestedItemId ? "map" : "create" // "map" | "create" | "ignore"
    });
  }

  return { data: suggestions };
}

// The form posts the mappings as JSON in one field.
const mappingForm = z.object({
  customerId: zfd.text(z.string().optional()),
  mappings: zfd.json(mapSalesRfqLines.input.shape.mappings)
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(mappingForm).request(args, {
    params: ["rfqId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.sales.mapSalesRfqLines({
    ...input.data,
    rfqId: input.params.rfqId
  });
  // The shared mapping modal reads `{ success, error }`, and closes on
  // success: a line that could not be mapped must keep it open.
  if (!result.data) return { success: false, error: result.error?.message };
  if (result.data.failed > 0) {
    return {
      success: false,
      error: "Some lines could not be mapped. Review them and try again."
    };
  }
  return { success: true };
}
