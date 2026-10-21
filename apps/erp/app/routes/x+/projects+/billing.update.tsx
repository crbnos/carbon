// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { billableItemActionValidator } from "~/modules/projects/projects.models";
import { updateProjectBillableItems } from "~/modules/projects/projects.service";

const logger = getLogger("erp", "projects-billing-update");

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

/** Hold, release, write off or reprice contract billable items. Each change
 *  reaches the audit log ("Billable Item"). */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  // Billing review is contract billing: it also needs the sales permission.
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects",
    view: "sales"
  });

  const validation = await validator(billableItemActionValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return failure(
      Object.values(validation.error.fieldErrors)[0] ??
        "Check the review's values"
    );
  }

  const update = await updateProjectBillableItems(client, {
    ...validation.data,
    companyId,
    userId
  });
  if (update.error) {
    logger.error("Failed to review billable items", {
      companyId,
      action: validation.data.action,
      error: update.error
    });
    return failure(update.error.message || "Failed to update the items");
  }

  const messages = {
    hold: "Items held",
    release: "Items released",
    writeOff: "Items written off",
    price: "Price updated"
  } as const;
  return data(
    { success: true, error: null },
    await flash(request, success(messages[validation.data.action]))
  );
}
