// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { getPreferenceHeaders } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.purchasing.confirmReturnOrder({
    purchaseReturnOrderId: id,
    locale: getPreferenceHeaders(args.request).locale
  });
  // A confirmed return whose PDF failed is still flashed as a failure.
  const warning = result.data?.warning;
  return respond(
    args.request,
    warning ? { error: { message: warning } } : result
  ).redirect(path.to.purchaseReturnOrderDetails(id), {
    message: "Return order confirmed"
  });
}
