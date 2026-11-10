// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { customerContractCancelValidator } from "~/modules/sales/sales.models";
import { path } from "~/utils/path";

const intentForm = z.object({ intent: zfd.text(z.string().optional()) });

/** The preview needs only the end date. */
const cancelPreviewValidator = customerContractCancelValidator.pick({
  endDate: true
});

/** Cancels an Active contract from an end date, optionally crediting the
 *  unused time. `intent=preview` answers the modal's `{ preview, error }`. */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(intentForm).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const formData = input.formData ?? new FormData();
  const api = await carbon(args.request);

  if (input.data.intent === "preview") {
    const cancellation = await validator(cancelPreviewValidator).validate(
      formData
    );
    if (cancellation.error) {
      return {
        preview: null,
        error:
          Object.values(cancellation.error.fieldErrors)[0] ??
          "The cancellation is incomplete"
      };
    }
    const result = await api.sales.previewContractCancellation({
      customerContractId: id,
      endDate: cancellation.data.endDate
    });
    return { preview: result.data, error: result.error?.message ?? null };
  }

  const cancellation = await validator(
    customerContractCancelValidator
  ).validate(formData);
  if (cancellation.error) return validationError(cancellation.error);
  const result = await api.sales.cancelContract({
    ...cancellation.data,
    customerContractId: id
  });
  // The memo is linked from the credit rows of the Invoices section.
  return respond(args.request, result).redirect(path.to.contractDetails(id), {
    message: result.data?.memoReadableId
      ? `Cancelled. Credit memo ${result.data.memoReadableId} drafted`
      : "Contract cancelled"
  });
}
