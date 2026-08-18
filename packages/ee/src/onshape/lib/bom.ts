// Parsing an Onshape BOM response into rows Carbon can act on.
//
// The v1 loader rebuilt each row from `headerIdToValue` keyed by the header's
// DISPLAY NAME and threw everything else away. Two consequences: a renamed or
// localized column silently read as "", and the per-row `itemSource` — the only
// thing that says WHICH CAD part a row refers to — never reached the writer, so
// the import could not do anything but match on part-number strings.
//
// Verified against a live response (RD-410 assembly, 8 rows, 26 headers):
//
//   * every row carries `itemSource` with documentId / elementId / partId /
//     configuration / wvmId / wvmType;
//   * `indentLevel` is a real integer, so the tree does NOT have to be rebuilt
//     by splitting the "Item" string on ".";
//   * `topLevelAssemblyRow` is its OWN top-level key, NOT a member of `rows` —
//     so the assembly itself never appears as its own child, and its "Item"
//     value is the assembly NAME rather than a numeric path;
//   * a part's `itemSource.partId` is "" for an assembly, not null.

export type OnshapeBomHeader = {
  id: string;
  name: string;
  propertyName?: string;
};

export type OnshapeBomItemSource = {
  documentId?: string;
  elementId?: string;
  partId?: string;
  configuration?: string;
  wvmId?: string;
  wvmType?: string;
  sourceElementMicroversionId?: string;
  isStandardContent?: boolean;
};

export type OnshapeBomRawRow = {
  itemSource?: OnshapeBomItemSource;
  indentLevel?: number;
  rowId?: string;
  indentedRowId?: string;
  flattenedRowId?: string;
  headerIdToValue?: Record<string, unknown>;
};

export type OnshapeBomResponse = {
  headers?: OnshapeBomHeader[];
  rows?: OnshapeBomRawRow[];
  topLevelAssemblyRow?: OnshapeBomRawRow;
};

/** One BOM line, with its CAD identity intact. */
export type OnshapeBomRow = {
  /** Onshape's positional path ("1", "4.2"). Display only — NEVER an identity. */
  item: string;
  /** 0 for a direct child of the queried assembly. */
  indentLevel: number;
  partNumber: string;
  revision: string;
  name: string;
  description: string;
  quantity: number;
  /** Onshape's own row id. Stable within one response, not across calls. */
  rowId: string;
  documentId: string;
  elementId: string;
  /** null for a subassembly; a Part Studio body id otherwise. */
  partId: string | null;
  configuration: string | null;
  /** Every column, keyed by display name — for custom-field mapping later. */
  columns: Record<string, string>;
};

export type ParsedOnshapeBom = {
  /** The assembly the BOM was requested for. Never one of `rows`. */
  topLevel: OnshapeBomRow | null;
  rows: OnshapeBomRow[];
  /** Rows dropped because they carried no usable CAD identity. */
  skipped: number;
};

// Onshape returns some cells as objects carrying a displayName (Material,
// State, enum-valued custom properties). Flatten to a string either way.
function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const display = record.displayName ?? record.value ?? record.name;
    return typeof display === "string" ? display : "";
  }
  return String(value);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const parsed = Number(toText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildRow(
  raw: OnshapeBomRawRow,
  headers: OnshapeBomHeader[]
): OnshapeBomRow | null {
  const source = raw.itemSource;
  // No document/element means nothing downstream can address this part: it
  // cannot be mapped, exported, or re-resolved. Dropping it is the only honest
  // option — importing it would create an item permanently detached from CAD.
  if (!source?.documentId || !source?.elementId) return null;

  const columns: Record<string, string> = {};
  const values = raw.headerIdToValue ?? {};
  for (const header of headers) {
    if (!header?.name) continue;
    columns[header.name] = toText(values[header.id]);
  }

  const partNumber = columns["Part number"] || "";
  if (!partNumber) return null;

  return {
    item: columns.Item ?? "",
    // indentLevel is authoritative; fall back to the dotted path only if a
    // future response omits it.
    indentLevel:
      typeof raw.indentLevel === "number"
        ? raw.indentLevel
        : Math.max(0, (columns.Item ?? "").split(".").length - 1),
    partNumber,
    revision: columns.Revision ?? "",
    name: columns.Name || columns.Description || partNumber,
    description: columns.Description ?? "",
    quantity: toNumber(
      values[headers.find((h) => h.name === "Quantity")?.id ?? ""]
    ),
    rowId: raw.rowId ?? raw.indentedRowId ?? "",
    documentId: source.documentId,
    elementId: source.elementId,
    // "" means "this is an assembly, not a body in a Part Studio". Normalize to
    // null so the mapping id builder treats it as absent.
    partId: source.partId ? source.partId : null,
    configuration: source.configuration ?? null,
    columns
  };
}

/**
 * Parse a raw Onshape BOM response.
 *
 * Returns the top-level assembly separately from its children, because Onshape
 * does — putting them in one list is what would make the assembly look like its
 * own component.
 */
export function parseOnshapeBom(
  response: OnshapeBomResponse
): ParsedOnshapeBom {
  const headers = Array.isArray(response?.headers) ? response.headers : [];
  const rawRows = Array.isArray(response?.rows) ? response.rows : [];

  const rows: OnshapeBomRow[] = [];
  let skipped = 0;

  for (const raw of rawRows) {
    const row = buildRow(raw, headers);
    if (row) rows.push(row);
    else skipped++;
  }

  const topLevel = response?.topLevelAssemblyRow
    ? buildRow(response.topLevelAssemblyRow, headers)
    : null;

  return { topLevel, rows, skipped };
}

/**
 * Group rows into parent/child by indent level.
 *
 * Onshape emits an indented BOM depth-first, so a row's parent is the nearest
 * preceding row at one level shallower. Level-0 rows are children of the
 * assembly that was queried.
 *
 * Deliberately NOT keyed on the "Item" path: that string is positional and
 * relative to the queried assembly, and the same part appears under every
 * parent that uses it, so it is not an identity and cannot be joined on.
 */
export function buildOnshapeBomTree(rows: OnshapeBomRow[]): OnshapeBomNode[] {
  const roots: OnshapeBomNode[] = [];
  const stack: OnshapeBomNode[] = [];

  for (const row of rows) {
    const node: OnshapeBomNode = { row, children: [] };

    // Pop until the top of the stack is this row's parent.
    while (stack.length > row.indentLevel) stack.pop();

    const parent = stack[stack.length - 1];
    if (!parent) roots.push(node);
    else parent.children.push(node);

    stack.push(node);
  }

  return roots;
}

export type OnshapeBomNode = {
  row: OnshapeBomRow;
  children: OnshapeBomNode[];
};

// ---------------------------------------------------------------------------
// Resolving a BOM row to a Carbon item
// ---------------------------------------------------------------------------

/**
 * Carbon treats '0', '' and NULL as the same "initial" revision — the
 * readableIdWithRevision generated column collapses all three. Onshape sends a
 * letter for a released part and an empty string for an unreleased one.
 */
export function isInitialRevisionLabel(
  revision: string | null | undefined
): boolean {
  return !revision || revision === "0";
}

export function revisionsMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (isInitialRevisionLabel(a) && isInitialRevisionLabel(b)) return true;
  return (a ?? "") === (b ?? "");
}

export type BomRowCandidate = {
  itemId: string;
  /** The RAW item.revision column, not readableIdWithRevision. */
  revision: string | null;
};

export type BomRowResolution =
  /** This exact revision is already in Carbon. */
  | { kind: "matched"; itemId: string }
  /** The part exists in Carbon, but not at the revision this BOM line names. */
  | { kind: "revision-missing"; siblingItemIds: string[] }
  /** Carbon has never seen this CAD part. */
  | { kind: "unmapped" }
  /** Two Carbon items claim the same CAD part AT the same revision. */
  | { kind: "ambiguous"; itemIds: string[] };

/**
 * Which Carbon item a BOM row refers to.
 *
 * The element mapping narrows to the right part FAMILY — one Onshape part maps
 * to every Carbon revision of it, which is why that mapping allows duplicate
 * externalIds. The row's own revision then picks the member.
 *
 * Skipping that second step is a silent data corruption: a BOM line saying
 * "EL-402 revision A" would resolve to whichever revision happened to be
 * mapped — observed live resolving revision A to an item at revision C.
 */
export function resolveBomRow(
  rowRevision: string,
  candidates: BomRowCandidate[]
): BomRowResolution {
  if (candidates.length === 0) return { kind: "unmapped" };

  const matches = candidates.filter((candidate) =>
    revisionsMatch(candidate.revision, rowRevision)
  );

  if (matches.length === 1)
    return { kind: "matched", itemId: matches[0]!.itemId };
  if (matches.length > 1) {
    return { kind: "ambiguous", itemIds: matches.map((m) => m.itemId) };
  }

  return {
    kind: "revision-missing",
    siblingItemIds: candidates.map((c) => c.itemId)
  };
}
