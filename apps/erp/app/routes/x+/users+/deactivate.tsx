// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon, respond } from "~/modules/carbon.server";
import { deactivateUsersValidator } from "~/modules/users";
import { originOf } from "~/modules/users/users.server";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(deactivateUsersValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { users, redirectTo } = input.data;
  const api = await carbon(args.request);
  const result = await api.users.user.deactivate({
    userIds: users,
    ip: originOf(args.request).ip
  });
  return respond(args.request, result).redirect(redirectTo, {
    message: result.data?.message
  });
}
