import { LabelSize, ProductLabelItem } from "@carbon/utils";

export function generateProductLabelZPL(
  item: ProductLabelItem,
  labelSize: LabelSize
): string {
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
