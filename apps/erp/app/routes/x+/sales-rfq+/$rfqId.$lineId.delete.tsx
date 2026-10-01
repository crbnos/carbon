// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  deleteSalesRFQLine,
  getSalesRFQ,
  isSalesRfqLocked
} from "~/modules/sales";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { rfqId, lineId } = params;
  if (!rfqId) {
    throw new Error("rfqId not found");
  }
  if (!lineId) {
    throw new Error("lineId not found");
  }

  const { client: viewClient } = await requirePermissions(request, {
    view: "sales"
  });

  const rfq = await getSalesRFQ(viewClient, rfqId);
  await requireUnlocked({
    request,
    isLocked: isSalesRfqLocked(rfq.data?.status),
    redirectTo: path.to.salesRfq(rfqId),
    message: "Cannot modify a locked RFQ. Reopen it first."
  });

  const { client } = await requirePermissions(request, {
    delete: "sales"
  });

  const deleteLine = await deleteSalesRFQLine(client, lineId);
  if (deleteLine.error) {
    throw redirect(
      path.to.quoteLine(rfqId, lineId),
      await flash(
        request,
        error(deleteLine.error, "Failed to update quote line")
      )
    );
  }

  throw redirect(path.to.salesRfq(rfqId));
}
