// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { generatePickingListValidator } from "~/modules/inventory/inventory.models";
import { path } from "~/utils/path";

// The schedule posts one `jobOperationIds` field per selected operation.
const generateForm = generatePickingListValidator.extend({
  jobOperationIds: zfd.repeatable(
    z.array(z.string().min(1)).min(1, {
      message: "Select at least one operation"
    })
  )
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(generateForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.inventory.generatePickingList(input.data);
  if (result.error) {
    return respond(args.request, result).redirect(path.to.pickingLists);
  }
  throw redirect(path.to.pickingListDetails(result.data!.id));
}
