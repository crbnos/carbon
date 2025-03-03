import { requirePermissions } from "@carbon/auth/auth.server";
import { generateProductLabelZPL } from "@carbon/documents/zpl";
import { labelSizes } from "@carbon/utils";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { getShipmentTracking } from "~/modules/inventory/inventory.service";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { path } from "~/utils/path";

export const config = { runtime: "nodejs" };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [companySettings, shipmentTracking] = await Promise.all([
    getCompanySettings(client, companyId),
    getShipmentTracking(client, id, companyId),
  ]);

  // Get the label size from query params or default to zebra2x1
  const url = new URL(request.url);
  const labelParam = url.searchParams.get("labelSize");
  const lineIdParam = url.searchParams.get("lineId");
  const labelSizeId =
    labelParam || companySettings.data?.productLabelSize || "zebra2x1";

  // Find the label size configuration
  let labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  if (!labelSize.zpl) {
    throw redirect(
      path.to.file.shipmentLabelsPdf(id, {
        labelSize: labelSize.id,
        lineId: lineIdParam ?? undefined,
      })
    );
  }

  let filteredTracking = shipmentTracking.data;

  // Filter by lineId if provided
  if (lineIdParam) {
    filteredTracking =
      filteredTracking?.filter(
        (tracking) =>
          tracking.attributes &&
          (tracking.attributes as TrackedEntityAttributes)["Shipment Line"] ===
            lineIdParam
      ) ?? [];
  }

  const itemEntityIds = filteredTracking
    ?.filter(
      (tracking) =>
        "Split Entity ID" in (tracking.attributes as TrackedEntityAttributes)
    )
    ?.map(
      (tracking) =>
        (tracking.attributes as TrackedEntityAttributes)["Split Entity ID"] ??
        ""
    )
    .sort((a, b) => a.localeCompare(b))
    .filter(Boolean);

  if (!itemEntityIds || itemEntityIds.length === 0) {
    return new Response(
      `No items found for shipment ${id}${
        lineIdParam ? ` and line ${lineIdParam}` : ""
      }`,
      { status: 404 }
    );
  }

  const trackedEntities = await client
    .from("trackedEntity")
    .select("*")
    .in("id", itemEntityIds)
    .eq("companyId", companyId);

  if (!trackedEntities.data || trackedEntities.data.length === 0) {
    return new Response(
      `No items found for shipment ${id}${
        lineIdParam ? ` and line ${lineIdParam}` : ""
      }`,
      { status: 404 }
    );
  }

  const items = trackedEntities.data
    .map((tracking) => ({
      itemId: tracking.sourceDocumentReadableId ?? "",
      revision: "0",
      number:
        (tracking.attributes as TrackedEntityAttributes)?.["Serial Number"] ??
        (tracking.attributes as TrackedEntityAttributes)?.["Batch Number"] ??
        "",
      trackedEntityId: tracking.id,
      quantity: tracking.quantity,
      trackingType: tracking.quantity > 1 ? "Batch" : "Serial",
    }))
    .sort((a, b) => {
      if (a.itemId === b.itemId) {
        return a.number.localeCompare(b.number);
      }
      return a.itemId.localeCompare(b.itemId);
    });

  if (!Array.isArray(items) || items.length === 0) {
    return new Response(
      `No items found for shipment ${id}${
        lineIdParam ? ` and line ${lineIdParam}` : ""
      }`,
      { status: 404 }
    );
  }

  if (!labelSize?.zpl) {
    throw new Error("Invalid label size or missing ZPL configuration");
  }

  // Generate ZPL for each item
  const zplCommands = items.map((item) =>
    generateProductLabelZPL(item, labelSize)
  );
  const zplOutput = zplCommands.join("\n");

  const headers = new Headers({
    "Content-Type": "application/zpl",
    "Content-Disposition": `attachment; filename="labels-${id}.zpl"`,
  });

  return new Response(zplOutput, { status: 200, headers });
}
