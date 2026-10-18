// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { syncAssemblyToBopValidator } from "~/modules/production/production.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(syncAssemblyToBopValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  return api.production.syncAssemblyToOperation({
    id: input.params.id,
    operationId: input.data.operationId
  });
}
