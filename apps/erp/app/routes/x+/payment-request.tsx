// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { paymentRequestValidator } from "~/modules/invoicing/invoicing.models";

// One action for every payment request change. Each intent calls one
// operation, which holds every rule; the fetcher revalidates the page.
const paymentRequestForm = z.discriminatedUnion("intent", [
  paymentRequestValidator.safeExtend({ intent: z.literal("save") }),
  z.object({
    intent: z.enum(["ready", "planned", "cancel"]),
    id: zfd.text(z.string())
  })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(paymentRequestForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const data = input.data;
  switch (data.intent) {
    case "save": {
      const {
        intent: _,
        id,
        purchaseInvoiceId,
        purchaseOrderId,
        ...fields
      } = data;
      // The form sends every field: an empty one clears it on an edit.
      return id
        ? api.invoicing.updatePaymentRequest({
            id,
            status: fields.status,
            amount: fields.amount ?? null,
            dueDate: fields.dueDate ?? null,
            description: fields.description ?? null
          })
        : api.invoicing.createPaymentRequest({
            purchaseInvoiceId,
            purchaseOrderId,
            ...fields
          });
    }
    case "ready":
      return api.invoicing.markPaymentRequestReady({ id: data.id });
    case "planned":
      return api.invoicing.markPaymentRequestPlanned({ id: data.id });
    case "cancel":
      return api.invoicing.cancelPaymentRequest({ id: data.id });
  }
}
