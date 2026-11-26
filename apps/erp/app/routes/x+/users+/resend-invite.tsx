// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { originOf } from "@carbon/api/service-fn.server";
import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { resendInviteValidator } from "~/modules/users/users.models";
import { inviteOrigin } from "~/modules/users/users.service";
import { startBackgroundBulkAction } from "~/utils/table-jobs.server";

export async function action(args: ActionFunctionArgs) {
  // Every matching user of the Employees list: the background job picks the
  // inactive users with an email and no unrevoked invite and queues a resend.
  const allMatching = (await args.request.clone().formData()).get(
    "allMatching"
  );
  const started = await startBackgroundBulkAction(
    args.request,
    "users.invite",
    { allMatching },
    inviteOrigin(originOf(args.request))
  );
  if (started) return started;

  const input = await validator(resendInviteValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  return api.users.resendInvites({ userIds: input.data.users });
}
