// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toResult } from "@carbon/api/service-fn.server";
import { notFound } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  externalSupplierQuoteValidator,
  selectedLineSchema
} from "~/modules/purchasing/purchasing.models";
import {
  declineDigitalSupplierQuote,
  submitDigitalSupplierQuote,
  updateDigitalSupplierQuoteLineNotes
} from "~/modules/purchasing/purchasing.server";
import { getSupplierQuoteByExternalLinkId } from "~/modules/purchasing/purchasing.service";
import { shareLinkContext } from "~/modules/service-context.server";

const logger = getLogger("erp", "purchasing", "digital-quote");

const response = z.discriminatedUnion("intent", [
  externalSupplierQuoteValidator.extend({
    intent: z.literal("submit"),
    // lineId → quantity → the supplier's price for that quantity.
    selectedLines: zfd.json(
      z.record(z.string(), z.record(z.string(), selectedLineSchema))
    )
  }),
  externalSupplierQuoteValidator.extend({ intent: z.literal("decline") }),
  z.object({
    intent: z.literal("updateNotes"),
    lineId: z.string().min(1),
    notes: zfd.json(z.unknown()).optional()
  })
]);

// Unauthenticated: the share link is the only credential, so the quote it
// names states the company and the actor.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(response).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;

  const quote = await getSupplierQuoteByExternalLinkId(
    getCarbonServiceRole(),
    input.params.id
  );
  if (quote.error) {
    logger.error("Quote not found", { error: quote.error });
    return { success: false, message: "Quote not found" };
  }
  const ctx = await shareLinkContext(quote.data);
  if (!ctx) throw notFound("Quote not found");

  const form = input.data;
  const supplierQuoteId = quote.data.id;
  switch (form.intent) {
    case "submit":
      return toResult(
        await submitDigitalSupplierQuote(ctx, {
          supplierQuoteId,
          submittedBy: form.digitalSupplierQuoteSubmittedBy,
          submittedByEmail: form.digitalSupplierQuoteSubmittedByEmail,
          selectedLines: form.selectedLines
        })
      );
    case "decline":
      return toResult(
        await declineDigitalSupplierQuote(ctx, {
          supplierQuoteId,
          submittedBy: form.digitalSupplierQuoteSubmittedBy,
          submittedByEmail: form.digitalSupplierQuoteSubmittedByEmail,
          note: form.note
        })
      );
    case "updateNotes":
      return toResult(
        await updateDigitalSupplierQuoteLineNotes(ctx, {
          supplierQuoteId,
          lineId: form.lineId,
          notes: form.notes ?? null
        })
      );
  }
}
