// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { quoteLineValidator } from "~/modules/sales/sales.models";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(quoteLineValidator).request(args, {
    params: ["quoteId"]
  });
  if ("invalid" in input) return input.invalid;
  const { quoteId } = input.params;
  const formData = input.formData ?? new FormData();
  const api = await carbon(args.request);
  const result = await api.sales.createQuoteLine({
    ...input.data,
    // The URL quote, not the form's copy.
    quoteId,
    customFields: setCustomFields(formData),
    acknowledged: formData.get("acknowledged") === "true"
  });
  // An error is toasted; the violation modal reads `violations`.
  if (!result.data) return result;
  if ("violations" in result.data) return result.data;
  const { quoteLineId, warning } = result.data;
  // The line exists: open it, saying what could not be priced.
  throw redirect(
    path.to.quoteLine(quoteId, quoteLineId),
    warning ? await flash(args.request, error(null, warning)) : undefined
  );
}
