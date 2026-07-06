import type { LabelSize } from "@carbon/utils";
import { getZplLabelGeometry, zplLabelHeader } from "./utils";

export type StorageUnitLabelItem = {
  name: string;
  id: string;
};

export function generateStorageUnitLabelZPL(
  item: StorageUnitLabelItem,
  labelSize: LabelSize
): string {
  const geometry = getZplLabelGeometry(labelSize);
  const { heightDots, scale, margin } = geometry;

  const titleFont = Math.round(40 * scale);
  const textY = Math.round((heightDots - titleFont) / 2);

  let zpl = zplLabelHeader(geometry);

  zpl += `^FO${margin},${textY}^A0N,${titleFont},${titleFont}^FD${item.name}^FS`;

  zpl += "^XZ";

  return zpl;
}
