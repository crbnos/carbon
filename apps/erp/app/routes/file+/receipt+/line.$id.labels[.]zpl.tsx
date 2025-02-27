import { requirePermissions } from "@carbon/auth/auth.server";
import { LabelSize, labelSizes } from "@carbon/utils";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { getReceiptLineTracking } from "~/modules/inventory/inventory.service";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { TrackedEntityAttributes } from "~/modules/shared/types";
import { path } from "~/utils/path";

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

  // Get the label size from query params or default to avery5160
  const url = new URL(request.url);
  const labelParam = url.searchParams.get("labelSize");
  const labelSizeId =
    labelParam || companySettings.data?.productLabelSize || "avery5160";

  // Find the label size configuration
  let labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  if (labelSize.zpl) {
    throw redirect(
      path.to.file.receiptLineLabelsZpl(id, labelParam ?? undefined)
    );
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
  }));

  if (!Array.isArray(items) || items.length === 0) {
    return new Response(`No items found for receipt ${id}`, { status: 404 });
  }

  if (!labelSize?.zpl) {
    throw new Error("Invalid label size or missing ZPL configuration");
  }

  // Generate ZPL for each item
  const zplCommands = items.map((item) => generateZPLLabel(item, labelSize));
  const zplOutput = zplCommands.join("\n");

  const headers = new Headers({
    "Content-Type": "application/zpl",
    "Content-Disposition": `attachment; filename="labels-${id}.zpl"`,
  });

  return new Response(zplOutput, { status: 200, headers });
}

interface Item {
  itemId: string;
  revision?: string;
  quantity?: number;
  number: string;
  trackedEntityId: string;
  trackingType: string;
}
function generateZPLLabel(item: Item, labelSize: LabelSize): string {
  if (!labelSize.zpl) {
    throw new Error("Invalid label size or missing ZPL configuration");
  }
  const { width, height } = labelSize.zpl;
  const dpi = labelSize.zpl.dpi || 203;

  // Convert inches to dots based on DPI
  const widthDots = Math.round(width * dpi);
  const heightDots = Math.round(height * dpi);

  // Determine if this is a small or large label
  const isSmallLabel = width <= 2.5; // Consider 2x1 as small

  // Calculate positions based on label size
  const textStartX = 20;
  let fontSize = isSmallLabel ? 25 : 35; // Smaller font for small labels
  let descFontSize = isSmallLabel ? 18 : 25;
  let smallFontSize = isSmallLabel ? 12 : 18;

  // QR code positioning and sizing
  const qrSize = isSmallLabel
    ? Math.min(heightDots * 0.6, widthDots * 0.35) // Smaller QR for small labels
    : Math.min(heightDots * 0.7, widthDots * 0.25); // Larger QR with more space on bigger labels

  const qrStartX = isSmallLabel
    ? widthDots - qrSize - 15 // Tighter spacing on small labels
    : widthDots - qrSize - 40; // More spacing on larger labels

  // Start ZPL command sequence
  let zpl = "^XA"; // Start format

  // Set label dimensions
  zpl += `^PW${widthDots}`;
  zpl += `^LL${heightDots}`;

  // Item ID (larger font)
  zpl += `^FO${textStartX},30^A0N,${fontSize},${fontSize}^FD${item.itemId}^FS`;

  // Revision if available
  let yPosition = isSmallLabel ? 65 : 80;
  if (item.revision) {
    zpl += `^FO${textStartX},${yPosition}^A0N,${descFontSize},${descFontSize}^FDRev: ${item.revision}^FS`;
    yPosition += isSmallLabel ? 25 : 35;
  }

  // Quantity
  if (["Serial", "Batch"].includes(item.trackingType)) {
    zpl += `^FO${textStartX},${yPosition}^A0N,${descFontSize},${descFontSize}^FDQty: ${item.quantity}^FS`;
    yPosition += isSmallLabel ? 25 : 35;
  }

  // Serial or Batch number
  if (item.trackingType === "Serial") {
    zpl += `^FO${textStartX},${yPosition}^A0N,${descFontSize},${descFontSize}^FDS/N: ${item.number}^FS`;
  } else if (item.trackingType === "Batch") {
    zpl += `^FO${textStartX},${yPosition}^A0N,${descFontSize},${descFontSize}^FDBatch: ${item.number}^FS`;
  }

  // QR Code for tracked entity ID
  // Using proper error correction level (M) and input mode (A)
  const qrYPosition = isSmallLabel ? 30 : 40;
  zpl += `^FO${qrStartX},${qrYPosition}^BQN,2,${isSmallLabel ? 5 : 7},M,A^FD${
    item.trackedEntityId
  }^FS`;

  // Tracked entity ID at bottom
  const idYPosition = isSmallLabel ? heightDots - 25 : heightDots - 35;
  zpl += `^FO${textStartX},${idYPosition}^A0N,${smallFontSize},${smallFontSize}^FD${item.trackedEntityId}^FS`;

  // End ZPL command sequence
  zpl += "^XZ"; // End format

  return zpl;
}
