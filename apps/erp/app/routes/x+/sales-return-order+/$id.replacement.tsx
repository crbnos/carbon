// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { api } = await authorize(request, { "sales.returns": "Create" });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  // Idempotent: re-invoking returns the existing replacement order's id. The
  // service function checks the sales order permission and links the return
  // to its replacement as the system, for this company only.
  const result = await api.sales.createReplacementSalesOrder({
    salesReturnOrderId: id
  });

  if (result.error || !result.data) {
    return data(
      { success: false },
      await flash(
        request,
        error(result.error, "Failed to create replacement order")
      )
    );
  }

  throw redirect(
    path.to.salesOrder(result.data.id),
    await flash(request, success("Replacement order created"))
  );
}
