// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LabelSize } from "@carbon/utils";
import { zplFieldData } from "./utils";

export type KanbanLabelItem = {
  id: string;
  kanbanId?: string | null;
  itemName: string;
  itemReadableId: string;
  locationName: string;
  storageUnitName?: string | null;
  fromStorageUnitName?: string | null;
  supplierName?: string | null;
  quantity: number;
  replenishmentLevel?: number | null;
  unitOfMeasureCode?: string | null;
  thumbnail?: string | null;
};

export type KanbanLabelAction = "order" | "start" | "complete";

export type KanbanLabelCode = {
  action: KanbanLabelAction;
  caption: string;
  url: string;
};

/** The code's color per action, as on the letter sheet and the PNG route. */
export const KANBAN_LABEL_COLORS: Record<KanbanLabelAction, string> = {
  order: "000000", // black
  start: "059669", // emerald-600
  complete: "2563eb" // blue-600
};

const KANBAN_LABEL_CAPTIONS: Record<KanbanLabelAction, string> = {
  order: "CREATE",
  start: "START",
  complete: "COMPLETE"
};

/**
 * The one scan code a card carries. Create, Start and Complete are separate
 * cards, so a scan can never take the wrong action. A thermal printer prints
 * black only, so the caption tells the three cards apart.
 */
export function kanbanLabelCode(
  item: Pick<KanbanLabelItem, "id">,
  baseUrl: string,
  action: KanbanLabelAction = "order"
): KanbanLabelCode {
  const path = action === "order" ? "" : `${action}/`;
  return {
    action,
    caption: KANBAN_LABEL_CAPTIONS[action],
    url: `${baseUrl}/api/kanban/${path}${item.id}`
  };
}

/** The bins a card refills: `from -> to` for a Transfer kanban, else its bin or location. */
export function kanbanLabelStorageText(item: KanbanLabelItem): string {
  const to = item.storageUnitName || item.locationName;
  // ASCII "->": neither the PDF's built-in Helvetica nor ZPL font 0 has U+2192.
  return item.fromStorageUnitName ? `${item.fromStorageUnitName} -> ${to}` : to;
}

/**
 * `QTY: 100 EA`, and a second line `MIN: 20` when a level is set. The level
 * is in stock units at the To storage unit and the unit is the purchase
 * unit, so MIN prints no unit.
 */
export function kanbanLabelQuantityLines(item: KanbanLabelItem): string[] {
  const quantity = `QTY: ${item.quantity}${
    item.unitOfMeasureCode ? ` ${item.unitOfMeasureCode}` : ""
  }`;
  return item.replenishmentLevel != null
    ? [quantity, `MIN: ${item.replenishmentLevel}`]
    : [quantity];
}

/** The smallest label a card fits on: 3" x 2" (100 x 50 mm passes). */
export function canHoldKanbanLabel(size: Pick<LabelSize, "width" | "height">) {
  return size.width >= 2.9 && size.height >= 1.9;
}

/** Average glyph width as a share of the font height (Helvetica and ZPL font 0). */
const GLYPH_WIDTH = 0.55;

/** Cut `text` to what fits in `width` at a font `fontSize` high (both in inches). */
export function fitKanbanLabelText(
  text: string,
  width: number,
  fontSize: number
): string {
  const max = Math.max(1, Math.floor(width / (fontSize * GLYPH_WIDTH)));
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

/**
 * The part name in at most two lines of `width` inches, broken at a space;
 * the second line is cut when the name is longer still. Every other field
 * is one line (`fitKanbanLabelText`).
 */
export function wrapKanbanLabelText(
  text: string,
  width: number,
  fontSize: number
): string[] {
  const max = Math.max(1, Math.floor(width / (fontSize * GLYPH_WIDTH)));
  const name = text.trim();
  if (name.length <= max) return name ? [name] : [];
  const space = name.lastIndexOf(" ", max);
  const cut = space > 0 ? space : max;
  return [
    name.slice(0, cut).trimEnd(),
    fitKanbanLabelText(name.slice(cut).trimStart(), width, fontSize)
  ];
}

export type KanbanLabelLayout = {
  margin: number;
  titleSize: number;
  textSize: number;
  captionSize: number;
  /** The text column on the left. */
  textWidth: number;
  lineGap: number;
  nameY: number;
  itemY: number;
  storageY: number;
  quantityY: number;
  supplierY: number;
  kanbanIdY: number;
  /** The QR code on the right, with its caption under it. */
  codeSize: number;
  codeX: number;
  codeY: number;
  captionY: number;
};

/**
 * One card on a thermal label, in inches from the top-left corner. The QR
 * code takes the right side, as large as the label allows, with its caption
 * under it. The text runs down the left, each field cut to the column: part
 * name (up to two lines), item ID, bins, quantity (and MIN), supplier, and
 * the kanban ID small at the bottom, one line each. The PDF and the
 * ZPL read the same layout, so both print alike.
 */
export function getKanbanLabelLayout(
  width: number,
  height: number,
  nameLines = 1,
  quantityLines = 1
): KanbanLabelLayout {
  const margin = 0.08;
  const titleSize = 0.17;
  const textSize = 0.13;
  const captionSize = 0.12;
  const lineGap = 0.05;
  const columnGap = 0.12;

  // The code is square: the label's height less the caption, but never more
  // than 45% of its width, so the text keeps a usable column.
  const codeSize = Math.min(
    height - 2 * margin - captionSize - 0.04,
    width * 0.45
  );
  const codeX = width - margin - codeSize;
  // Center the code and caption together on the label's height.
  const codeY = (height - (codeSize + 0.04 + captionSize)) / 2;

  const nameY = margin;
  const itemY = nameY + nameLines * (titleSize + lineGap);
  const storageY = itemY + textSize + lineGap;
  const quantityY = storageY + textSize + lineGap;
  const supplierY = quantityY + quantityLines * (titleSize + lineGap);

  return {
    margin,
    titleSize,
    textSize,
    captionSize,
    textWidth: codeX - columnGap - margin,
    lineGap,
    nameY,
    itemY,
    storageY,
    quantityY,
    supplierY,
    kanbanIdY: height - margin - textSize,
    codeSize,
    codeX,
    codeY,
    captionY: codeY + codeSize + 0.04
  };
}

/** QR byte capacity at error-correction level M, versions 1 to 10. */
const QR_CAPACITY_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

/** Modules across the smallest QR (level M) that holds `data`. */
function qrModules(data: string): number {
  const bytes = new TextEncoder().encode(data).length;
  const version = QR_CAPACITY_M.findIndex((capacity) => capacity >= bytes) + 1;
  return 17 + 4 * (version > 0 ? version : QR_CAPACITY_M.length);
}

/** Generate the ZPL for one kanban card, sized to a thermal label. */
export function generateKanbanLabelZPL(
  item: KanbanLabelItem,
  labelSize: LabelSize,
  baseUrl: string,
  action: KanbanLabelAction = "order"
): string {
  if (!labelSize.zpl) {
    throw new Error("Invalid label size or missing ZPL configuration");
  }
  const { width, height } = labelSize.zpl;
  const dpi = labelSize.zpl.dpi || 203;
  const dots = (inches: number) => Math.round(inches * dpi);

  const code = kanbanLabelCode(item, baseUrl, action);
  const { textWidth: nameWidth, titleSize: nameSize } = getKanbanLabelLayout(
    width,
    height
  );
  const name = wrapKanbanLabelText(item.itemName, nameWidth, nameSize);
  const quantity = kanbanLabelQuantityLines(item);
  const layout = getKanbanLabelLayout(
    width,
    height,
    name.length,
    quantity.length
  );
  const { margin, titleSize, textSize, textWidth } = layout;

  const text = (
    x: number,
    y: number,
    size: number,
    value: string,
    fieldWidth?: number,
    align: "L" | "C" = "L"
  ) =>
    `^FO${dots(x)},${dots(y)}^A0N,${dots(size)},${dots(size)}` +
    (fieldWidth === undefined ? "" : `^FB${dots(fieldWidth)},1,0,${align}`) +
    zplFieldData(value);
  const line = (y: number, size: number, value: string) =>
    text(margin, y, size, fitKanbanLabelText(value, textWidth, size));

  let zpl = `^XA^PW${dots(width)}^LL${dots(height)}^MNW^CI28`;

  name.forEach((nameLine, index) => {
    zpl += line(
      layout.nameY + index * (titleSize + layout.lineGap),
      titleSize,
      nameLine
    );
  });
  zpl += line(layout.itemY, textSize, item.itemReadableId);
  zpl += line(layout.storageY, textSize, kanbanLabelStorageText(item));
  quantity.forEach((quantityLine, index) => {
    zpl += line(
      layout.quantityY + index * (titleSize + layout.lineGap),
      titleSize,
      quantityLine
    );
  });
  if (item.supplierName) {
    zpl += line(layout.supplierY, textSize, item.supplierName);
  }
  if (item.kanbanId) {
    zpl += line(layout.kanbanIdY, textSize, item.kanbanId);
  }

  // A thermal printer prints black only: the caption names the action.
  const slot = dots(layout.codeSize);
  const modules = qrModules(code.url);
  const magnification = Math.max(2, Math.min(10, Math.floor(slot / modules)));
  // Right-align the code in its slot: ZPL sizes it by whole modules.
  const offset = slot - magnification * modules;
  zpl +=
    `^FO${dots(layout.codeX) + offset},${dots(layout.codeY)}` +
    `^BQN,2,${magnification}^FDMA,${code.url}^FS`;
  zpl += text(
    layout.codeX,
    layout.captionY,
    layout.captionSize,
    code.caption,
    layout.codeSize,
    "C"
  );

  zpl += "^XZ";
  return zpl;
}
