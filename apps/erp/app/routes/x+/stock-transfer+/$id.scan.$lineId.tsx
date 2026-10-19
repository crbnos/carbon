// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  TrackedEntityPicker,
  type TrackedEntitySelection
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { stockTransferLineScanValidator } from "~/modules/inventory/inventory.models";
import { getAvailableTrackedEntities } from "~/modules/inventory/inventory.service";
import type {
  StockTransfer,
  StockTransferLine
} from "~/modules/inventory/types";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { path } from "~/utils/path";

/**
 * Loads the lots available to pick for this line so the picker can offer a
 * Select tab, not just Scan — the same contract the picking-list picker uses.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { lineId } = params;
  if (!lineId) throw new Response("Not found", { status: 404 });

  const line = await client
    .from("stockTransferLine")
    .select(
      "id, itemId, quantity, pickedQuantity, requiresSerialTracking, fromStorageUnitId, stockTransfer(locationId)"
    )
    .eq("id", lineId)
    .single();

  if (line.error || !line.data) {
    throw new Response("Stock transfer line not found", { status: 404 });
  }

  const locationId = (line.data.stockTransfer as { locationId: string } | null)
    ?.locationId;

  const entities =
    locationId && line.data.itemId
      ? await getAvailableTrackedEntities(client, {
          itemId: line.data.itemId,
          companyId,
          locationId,
          // A stock transfer moves stock between bins in the warehouse, so
          // lineside (work-center) bins are not valid sources.
          excludeLineside: true,
          // Only lots in the line's source bin can be picked for it; an
          // empty source is the unassigned bin, not "any bin".
          inStorageUnit: { id: line.data.fromStorageUnitId }
        })
      : { data: [] };

  const settings = await getCompanySettings(client, companyId);
  const shelfLife = (settings.data?.inventoryShelfLife ?? {}) as {
    nearExpiryWarningDays?: number | null;
    expiredEntityPolicy?: "Warn" | "Block" | "BlockWithOverride";
  };

  return {
    entities: entities.data ?? [],
    trackingType: line.data.requiresSerialTracking
      ? ("Serial" as const)
      : ("Batch" as const),
    quantityRequired: Math.max(
      0,
      Number(line.data.quantity ?? 0) - Number(line.data.pickedQuantity ?? 0)
    ),
    nearExpiryWarningDays: shelfLife.nearExpiryWarningDays ?? 0,
    expiredEntityPolicy: shelfLife.expiredEntityPolicy ?? "Warn"
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(stockTransferLineScanValidator).request(args, {
    params: ["lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const { trackedEntityId, quantity, locationId } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.pickStockTransferLineEntity({
    lineId: input.params.lineId,
    trackedEntityId,
    quantity,
    locationId
  });
  // An error is toasted and the picker stays open.
  if (!result.data) return result;
  return respond(args.request, result).redirect(
    path.to.stockTransfer(result.data.stockTransferId),
    { message: "Tracked entity scanned and transferred" }
  );
}

export default function StockTransferScan() {
  const { id, lineId } = useParams();
  if (!id) throw new Error("id not found");
  if (!lineId) throw new Error("lineId not found");

  const {
    entities,
    trackingType,
    quantityRequired,
    nearExpiryWarningDays,
    expiredEntityPolicy
  } = useLoaderData<typeof loader>();

  const routeData = useRouteData<{
    stockTransfer: StockTransfer;
    stockTransferLines: StockTransferLine[];
  }>(path.to.stockTransfer(id));

  const stockTransferLine = routeData?.stockTransferLines.find(
    (line) => line.id === lineId
  );

  if (!stockTransferLine) throw new Error("stock transfer line not found");

  const navigate = useNavigate();
  const { t } = useLingui();
  const onClose = () =>
    navigate(path.to.stockTransfer(stockTransferLine.stockTransferId!));

  const fetcher = useAction<typeof action>();

  const locationId = routeData?.stockTransfer.locationId ?? "";

  // A lot already picked onto another line of this transfer isn't available to
  // pick again — the availability RPC has no way to know that.
  const pickedElsewhere = useMemo(
    () =>
      new Set(
        (routeData?.stockTransferLines ?? [])
          .filter((line) => line.id !== lineId && line.trackedEntityId)
          .map((line) => line.trackedEntityId as string)
      ),
    [routeData?.stockTransferLines, lineId]
  );

  const options = useMemo(
    () => entities.filter((e) => !pickedElsewhere.has(e.trackedEntityId)),
    [entities, pickedElsewhere]
  );

  const onPick = (selection: TrackedEntitySelection) => {
    fetcher.submit(
      {
        id: stockTransferLine.id!,
        stockTransferId: stockTransferLine.stockTransferId!,
        trackedEntityId: selection.trackedEntityId,
        itemId: stockTransferLine.itemId!,
        locationId,
        // Forward the picker's clamped quantity; the source bin is the line's.
        quantity: selection.quantity
      },
      {
        method: "POST",
        encType: "application/json"
      }
    );
  };

  return (
    <TrackedEntityPicker
      trackingType={trackingType}
      entities={options}
      quantityRequired={quantityRequired}
      title={stockTransferLine.itemReadableId ?? undefined}
      description={
        trackingType === "Serial"
          ? t`Scan or choose a serial number`
          : t`Scan or choose a batch number`
      }
      nearExpiryWarningDays={nearExpiryWarningDays}
      expiredEntityPolicy={expiredEntityPolicy}
      onSelect={onPick}
      onClose={onClose}
    />
  );
}
