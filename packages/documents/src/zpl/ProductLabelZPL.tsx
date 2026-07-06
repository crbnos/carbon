import type { LabelSize, ProductLabelItem } from "@carbon/utils";
import type { DocumentTemplate } from "../template";
import { interpolateString, resolveTemplate } from "../template";
import { getZplLabelGeometry, zplLabelHeader } from "./utils";

/** Merge-field values for a label (kept in sync with buildLabelVars). */
function labelVars(item: ProductLabelItem): Record<string, string> {
  const str = (v: unknown): string => (v == null ? "" : String(v));
  return {
    "item.id": str(item.itemId),
    "item.revision": str(item.revision),
    "label.quantity": str(item.quantity),
    "label.trackingType": str(item.trackingType),
    "label.number": str(item.number),
    "label.trackedEntityId": str(item.trackedEntityId)
  };
}

/**
 * Map a barcode symbology to its ZPL command for a given dot height. `scale`
 * sizes the QR module so it stays scannable across label stock sizes.
 */
function zplBarcode(
  symbology: string,
  value: string,
  heightDots: number,
  scale: number
): string {
  switch (symbology) {
    case "code128":
      return `^BCN,${heightDots},N,N,N^FD${value}^FS`;
    case "datamatrix":
      return `^BXN,${Math.max(3, Math.floor(heightDots / 20))},200^FD${value}^FS`;
    case "qrcode": {
      // `MA,` field-data prefix = error-correction level M + Automatic input
      // mode. Module scales with the label rather than a fixed step.
      const module = Math.max(2, Math.min(8, Math.round(4 * scale)));
      return `^BQN,2,${module}^FDMA,${value}^FS`;
    }
    default: // pdf417
      return `^BY2^B7N,${Math.max(2, Math.floor(heightDots / 20))},5,0,0,N^FD${value}^FS`;
  }
}

/**
 * Generate ZPL for a tracked-entity label. Honors the `trackingLabel` template:
 * only visible fields are emitted, and the text fields stack in block order
 * (QR stays top-right, the entity id stays at the bottom — same partitioning as
 * the PDF). Extension/custom blocks are skipped (no ZPL equivalent).
 *
 * Sizing is driven by `getZplLabelGeometry` so margins, fonts and the QR scale
 * continuously with the stock (203dpi, 2"x1" baseline), and the header carries
 * `^MNW` (continuous media) + `^CI28` (UTF-8).
 */
export function generateProductLabelZPL(
  item: ProductLabelItem,
  labelSize: LabelSize,
  template?: DocumentTemplate | null,
  logo?: { gfa?: string | null; widthDots?: number } | null
): string {
  const geometry = getZplLabelGeometry(labelSize);
  const { widthDots, heightDots, hScale, scale, margin } = geometry;

  const titleFont = Math.round(25 * scale);
  const descFont = Math.round(18 * scale);
  const smallFont = Math.round(12 * scale);
  const headingGap = titleFont + Math.round(10 * hScale);
  const descGap = Math.round(25 * scale);

  // Top-right code slot, scaled to the stock. All dot values are rounded —
  // ZPL coordinates and sizes must be integers.
  const qrModuleSize = Math.max(2, Math.min(8, Math.round(4 * scale)));
  const qrPixelSize = qrModuleSize * 29;
  const qrSlotSize = Math.round(Math.min(heightDots * 0.7, widthDots * 0.3));
  const qrStartX = widthDots - qrSlotSize - margin;
  // Reserve for the bottom entity-id line so flowed barcodes clear it.
  const bottomReserve = smallFont + Math.round(18 * hScale);

  const resolved = resolveTemplate("trackingLabel", template ?? null);
  const visibleBlocks = resolved.blocks.filter((block) => block.visible);
  const vars = labelVars(item);

  let zpl = zplLabelHeader(geometry);

  // Text fields stack from the top, following block order.
  let yPosition = Math.round(30 * hScale);
  const textLine = (size: number, text: string) => {
    zpl += `^FO${margin},${yPosition}^A0N,${size},${size}^FD${text}^FS`;
  };

  for (const block of visibleBlocks) {
    switch (block.type) {
      case "labelHeading":
        if (item.itemId) {
          textLine(titleFont, item.itemId);
          yPosition += headingGap;
        }
        break;
      case "labelRevision":
        if (item.revision) {
          textLine(descFont, `${block.label || "Rev"}: ${item.revision}`);
          yPosition += descGap;
        }
        break;
      case "labelQuantity":
        if (["Serial", "Batch"].includes(item.trackingType)) {
          textLine(descFont, `${block.label || "Qty"}: ${item.quantity}`);
          yPosition += descGap;
        }
        break;
      case "labelTracking":
        if (item.number && ["Serial", "Batch"].includes(item.trackingType)) {
          const defaultName = item.trackingType === "Serial" ? "S/N" : "Batch";
          textLine(descFont, `${block.label || defaultName}: ${item.number}`);
          yPosition += descGap;
        }
        break;
      case "labelEntityId": {
        // Human-readable identifier text at the bottom (interpolated value).
        const value = interpolateString(block.value ?? "", vars);
        if (value) {
          const idY = heightDots - smallFont - Math.round(10 * hScale);
          zpl += `^FO${margin},${idY}^A0N,${smallFont},${smallFont}^FD${value}^FS`;
        }
        break;
      }
      case "labelLogo":
        if (logo?.gfa) {
          // Top-right, like the QR slot.
          const logoW = logo.widthDots ?? Math.round(widthDots * 0.3);
          const logoX = widthDots - logoW - margin;
          zpl += `^FO${logoX > 0 ? logoX : margin},${Math.round(20 * hScale)}${logo.gfa}^FS`;
        }
        break;
      case "labelBarcode": {
        const value = interpolateString(block.value ?? "", vars);
        if (value) {
          if (block.placement === "full") {
            // Full-width band that flows below the text, sized to the space
            // left between the text and the bottom entity-id line.
            const gap = Math.round(6 * hScale);
            const bcY = yPosition + gap;
            const avail = heightDots - bottomReserve - bcY;
            const bcHeight = Math.max(
              20,
              Math.min(Math.round(110 * scale), avail)
            );
            zpl += `^FO${margin},${bcY}`;
            zpl += zplBarcode(block.symbology, value, bcHeight, scale);
            yPosition = bcY + bcHeight;
          } else if (block.placement === "center") {
            // Centered square that flows below the text (e.g. QR-only label).
            const gap = Math.round(6 * hScale);
            const bcY = yPosition + gap;
            const avail = heightDots - bottomReserve - bcY;
            const bcSize = Math.max(20, Math.min(qrSlotSize, avail));
            const bcX = Math.max(margin, Math.round((widthDots - bcSize) / 2));
            zpl += `^FO${bcX},${bcY}`;
            zpl += zplBarcode(block.symbology, value, bcSize, scale);
            yPosition = bcY + bcSize;
          } else {
            // Top-right slot. QR positions by its real pixel width.
            const isQr = block.symbology === "qrcode";
            const bcX = isQr ? widthDots - qrPixelSize - margin : qrStartX;
            zpl += `^FO${bcX > 0 ? bcX : margin},${Math.round(30 * hScale)}`;
            zpl += zplBarcode(
              block.symbology,
              value,
              Math.round(110 * scale),
              scale
            );
          }
        }
        break;
      }
      case "field": {
        // A single authored line: "label: value" (or just the value).
        const value = interpolateString(block.value ?? "", vars);
        const text = block.label ? `${block.label}: ${value}` : value;
        if (text) {
          textLine(descFont, text);
          yPosition += descGap;
        }
        break;
      }
      case "customField": {
        const value = item.customFields?.[block.fieldId];
        if (value != null && value !== "") {
          textLine(descFont, `${block.label}: ${value}`);
          yPosition += descGap;
        }
        break;
      }
      // Rich text / key-value lists / spacers / shared sections have no
      // single-line ZPL equivalent — skip.
      default:
        break;
    }
  }

  zpl += "^XZ"; // End format
  return zpl;
}
