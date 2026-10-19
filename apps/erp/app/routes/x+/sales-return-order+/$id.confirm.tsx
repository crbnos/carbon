// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getPreferenceHeaders } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.sales.confirmReturnOrder({
    salesReturnOrderId: input.params.id,
    locale: getPreferenceHeaders(args.request).locale
  });
  // The shared confirm dialog shows the flash.
  const problem = result.error?.message ?? result.data?.warning;
  return data(
    result,
    await flash(
      args.request,
      problem ? error(null, problem) : success("Return order confirmed")
    )
  );
}
