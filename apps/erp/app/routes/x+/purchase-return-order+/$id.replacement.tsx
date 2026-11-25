// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { api } = await authorize(request, { "purchasing.returns": "Create" });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  // The service function checks the purchase order permission and links the
  // return to its replacement as the system, for this company only.
  const result = await api.purchasing.createReplacementPurchaseOrder({
    purchaseReturnOrderId: id
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.purchaseReturnOrderDetails(id),
      await flash(
        request,
        error(result.error, "Failed to create replacement purchase order")
      )
    );
  }

  throw redirect(
    path.to.purchaseOrder(result.data.id),
    await flash(request, success("Created replacement purchase order"))
  );
}
