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

export const labelSizes: LabelSize[] = [
  {
    id: "avery5163",
    name: "Avery 5163",
    width: 4,
    height: 2
  },
  {
    id: "label2x1",
    name: "Label 2x1",
    width: 2,
    height: 1,
    zpl: {
      dpi: 203,
      width: 2,
      height: 1
    }
  },
  {
    id: "label4x2",
    name: "Label 4x2",
    width: 4,
    height: 2,
    zpl: {
      dpi: 203,
      width: 4,
      height: 2
    }
  },
  {
    id: "label100x50mm",
    name: "Label 100x50mm",
    width: 3.937,
    height: 1.969,
    metric: true,
    zpl: {
      dpi: 203,
      width: 3.937,
      height: 1.969
    }
  },
  {
    id: "label50x25mm",
    name: "Label 50x25mm",
    width: 1.969,
    height: 0.984,
    metric: true,
    zpl: {
      dpi: 203,
      width: 1.969,
      height: 0.984
    }
  }
];
