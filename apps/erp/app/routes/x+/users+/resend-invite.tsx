// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { resendInviteValidator } from "~/modules/users/users.models";
import { originOf } from "~/modules/users/users.service";
import { startAllMatchingBulkAction } from "~/utils/table-jobs.server";

export async function action(args: ActionFunctionArgs) {
  const { ip, city } = originOf(args.request);

  // Every matching user of the Employees list: the background job picks the
  // inactive users with an email and no unrevoked invite and queues a resend.
  const allMatching = (await args.request.clone().formData()).get(
    "allMatching"
  );
  if (allMatching) {
    const { companyId, userId } = await requirePermissions(args.request, {
      create: "users"
    });
    const started = await startAllMatchingBulkAction(allMatching, {
      companyId,
      userId,
      actionKey: "users.invite",
      params: { location: city ?? "Unknown", ip: ip ?? "127.0.0.1" }
    });
    if (started) return started;
  }

  const input = await validator(resendInviteValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.users.resendInvites({ userIds: input.data.users, ip, city });
}
