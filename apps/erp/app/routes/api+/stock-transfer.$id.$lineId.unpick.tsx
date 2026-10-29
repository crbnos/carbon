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
  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

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

  if (!(Number(stockTransferLine.pickedQuantity ?? 0) > 0)) {
    throw redirect(
      path.to.stockTransfer(id),
      await flash(request, error("Line is not picked", "Line is not picked"))
    );
  }

  const tracked =
    stockTransferLine.requiresSerialTracking ||
    stockTransferLine.requiresBatchTracking;
  const result = await api.inventory.unpickStockTransferLine({
    lineId,
    locationId: stockTransfer.data?.locationId ?? "",
    trackedEntityId: tracked
      ? (stockTransferLine.trackedEntityId ?? undefined)
      : undefined
  });
  return respond(request, result).redirect(path.to.stockTransfer(id), {
    message: "Line unpicked"
  });
}
