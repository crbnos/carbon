// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { purchasingRfqStatusType } from "~/modules/purchasing/purchasing.models";
import { updatePurchasingRFQStatus } from "~/modules/purchasing/purchasing.service";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await authorize(request, {
    update: "purchasing"
  });

  const { rfqId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof purchasingRfqStatusType)[number];

  if (!status || !purchasingRfqStatusType.includes(status)) {
    throw redirect(
      path.to.purchasingRfqDetails(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const update = await updatePurchasingRFQStatus(client, {
    id,
    status,
    assignee: status === "Closed" ? null : undefined,
    updatedBy: userId
  });

  if (update.error) {
    throw redirect(
      path.to.purchasingRfqDetails(id),
      await flash(request, error(update.error, "Failed to update RFQ status"))
    );
  }

  throw redirect(
    path.to.purchasingRfqDetails(id),
    await flash(request, success("Updated RFQ status"))
  );
}
