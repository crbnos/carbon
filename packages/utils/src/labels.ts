// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type ProductLabelItem = {
  itemId: string;
  revision?: string;
  quantity?: number;
  number: string;
  trackedEntityId: string;
  trackingType: string;
  /** Custom-field values for the tracked entity, keyed by field id. */
  customFields?: Record<string, unknown>;
};

export type LabelSize = {
  id: string;
  name: string;
  width: number;
  height: number;
  metric?: boolean;
  /** Multi-up sheet layout (e.g. Avery). Omitted = a single label per page. */
  rows?: number;
  columns?: number;
  rotated?: boolean;
  zpl?: {
    dpi: number;
    width: number;
    height: number;
  };
};

/** Dimensions as `2" x 1"` or `100mm x 50mm` (width x height). */
export function getLabelSizeDimensions(size: LabelSize): string {
  if (size.metric) {
    const widthMm = Math.round(size.width * 25.4);
    const heightMm = Math.round(size.height * 25.4);
    return `${widthMm}mm x ${heightMm}mm`;
  }
  return `${size.width}" x ${size.height}"`;
}

/** Display label as `2" x 1"` for thermal sizes or `Avery 5163 4" x 2"` for sheets. */
export function getLabelSizeLabel(size: LabelSize): string {
  const dimensions = getLabelSizeDimensions(size);
  return size.zpl ? dimensions : `${size.name} ${dimensions}`;
}

/** Print densities a thermal label printer can run at, in dots per inch. */
export const labelDpis = [203, 300, 600] as const;
export type LabelDpi = (typeof labelDpis)[number];
export const DEFAULT_LABEL_DPI: LabelDpi = 203;

/** The size as printed by a printer at `dpi`; no dpi keeps the size's own. */
export function withLabelDpi(size: LabelSize, dpi?: number | null): LabelSize {
  if (!size.zpl || !dpi || size.zpl.dpi === dpi) return size;
  return { ...size, zpl: { ...size.zpl, dpi } };
}

function thermalLabel(
  id: string,
  name: string,
  width: number,
  height: number,
  metric?: boolean
): LabelSize {
  return {
    id,
    name,
    width,
    height,
    ...(metric ? { metric } : {}),
    zpl: { dpi: DEFAULT_LABEL_DPI, width, height }
  };
}

export const labelSizes: LabelSize[] = [
  {
    id: "avery5163",
    name: "Avery 5163",
    width: 4,
    height: 2
  },
  thermalLabel("label1.5x1", "Label 1.5x1", 1.5, 1),
  thermalLabel("label2x1", "Label 2x1", 2, 1),
  thermalLabel("label2x2", "Label 2x2", 2, 2),
  thermalLabel("label2.25x1.25", "Label 2.25x1.25", 2.25, 1.25),
  thermalLabel("label3x2", "Label 3x2", 3, 2),
  thermalLabel("label4x2", "Label 4x2", 4, 2),
  thermalLabel("label4x3", "Label 4x3", 4, 3),
  thermalLabel("label4x6", "Label 4x6", 4, 6),
  thermalLabel("label100x50mm", "Label 100x50mm", 3.937, 1.969, true),
  thermalLabel("label50x25mm", "Label 50x25mm", 1.969, 0.984, true)
];
