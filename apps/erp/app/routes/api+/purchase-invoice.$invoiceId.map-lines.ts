// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { mapPurchaseInvoiceLines } from "~/modules/invoicing/invoicing.server";
import { resolveItemIdFromExtractedText } from "~/modules/items/items.service";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("invoiceId required");

  const url = new URL(request.url);
  const supplierId = url.searchParams.get("supplierId");

  const { data: lines } = await client
    .from("purchaseInvoiceLine")
    .select("id, description, quantity, supplierUnitPrice, invoiceLineType")
    .eq("invoiceId", invoiceId)
    .is("itemId", null)
    .eq("invoiceLineType", "Comment");

  if (!lines || lines.length === 0) {
    return { data: [] };
  }

  const suggestions = [];

  // The invoice line only carries a description (which prefers the extracted
  // part number when one was found), so that's our single candidate string.
  for (const line of lines) {
    const suggestedItemId = await resolveItemIdFromExtractedText(
      client,
      companyId,
      { type: "supplier", id: supplierId },
      [line.description]
    );

    suggestions.push({
      lineId: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.supplierUnitPrice,
      suggestedItemId,
      action: suggestedItemId ? "map" : "create" // "map" | "create" | "ignore"
    });
  }

  return { data: suggestions };
}

// The form posts the mappings as JSON in one field.
const mappingForm = z.object({
  mappings: zfd.json(mapPurchaseInvoiceLines.input.shape.mappings)
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(mappingForm).request(args, {
    params: ["invoiceId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.invoicing.mapPurchaseInvoiceLines({
    ...input.data,
    invoiceId: input.params.invoiceId
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
