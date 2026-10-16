// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { pickingListValidator } from "~/modules/inventory/inventory.models";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(pickingListValidator).request(args, {
    params: ["pickingListId"]
  });
  if ("invalid" in input) return input.invalid;
  const { pickingListId } = input.params;
  const { id: _id, pickingListId: _readableId, ...fields } = input.data;

  const api = await carbon(args.request);
  const result = await api.inventory.updatePickingList({
    pickingListId,
    ...fields,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
  return respond(args.request, result).redirect(
    path.to.pickingList(pickingListId),
    { message: "Updated picking list" }
  );
}
