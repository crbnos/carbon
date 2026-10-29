// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { pickingListStatusType } from "~/modules/inventory/inventory.models";
import { path } from "~/utils/path";

const statusChange = z.object({
  status: z.enum(pickingListStatusType),
  acknowledged: zfd.checkbox({ trueValue: "true" })
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(statusChange).request(args, {
    params: ["pickingListId"]
  });
  if ("invalid" in input) return input.invalid;
  const { pickingListId } = input.params;

  const api = await carbon(args.request);
  const result = await api.inventory.setPickingListStatus({
    pickingListId,
    ...input.data
  });
  // Lines left unpicked under the 'warn' policy: the header asks first.
  if (result.data && "needsAcknowledgement" in result.data) return result;
  return respond(args.request, result).redirect(
    path.to.pickingList(pickingListId),
    { message: "Updated picking list status" }
  );
}
