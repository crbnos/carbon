// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { deactivateUser } from "@carbon/auth/users.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getClientIp, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { deactivateUsersValidator } from "~/modules/users";
import { queueUserDeactivations } from "~/modules/users/users.server";
import { startAllMatchingBulkAction } from "~/utils/table-jobs.server";

const logger = getLogger("erp", "users-deactivate");

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "users"
  });

  const formData = await request.formData();
  const ip = getClientIp(request) ?? undefined;

  // Every matching user of the Employees list: the background job picks the
  // active users other than the actor and queues their deactivation.
  const started = await startAllMatchingBulkAction(
    formData.get("allMatching"),
    {
      companyId,
      userId,
      actionKey: "users.deactivate",
      params: ip ? { ip } : {}
    }
  );
  if (started) return started;

  const validation = await validator(deactivateUsersValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { users, redirectTo } = validation.data;

  if (users.includes(userId)) {
    throw redirect(
      redirectTo,
      await flash(request, error(null, "You cannot deactivate yourself"))
    );
  }

  if (users.length === 1) {
    const [targetUserId] = users;
    // deactivateUser() handles Stripe subscription quantity update internally
    const result = await deactivateUser(
      client,
      targetUserId,
      companyId,
      userId,
      ip
    );

    throw redirect(redirectTo, await flash(request, result));
  }

  // The success redirect stays outside the try: a thrown redirect is caught
  // like an error, and every deactivation then reported a failure.
  try {
    await queueUserDeactivations({
      userIds: users,
      companyId,
      actorId: userId,
      ip
    });
  } catch (e) {
    logger.error("Failed to queue user deactivations", {
      companyId,
      error: e
    });
    throw redirect(
      redirectTo,
      await flash(request, error(e, "Failed to deactivate users"))
    );
  }
  throw redirect(
    redirectTo,
    await flash(
      request,
      success("Success. Please check back in a few moments.")
    )
  );
}
