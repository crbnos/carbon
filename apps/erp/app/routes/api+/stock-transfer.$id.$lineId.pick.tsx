// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { rejectCrossSiteNavigation } from "@carbon/auth/middleware/security.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function loader({ request, params }: ActionFunctionArgs) {
  // Writes on GET: a link on another site must not trigger it.
  rejectCrossSiteNavigation(request);
  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  if (type && ["serial", "batch"].includes(type)) {
    throw redirect(path.to.stockTransferScan(id, lineId));
  }

  const api = await carbon(request);
  const [lines, stockTransfer] = await Promise.all([
    api.inventory.getStockTransferLines({ stockTransferId: id }),
    api.inventory.getStockTransfer({ stockTransferId: id })
  ]);
  const stockTransferLine = lines.data?.find((line) => line.id === lineId);

  if (!stockTransferLine || stockTransfer.error) {
    throw redirect(
      path.to.stockTransfer(id),
      await flash(
        request,
        error(
          lines.error ?? stockTransfer.error,
          "Failed to load stock transfer line or stock transfer"
        )
      )
    );
  }

  if (!["In Progress", "Released"].includes(stockTransfer.data?.status ?? "")) {
    throw redirect(
      path.to.stockTransfer(id),
      await flash(
        request,
        error(
          "Stock transfer is not in progress or released",
          "Stock transfer is not in progress or released"
        )
      )
    );
  }

  if (Number(stockTransferLine.pickedQuantity ?? 0) > 0) {
    throw redirect(
      path.to.stockTransfer(id),
      await flash(request, error("Line already picked", "Line already picked"))
    );
  }

  const result = await api.inventory.pickStockTransferLine({
    lineId,
    quantity: Number(stockTransferLine.quantity ?? 1),
    locationId: stockTransfer.data?.locationId ?? ""
  });
  return respond(request, result).redirect(path.to.stockTransfer(id), {
    message: "Line picked"
  });
}
