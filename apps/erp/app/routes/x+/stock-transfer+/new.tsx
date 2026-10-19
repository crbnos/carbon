// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { zfd } from "zod-form-data";
import { stockTransferValidator } from "~/modules/inventory/inventory.models";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Stock Transfers`,
  to: path.to.stockTransfers
};

// The wizard's lines, and `acknowledged` once the user accepts the rule
// violations shown to them.
const createForm = stockTransferValidator.extend({
  acknowledged: zfd.checkbox({ trueValue: "true" })
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(createForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { locationId, lines, acknowledged } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.createStockTransfer({
    locationId,
    lines,
    acknowledged,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // An error is toasted and the wizard stays open.
  if (!result.data) return result;
  // A blocking rule: the violation modal reads these.
  if ("violations" in result.data) return result.data;
  throw redirect(path.to.stockTransfer(result.data.id));
}
