// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { proxyToErp } from "@carbon/auth/erp-proxy.server";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { round } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

const logger = getLogger("mes", "line-feed");

export type StationTransfer = {
  workCenterId: string;
  itemId: string;
  /** The bin the feeder grabbed it from. */
  fromStorageUnitId: string;
  /** The most to move; the station's need caps it. */
  quantity: number;
  /** The serial or batch to move, when the line feed knows it (a kit). */
  trackedEntityId?: string;
};

export type StationTransferResult = { success: boolean; message: string };

const refused = (message: string): StationTransferResult => ({
  success: false,
  message
});

/**
 * Bring a part to a station: a stock transfer from the bin the feeder grabbed
 * it from to the station's bin, moved at once.
 *
 * The caller only says what to move and from where. The destination and the
 * most that may move are read here: the station's shortage less the transfers
 * already on their way to it. A named serial or batch must still be in the
 * source bin. So a second send of the same move finds nothing left to bring,
 * or the unit gone, and creates nothing. The ERP creates and posts the
 * transfer (its storage rules, tracking and stock checks apply), as the
 * caller: `request` carries their session.
 */
export async function transferToStation(
  client: SupabaseClient<Database>,
  request: Request,
  args: StationTransfer & { companyId: string; locationId: string }
): Promise<StationTransferResult> {
  const { companyId, locationId, workCenterId, itemId, fromStorageUnitId } =
    args;

  const [shortage, inbound, unit] = await Promise.all([
    client
      .rpc("get_line_feed_shortages", {
        p_location_id: locationId,
        p_company_id: companyId
      })
      .eq("workCenterId", workCenterId)
      .eq("itemId", itemId)
      .maybeSingle(),
    client
      .from("stockTransferLine")
      .select(
        "outstandingQuantity, stockTransfer!inner(status, locationId), toStorageUnit:storageUnit!stockTransferLine_toStorageUnitId_fkey!inner(workCenterId)"
      )
      .eq("companyId", companyId)
      .eq("itemId", itemId)
      .eq("stockTransfer.locationId", locationId)
      .in("stockTransfer.status", ["Released", "In Progress"])
      .gt("outstandingQuantity", 0)
      .eq("toStorageUnit.workCenterId", workCenterId),
    args.trackedEntityId
      ? client
          .rpc("get_item_quantities_by_tracking_id", {
            item_id: itemId,
            company_id: companyId,
            location_id: locationId
          })
          .eq("trackedEntityId", args.trackedEntityId)
          .eq("storageUnitId", fromStorageUnitId)
          .gt("quantity", 0)
          .limit(1)
      : null
  ]);
  const failure = shortage.error ?? inbound.error ?? unit?.error;
  if (failure) {
    logger.error("Failed to read what a station needs", {
      companyId,
      workCenterId,
      itemId,
      error: failure
    });
    return refused("Failed to read the station's stock");
  }

  const onItsWay = (inbound.data ?? []).reduce(
    (sum, line) => sum + (line.outstandingQuantity ?? 0),
    0
  );
  const need = round((shortage.data?.short ?? 0) - onItsWay);
  if (!shortage.data || need <= 0) {
    return refused(
      onItsWay > 0
        ? "Enough is already on its way to the station"
        : "The station is no longer short of it"
    );
  }
  if (unit && (unit.data ?? []).length === 0) {
    return refused("It is no longer in that bin");
  }

  const body = new FormData();
  body.set("locationId", locationId);
  body.set(
    "lines",
    JSON.stringify([
      {
        itemId,
        fromStorageUnitId,
        toStorageUnitId: shortage.data.storageUnitId,
        quantity: Math.min(args.quantity, need),
        trackedEntityId: args.trackedEntityId
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
  const result = (await response.json().catch(() => null)) as {
    success: boolean;
    message?: string;
  } | null;
  if (!result) {
    logger.error("The ERP did not answer a line feed transfer", {
      companyId,
      itemId,
      status: response.status
    });
    return refused("Failed to transfer");
  }
  return result.success
    ? { success: true, message: "Moved to the station" }
    : refused(result.message ?? "Failed to transfer");
}
