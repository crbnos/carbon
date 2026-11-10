// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { deactivateUsersValidator } from "~/modules/users/users.models";
import { originOf } from "~/modules/users/users.service";
import { startBackgroundBulkAction } from "~/utils/table-jobs.server";

export async function action(args: ActionFunctionArgs) {
  // Every matching user of the Employees list: the background job picks the
  // active users other than the actor and queues their deactivation.
  const allMatching = (await args.request.clone().formData()).get(
    "allMatching"
  );
  const { ip } = originOf(args.request);
  const started = await startBackgroundBulkAction(
    args.request,
    "users.deactivate",
    { allMatching },
    ip ? { ip } : {}
  );
  if (started) return started;

  const input = await validator(deactivateUsersValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { users, redirectTo } = input.data;
  const api = await carbon(args.request);
  const result = await api.users.deactivateUsers({
    userIds: users,
    ip: originOf(args.request).ip
  });
  return respond(args.request, result).redirect(redirectTo, {
    message: result.data?.message
  });
}
