// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { customerContractAmendmentValidator } from "~/modules/sales/sales.models";
import { path } from "~/utils/path";

const intentForm = z.object({ intent: zfd.text(z.string().optional()) });

/** The preview answers before the reason and type are filled in (the type is
 *  pre-filled FROM the preview), so it validates without them. */
const amendmentPreviewValidator = customerContractAmendmentValidator.omit({
  reason: true,
  contractType: true
});

/** Amends an Active contract: change, add or end lines from an effective
 *  date. `intent=preview` runs the same amendment and rolls it back,
 *  answering the modal's `{ preview, error }`. */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(intentForm).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const formData = input.formData ?? new FormData();
  const api = await carbon(args.request);

  if (input.data.intent === "preview") {
    const amendment = await validator(amendmentPreviewValidator).validate(
      formData
    );
    if (amendment.error) {
      return {
        preview: null,
        error:
          Object.values(amendment.error.fieldErrors)[0] ??
          "The amendment is incomplete"
      };
    }
    const result = await api.sales.previewContractAmendment({
      ...amendment.data,
      customerContractId: id
    });
    return { preview: result.data, error: result.error?.message ?? null };
  }

  const amendment = await validator(
    customerContractAmendmentValidator
  ).validate(formData);
  if (amendment.error) return validationError(amendment.error);
  const result = await api.sales.amendContract({
    ...amendment.data,
    customerContractId: id
  });
  return respond(args.request, result).redirect(path.to.contractDetails(id), {
    message: "Contract amended"
  });
}
