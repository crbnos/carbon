import { requirePermissions } from "@carbon/auth/auth.server";
import { ProductLabelPDF } from "@carbon/documents/pdf";
import { labelSizes } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import { type LoaderFunctionArgs } from "@vercel/remix";
import { getReceiptLineTracking } from "~/modules/inventory";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { TrackedEntityAttributes } from "~/modules/shared";

export const config = { runtime: "nodejs" };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [companySettings, receiptLineTracking] = await Promise.all([
    getCompanySettings(client, companyId),
    getReceiptLineTracking(client, id, companyId),
  ]);

  // Get the label size from query params or default to zebra2x1
  const url = new URL(request.url);
  const labelSizeId =
    url.searchParams.get("labelSize") ||
    companySettings.data?.productLabelSize ||
    "avery5160";

  // Find the label size configuration
  const labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size or missing ZPL configuration");
  }

  const items = receiptLineTracking.data?.map((tracking) => ({
    itemId: tracking.sourceDocumentReadableId ?? "",
    revision: "0",
    number:
      (tracking.attributes as TrackedEntityAttributes)?.["Serial Number"] ??
      (tracking.attributes as TrackedEntityAttributes)?.["Batch Number"] ??
      "",
    trackedEntityId: tracking.id,
    quantity: tracking.quantity,
    trackingType: tracking.quantity > 1 ? "Batch" : "Serial",
  })).sort((a, b) => {
    if (a.itemId === b.itemId) {
      return a.number.localeCompare(b.number);
    }
    return a.itemId.localeCompare(b.itemId);
  });

  if (!Array.isArray(items) || items.length === 0) {
    return new Response(`No items found for receipt ${id}`, { status: 404 });
  }

  const stream = await renderToStream(
    <ProductLabelPDF items={items ?? []} labelSize={labelSize} />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  const headers = new Headers({ "Content-Type": "application/pdf" });
  return new Response(body, { status: 200, headers });
}
