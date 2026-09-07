/**
 * Onshape indented multi-level BOM → a typed tree.
 *
 * The payload is column-driven: `headers[]` (id, name) and `rows[]` holding
 * `headerIdToValue[headerId]`. Columns are addressed by display name — the
 * same convention the existing import route uses — and object-valued cells
 * unwrap through `displayName`. Nesting is the dotted "Item" index ("1",
 * "1.1", "1.1.2"), not a children array. Rows may also carry `itemSource`
 * (documentId/elementId/partId of the row's origin), which Carbon uses to
 * link child parts when present.
 */

export type OnshapeBomNode = {
  /** Dotted position, e.g. "1.2". The top-level assembly row is "0". */
  index: string;
  level: number;
  partNumber: string | null;
  revision: string | null;
  name: string | null;
  description: string | null;
  quantity: number;
  /** From the "Purchasing Level" column: true when the row says Purchased. */
  purchased: boolean;
  itemSource: {
    documentId?: string;
    elementId?: string;
    partId?: string;
    wvmType?: string;
    wvmId?: string;
  } | null;
  children: OnshapeBomNode[];
};

type BomHeader = { id: string; name: string };
type BomRow = {
  headerIdToValue?: Record<string, unknown>;
  itemSource?: Record<string, unknown>;
};

function cell(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "object") {
    const display = (value as Record<string, unknown>).displayName;
    return typeof display === "string" && display.trim() !== ""
      ? display
      : null;
  }
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function parseBomTree(payload: unknown): {
  /** The assembly's own row (index "0"), when the export included it. */
  root: OnshapeBomNode | null;
  /** Top-level BOM lines, children nested. */
  lines: OnshapeBomNode[];
} {
  const bom = (payload ?? {}) as {
    headers?: BomHeader[];
    rows?: BomRow[];
  };
  const headers = Array.isArray(bom.headers) ? bom.headers : [];
  const rows = Array.isArray(bom.rows) ? bom.rows : [];

  const headerIdByName = new Map(headers.map((h) => [h.name, h.id]));
  const get = (row: BomRow, name: string) => {
    const id = headerIdByName.get(name);
    return id ? cell(row.headerIdToValue?.[id]) : null;
  };

  const nodes: OnshapeBomNode[] = rows.map((row) => {
    const index = get(row, "Item") ?? "";
    const quantityText = get(row, "Quantity");
    const quantity = quantityText ? Number(quantityText) : Number.NaN;
    const source = row.itemSource ?? null;
    return {
      index,
      level: index === "" ? 0 : index.split(".").length,
      partNumber: get(row, "Part number"),
      revision: get(row, "Revision"),
      name: get(row, "Name"),
      description: get(row, "Description"),
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      purchased: get(row, "Purchasing Level") === "Purchased",
      itemSource: source
        ? {
            documentId: cell(source.documentId) ?? undefined,
            elementId: cell(source.elementId) ?? undefined,
            partId: cell(source.partId) ?? undefined,
            wvmType: cell(source.wvmType) ?? undefined,
            wvmId: cell(source.wvmId) ?? undefined
          }
        : null,
      children: []
    };
  });

  const byIndex = new Map<string, OnshapeBomNode>();
  const lines: OnshapeBomNode[] = [];
  let root: OnshapeBomNode | null = null;

  // Sort by depth so parents exist before children regardless of row order.
  for (const node of [...nodes].sort((a, b) => a.level - b.level)) {
    if (node.index === "" || node.index === "0") {
      root = node;
      continue;
    }
    byIndex.set(node.index, node);
    const dot = node.index.lastIndexOf(".");
    if (dot === -1) {
      lines.push(node);
    } else {
      const parent = byIndex.get(node.index.substring(0, dot));
      if (parent) {
        parent.children.push(node);
      } else {
        lines.push(node);
      }
    }
  }

  const sortRec = (list: OnshapeBomNode[]) => {
    list.sort((a, b) =>
      a.index.localeCompare(b.index, undefined, { numeric: true })
    );
    for (const item of list) sortRec(item.children);
  };
  sortRec(lines);

  return { root, lines };
}

/** Depth-first flatten for display. */
export function flattenBomTree(lines: OnshapeBomNode[]): OnshapeBomNode[] {
  const out: OnshapeBomNode[] = [];
  const walk = (list: OnshapeBomNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(lines);
  return out;
}

/**
 * Pull a named property (e.g. "Part number", "Name") out of an Onshape
 * metadata payload: `{ properties: [{ name, value }, ...] }`.
 */
export function metadataProperty(
  payload: unknown,
  name: string
): string | null {
  const properties = (payload as { properties?: unknown })?.properties;
  if (!Array.isArray(properties)) return null;
  for (const property of properties) {
    const p = property as { name?: unknown; value?: unknown };
    if (p.name === name) {
      const value = p.value;
      if (typeof value === "string" && value.trim() !== "") return value;
      return null;
    }
  }
  return null;
}
