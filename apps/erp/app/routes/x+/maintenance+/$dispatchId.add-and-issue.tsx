// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { issueMaintenancePart } from "~/modules/resources/resources.server";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    issueMaintenancePart.input.omit({ dispatchId: true })
  ).request(args, { params: ["dispatchId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.resources.issueMaintenancePart({
    ...input.data,
    dispatchId: input.params.dispatchId
  });
}
