// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { getPreferenceHeaders, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { path } from "~/utils/path";

// The post modal's form: `acknowledged` is set when the user accepts the
// rule violations shown to them, `postingDate` dates a rental delivery.
const postForm = z.object({
  acknowledged: zfd.checkbox({ trueValue: "true" }),
  postingDate: zfd.text(z.string().optional())
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(postForm).request(args, {
    params: ["shipmentId"]
  });
  if ("invalid" in input) return input.invalid;
  const { shipmentId } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.postShipment({
    shipmentId,
    ...input.data,
    locale: getPreferenceHeaders(args.request).locale
  });
  // An error, toasted by the modal.
  if (!result.data) return result;
  // A blocking rule: the violation modal reads these.
  if ("violations" in result.data) return result.data;
  const to = path.to.shipmentDetails(shipmentId);
  // Posted with expired batches, as the company's policy allows.
  if (result.data.warning) {
    return respond(args.request, result).redirect(to, {
      message: result.data.warning
    });
  }
  throw redirect(to);
}
