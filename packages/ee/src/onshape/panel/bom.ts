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
    /** Onshape's configuration string; "default" for the default one. */
    configuration?: string;
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

/**
 * The columns a BOM cannot be read without. "Item" carries the nesting — with
 * it gone every row reads as the root and the tree comes back empty, which a
 * push would apply as "the assembly has no lines". "Part number" is what every
 * row joins to Carbon by.
 */
export const BOM_REQUIRED_COLUMNS = ["Item", "Part number"] as const;

export function parseBomTree(payload: unknown): {
  /** The assembly's own row (index "0"), when the export included it. */
  root: OnshapeBomNode | null;
  /** Top-level BOM lines, children nested. */
  lines: OnshapeBomNode[];
  /**
   * Required columns the payload's headers lack, when it has rows. Non-empty
   * means `lines` cannot be trusted: callers refuse rather than plan from it.
   */
  missingColumns: string[];
} {
  const bom = (payload ?? {}) as {
    headers?: BomHeader[];
    rows?: BomRow[];
  };
  const headers = Array.isArray(bom.headers) ? bom.headers : [];
  const rows = Array.isArray(bom.rows) ? bom.rows : [];

  const headerIdByName = new Map(headers.map((h) => [h.name, h.id]));
  // An empty BOM has nothing to misread, whatever its headers say.
  const missingColumns =
    rows.length === 0
      ? []
      : BOM_REQUIRED_COLUMNS.filter((name) => !headerIdByName.has(name));
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
            wvmId: cell(source.wvmId) ?? undefined,
            configuration: cell(source.configuration) ?? undefined
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

  return { root, lines, missingColumns };
}

/** The refusal for a BOM that lacks required columns, naming them. */
export function missingBomColumnsMessage(missingColumns: string[]): string {
  const names = missingColumns.map((name) => `"${name}"`).join(" and ");
  return `Onshape's BOM for this assembly has no ${names} column. Add ${
    missingColumns.length > 1 ? "them" : "it"
  } back to the assembly's BOM table in Onshape, then try again.`;
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
