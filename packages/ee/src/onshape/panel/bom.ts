// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Onshape indented BOM → typed tree. Columns are addressed by display name;
 * nesting comes from the dotted "Item" index ("1.1.2"). Non-empty cells are
 * kept as properties keyed by column id, so a row resolves through the
 * company's property map like a part.
 */

import { isNotApplicable, type OnshapePropertyValue } from "./properties";

export type OnshapeBomNode = {
  /** Dotted position, e.g. "1.2". */
  index: string;
  level: number;
  partNumber: string | null;
  revision: string | null;
  name: string | null;
  description: string | null;
  quantity: number;
  /** "Show Assembly only": one line, no components. Not a make/buy signal. */
  shownAsUnit?: true;
  standardContent?: true;
  /** Non-empty cells, one per column. Dropped before a plan is stored. */
  properties?: OnshapePropertyValue[];
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

type BomHeader = { id: string; name: string; valueType?: unknown };
type BomRow = {
  headerIdToValue?: Record<string, unknown>;
  itemSource?: Record<string, unknown>;
  isStandardContent?: unknown;
};

/** "Subassembly BOM behavior" label; the API returns it as text. */
const SHOWN_AS_UNIT = "show assembly only";

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
 * Without "Item" every row reads as the root and a push would apply an empty
 * BOM. "Part number" is the join key to Carbon. Without "Quantity" every line
 * would push as 1.
 */
export const BOM_REQUIRED_COLUMNS = [
  "Item",
  "Part number",
  "Quantity"
] as const;

export function parseBomTree(payload: unknown): {
  /** The assembly's own row (index "0"), when the export included it. */
  root: OnshapeBomNode | null;
  lines: OnshapeBomNode[];
  /** Non-empty: callers refuse to plan from `lines`. */
  missingColumns: string[];
} {
  const bom = (payload ?? {}) as {
    headers?: BomHeader[];
    rows?: BomRow[];
  };
  const headers = Array.isArray(bom.headers) ? bom.headers : [];
  const rows = Array.isArray(bom.rows) ? bom.rows : [];

  const headerIdByName = new Map(headers.map((h) => [h.name, h.id]));
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
    const shownAsUnit =
      get(row, "Subassembly BOM behavior")?.toLowerCase() === SHOWN_AS_UNIT;
    const standardContent =
      row.isStandardContent === true || source?.isStandardContent === true;
    const properties: OnshapePropertyValue[] = [];
    for (const header of headers) {
      const value = row.headerIdToValue?.[header.id];
      if (cell(value) === null || isNotApplicable(value)) continue;
      properties.push({
        propertyId: header.id,
        name: header.name,
        valueType:
          typeof header.valueType === "string" ? header.valueType : "STRING",
        value
      });
    }
    return {
      index,
      level: index === "" ? 0 : index.split(".").length,
      partNumber: get(row, "Part number"),
      revision: get(row, "Revision"),
      name: get(row, "Name"),
      description: get(row, "Description"),
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      ...(shownAsUnit ? { shownAsUnit: true as const } : {}),
      ...(standardContent ? { standardContent: true as const } : {}),
      ...(properties.length > 0 ? { properties } : {}),
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

export type AssemblyPartSource = {
  documentId: string;
  /** "v" for a part linked from a version; null for one in this document. */
  wvm: "v" | null;
  wvmId: string | null;
  elementId: string;
  partId: string;
};

/**
 * First non-Standard-content part of an assembly definition: its metadata
 * lists the part-scoped properties an assembly's metadata lacks.
 */
export function firstOwnAssemblyPart(
  definition: unknown
): AssemblyPartSource | null {
  const parts =
    definition && typeof definition === "object"
      ? (definition as { parts?: unknown }).parts
      : null;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const entry = part as Record<string, unknown>;
    if (entry.isStandardContent === true) continue;
    const { documentId, elementId, partId, documentVersion } = entry;
    if (
      typeof documentId !== "string" ||
      typeof elementId !== "string" ||
      typeof partId !== "string" ||
      documentId === "" ||
      elementId === "" ||
      partId === ""
    ) {
      continue;
    }
    const version =
      typeof documentVersion === "string" && documentVersion !== ""
        ? documentVersion
        : null;
    return {
      documentId,
      wvm: version ? "v" : null,
      wvmId: version,
      elementId,
      partId
    };
  }
  return null;
}

export function withoutProperties(nodes: OnshapeBomNode[]): OnshapeBomNode[] {
  return nodes.map(({ properties: _properties, children, ...node }) => ({
    ...node,
    children: withoutProperties(children)
  }));
}

export function missingBomColumnsMessage(missingColumns: string[]): string {
  const names = new Intl.ListFormat("en", {
    style: "long",
    type: "conjunction"
  }).format(missingColumns.map((name) => `"${name}"`));
  const plural = missingColumns.length > 1;
  return `Onshape's BOM for this assembly has no ${names} column${
    plural ? "s" : ""
  }. Add ${plural ? "them" : "it"} back to the assembly's BOM table in Onshape, then try again.`;
}

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

/** Non-empty string value of a named property in Onshape metadata. */
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
