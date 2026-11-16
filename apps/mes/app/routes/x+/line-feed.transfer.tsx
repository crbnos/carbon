// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { proxyToErp } from "@carbon/auth/erp-proxy.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { userContext } from "~/context";
import { getStationShortage } from "~/services/inventory.service";

const logger = getLogger("mes", "line-feed-transfer");

const transferValidator = z.object({
  workCenterId: z.string().min(1),
  itemId: z.string().min(1),
  fromStorageUnitId: z.string().min(1),
  quantity: zfd.numeric(z.number().positive()),
  // The serial or batch to move, when the line feed knows it (a kit).
  trackedEntityId: zfd.text(z.string().optional())
});

type TransferResult = { success: boolean; message?: string };

/**
 * Bring a part to a station in one tap: a stock transfer from the bin the
 * feeder grabbed it from to the station's bin, moved at once.
 *
 * The station's shortage is read again here, so the form only says what to
 * move and from where: the destination and the most that may move are the
 * server's. A second send after the first has landed finds no shortage and
 * moves nothing. The ERP creates and posts the transfer (its storage rules,
 * tracking and stock checks apply).
 */
export async function action({
  request,
  context
}: ActionFunctionArgs): Promise<TransferResult> {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "inventory"
  });
  const locationId = context.get(userContext)?.locationId;
  if (!locationId) return { success: false, message: "Select a location" };

  const validation = await validator(transferValidator).validate(
    await request.formData()
  );
  if (validation.error) return { success: false, message: "Invalid transfer" };
  const { workCenterId, itemId, fromStorageUnitId, trackedEntityId } =
    validation.data;

  const shortage = await getStationShortage(client, {
    companyId,
    locationId,
    workCenterId,
    itemId
  });
  if (shortage.error) {
    logger.error("Failed to read the station's shortage", {
      companyId,
      workCenterId,
      itemId,
      error: shortage.error
    });
    return { success: false, message: "Failed to read the station's stock" };
  }
  if (!shortage.data) {
    return { success: false, message: "The station is no longer short of it" };
  }
  const quantity = Math.min(validation.data.quantity, shortage.data.short);

  const body = new FormData();
  body.set("locationId", locationId);
  body.set(
    "lines",
    JSON.stringify([
      {
        itemId,
        fromStorageUnitId,
        toStorageUnitId: shortage.data.storageUnitId,
        quantity,
        trackedEntityId
      }
    ])
  );
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  const response = await proxyToErp(
    new Request(request.url, { method: "POST", headers, body }),
    "api/inventory/stock-transfer/move"
  );
  const result = (await response
    .json()
    .catch(() => null)) as TransferResult | null;
  if (!result) {
    logger.error("The ERP did not answer a line feed transfer", {
      companyId,
      itemId,
      status: response.status
    });
    return { success: false, message: "Failed to transfer" };
  }
  return { success: result.success, message: result.message };
}
