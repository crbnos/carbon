import type { Result } from "@carbon/auth";
import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { TrackedEntityPicker, toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { useRouteData } from "~/hooks";
import type { StockTransfer, StockTransferLine } from "~/modules/inventory";
import {
  getAvailableTrackedEntities,
  getStockTransfer,
  stockTransferLineScanValidator
} from "~/modules/inventory";
import { getItemStorageUnitQuantities } from "~/modules/items";
import { getCompanySettings } from "~/modules/settings";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "id-scan-lineid");

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
      "id, itemId, quantity, pickedQuantity, requiresSerialTracking, stockTransfer(locationId)"
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
          excludeLineside: true
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

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("id is not found");

  const { client: viewClient } = await requirePermissions(request, {
    view: "inventory"
  });
  const transfer = await getStockTransfer(viewClient, id);
  await requireUnlocked({
    request,
    isLocked: transfer.data?.status === "Completed",
    redirectTo: path.to.stockTransfer(id),
    message: "Cannot pick from a completed stock transfer."
  });

  const payload = await request.json();
  const validated = stockTransferLineScanValidator.safeParse(payload);
  if (!validated.success) {
    return data(
      { success: false, message: "Invalid form data" },
      await flash(request, error(validated.error.message, "Invalid form data"))
    );
  }

  const {
    id: lineId,
    stockTransferId,
    itemId,
    locationId,
    trackedEntityId
  } = validated.data;

  const [stockTransferLine, itemStorageUnitQuantities] = await Promise.all([
    client.from("stockTransferLines").select("*").eq("id", lineId!).single(),
    getItemStorageUnitQuantities(client, itemId, companyId, locationId)
  ]);

  if (stockTransferLine.error || itemStorageUnitQuantities.error) {
    return data(
      {
        success: false,
        message:
          "Failed to load stock transfer line or item storage unit quantities"
      },
      await flash(
        request,
        error(
          stockTransferLine.error || itemStorageUnitQuantities.error,
          "Failed to load stock transfer line or item storage unit quantities"
        )
      )
    );
  }

  const currentStorageUnitId =
    itemStorageUnitQuantities.data
      ?.sort((a, b) => b.quantity - a.quantity)
      .find((q) => q.trackedEntityId === trackedEntityId)?.storageUnitId ??
    null;

  // Determine the type of transfer based on tracking requirements
  const transferType = stockTransferLine.data?.requiresBatchTracking
    ? "batch"
    : "serial";

  // Prepare the payload for the post-stock-transfer function
  const functionPayload: any = {
    type: transferType,
    stockTransferId,
    stockTransferLineId: lineId,
    trackedEntityId,
    quantity:
      transferType === "batch" ? (stockTransferLine.data?.quantity ?? 1) : 1,
    fromStorageUnitId: currentStorageUnitId,
    locationId: locationId,
    userId,
    companyId
  };

  const { data: transferResult, error: functionError } =
    await client.functions.invoke("post-stock-transfer", {
      body: JSON.stringify(functionPayload)
    });

  if (functionError) {
    return data(
      { success: false, message: "Failed to pick line" },
      await flash(
        request,
        error(
          functionError.message || "Failed to pick line",
          "Failed to pick line"
        )
      )
    );
  }

  if (transferResult?.splitEntityId) {
    try {
      await trigger("print-job", {
        sourceDocument: "Split",
        sourceDocumentId: transferResult.splitEntityId,
        companyId,
        userId,
        locationId: locationId || undefined
      });
      // Reprint the original batch too — its quantity changed in the split
      if (trackedEntityId) {
        await trigger("print-job", {
          sourceDocument: "Entity",
          sourceDocumentId: trackedEntityId,
          companyId,
          userId,
          locationId: locationId || undefined
        });
      }
    } catch (e) {
      logger.error("Auto-print for split entity failed", { error: e });
    }
  }

  throw redirect(
    path.to.stockTransfer(stockTransferId),
    await flash(request, success("Tracked entity scanned and transferred"))
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

  const fetcher = useFetcher<Result>();

  useEffect(() => {
    if (fetcher.data?.success === false) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

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

  const onPick = (trackedEntityId: string) => {
    fetcher.submit(
      {
        id: stockTransferLine.id!,
        stockTransferId: stockTransferLine.stockTransferId!,
        trackedEntityId,
        itemId: stockTransferLine.itemId!,
        locationId
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
      onSelect={(selection) => onPick(selection.trackedEntityId)}
      onClose={onClose}
    />
  );
}
