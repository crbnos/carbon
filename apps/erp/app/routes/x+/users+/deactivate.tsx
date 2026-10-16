// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { deactivateUsersValidator } from "~/modules/users/users.models";
import { originOf } from "~/modules/users/users.service";

export async function action(args: ActionFunctionArgs) {
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
