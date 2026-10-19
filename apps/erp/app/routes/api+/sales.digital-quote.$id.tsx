// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { notFound } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { selectedLinesValidator } from "~/modules/sales/sales.models";
import {
  acceptDigitalQuote,
  rejectDigitalQuote
} from "~/modules/sales/sales.server";
import { getQuoteByExternalId } from "~/modules/sales/sales.service";
import { shareLinkContext } from "~/modules/service-context.server";

const logger = getLogger("erp", "sales", "digital-quote");

const response = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("accept"),
    digitalQuoteAcceptedBy: z.string(),
    digitalQuoteAcceptedByEmail: z.string(),
    selectedLines: zfd.json(selectedLinesValidator),
    // Anything but an uploaded file is no file. A file input left empty still
    // submits a part (a File with no name and no bytes), so only a non-empty
    // File is an upload.
    file: z
      .unknown()
      .transform((file) =>
        file instanceof File && file.size > 0 ? file : undefined
      )
  }),
  z.object({
    type: z.literal("reject"),
    digitalQuoteRejectedBy: z.string(),
    digitalQuoteRejectedByEmail: z.string()
  })
]);

// Unauthenticated: the share link is the only credential, so the quote it
// names states the company and the actor.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(response).request(args, { params: ["id"] });
  if ("invalid" in input) {
    return { success: false, message: "Invalid response" };
  }

  const quote = await getQuoteByExternalId(
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
  const result =
    form.type === "accept"
      ? await acceptDigitalQuote(ctx, {
          quoteId: quote.data.id,
          selectedLines: form.selectedLines,
          acceptedBy: form.digitalQuoteAcceptedBy,
          acceptedByEmail: form.digitalQuoteAcceptedByEmail,
          purchaseOrderFile: form.file
        })
      : await rejectDigitalQuote(ctx, {
          quoteId: quote.data.id,
          rejectedBy: form.digitalQuoteRejectedBy,
          rejectedByEmail: form.digitalQuoteRejectedByEmail
        });
  if (result.error) return { success: false, message: result.error.message };
  return {
    success: true,
    message: form.type === "accept" ? "Quote accepted!" : "Quote rejected!"
  };
}
