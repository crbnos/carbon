import { requirePermissions } from "@carbon/auth/auth.server";
import { generateProductLabelZPL } from "@carbon/documents/zpl";
import { labelSizes } from "@carbon/utils";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { getCompanySettings } from "~/services/inventory.service";
import { getTrackedEntitiesByMakeMethodId } from "~/services/operations.service";
import { path } from "~/utils/path";

export const config = { runtime: "nodejs" };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [companySettings, trackedEntities] = await Promise.all([
    getCompanySettings(client, companyId),
    getTrackedEntitiesByMakeMethodId(client, id),
  ]);

  // Get the label size from query params or default to zebra2x1
  const url = new URL(request.url);
  const labelParam = url.searchParams.get("labelSize");
  const trackedEntityIdParam = url.searchParams.get("trackedEntityId");
  const labelSizeId =
    labelParam || companySettings.data?.productLabelSize || "zebra2x1";

  // Find the label size configuration
  let labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  if (!labelSize.zpl) {
    throw redirect(
      path.to.file.operationLabelsPdf(id, {
        labelSize: labelSize.id,
        trackedEntityId: trackedEntityIdParam ?? undefined,
      })
    );
  }

  let filteredTracking = trackedEntities.data;

  // Filter by trackedEntityId if provided
  if (trackedEntityIdParam) {
    filteredTracking =
      filteredTracking?.filter(
        (tracking) => tracking.id === trackedEntityIdParam
      ) ?? [];
  }

  const items = filteredTracking
    ?.map((tracking) => ({
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
      `No items found for operation ${id}${
        trackedEntityIdParam
          ? ` and tracked entity ${trackedEntityIdParam}`
          : ""
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
