// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getPreferenceHeaders, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { quoteFinalizeValidator } from "~/modules/sales/sales.models";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(quoteFinalizeValidator).request(args, {
    params: ["quoteId"]
  });
  if ("invalid" in input) return input.invalid;
  const { quoteId } = input.params;
  const api = await carbon(args.request);
  const result = await api.sales.finalizeAndSendQuote({
    ...input.data,
    quoteId,
    acknowledged: input.formData?.get("acknowledged") === "true",
    locale: getPreferenceHeaders(args.request).locale
  });
  // An error is toasted; the violation modal reads `violations`.
  if (!result.data) return result;
  if ("violations" in result.data) return result.data;
  // A failed email does not undo the finalize.
  throw redirect(
    path.to.quote(quoteId),
    await flash(
      args.request,
      result.data.warning
        ? error(null, result.data.warning)
        : success("Quote finalized successfully")
    )
  );
}
