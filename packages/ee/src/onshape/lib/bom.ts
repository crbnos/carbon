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
  /**
   * The version this ROW's geometry lives at. Usually the queried version, but
   * a component pulled from a LINKED document carries its own — exporting such
   * a row at the parent's versionId 404s or, worse, exports the wrong geometry.
   */
  wvmType: string | null;
  wvmId: string | null;
  /** Every column, keyed by display name — for custom-field mapping later. */
  columns: Record<string, string>;
};

export type ParsedOnshapeBom = {
  /** The assembly the BOM was requested for. Never one of `rows`. */
  topLevel: OnshapeBomRow | null;
  rows: OnshapeBomRow[];
  /** Rows dropped because they carried no usable CAD identity. */
  skipped: number;
  /**
   * Rows discarded because an ANCESTOR was dropped. Kept separate from
   * `skipped`: these rows were perfectly readable, and the reason they are not
   * imported is that we can no longer say what they hang off.
   */
  orphaned: number;
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

/** Named cells for one raw row. Shared so the tracker and buildRow agree. */
function readColumns(
  raw: OnshapeBomRawRow,
  headers: OnshapeBomHeader[]
): Record<string, string> {
  const columns: Record<string, string> = {};
  const values = raw.headerIdToValue ?? {};
  for (const header of headers) {
    if (!header?.name) continue;
    columns[header.name] = toText(values[header.id]);
  }
  return columns;
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

  const columns = readColumns(raw, headers);
  const values = raw.headerIdToValue ?? {};

  const partNumber = columns["Part number"] || "";
  if (!partNumber) return null;

  // Rows are indexed by this id while resolving. An empty one collapses every
  // such row onto a single map key, so the last one silently wins and the rest
  // vanish from the BOM. A row we cannot address is a row we cannot import.
  const rowId = raw.rowId || raw.indentedRowId || raw.flattenedRowId || "";
  if (!rowId) return null;

  return {
    item: columns.Item ?? "",
    indentLevel: deriveIndentLevel(raw, columns.Item),
    partNumber,
    revision: columns.Revision ?? "",
    name: columns.Name || columns.Description || partNumber,
    description: columns.Description ?? "",
    quantity: toNumber(
      values[headers.find((h) => h.name === "Quantity")?.id ?? ""]
    ),
    rowId: rowId,
    documentId: source.documentId,
    elementId: source.elementId,
    // "" means "this is an assembly, not a body in a Part Studio". Normalize to
    // null so the mapping id builder treats it as absent.
    partId: source.partId ? source.partId : null,
    configuration: source.configuration ?? null,
    wvmType: source.wvmType ?? null,
    wvmId: source.wvmId ?? null,
    columns
  };
}

/**
 * How deep a row sits.
 *
 * `indentLevel` is authoritative; the dotted "Item" path is the fallback for a
 * future response that omits it. ONE definition, because the orphan tracker and
 * the row must agree: reading `indentLevel` directly in the tracker made every
 * row level 0 on the fallback path, which reset the tracker on the very next
 * row and disabled orphan detection entirely in exactly the regime the fallback
 * exists to support.
 */
export function deriveIndentLevel(
  raw: { indentLevel?: unknown },
  itemPath: string | undefined
): number {
  if (typeof raw.indentLevel === "number") return raw.indentLevel;
  return Math.max(0, (itemPath ?? "").split(".").length - 1);
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
  let orphaned = 0;

  // Onshape emits the BOM depth-first, so a row's parent is the nearest
  // PRECEDING row one level shallower. That makes a dropped row dangerous in a
  // way indent level alone cannot detect afterwards: once it is gone, its
  // children look exactly like children of whatever sibling preceded it, and
  // would be silently wired into an unrelated assembly. So the drop has to be
  // noticed HERE, while the original ordering is still visible.
  let droppedAtLevel: number | null = null;

  for (const raw of rawRows) {
    const level = deriveIndentLevel(
      raw,
      readColumns(raw, headers).Item ?? undefined
    );

    // We are inside a dropped row's subtree until the depth returns to it.
    if (droppedAtLevel !== null && level <= droppedAtLevel) {
      droppedAtLevel = null;
    }

    const row = buildRow(raw, headers);

    if (!row) {
      skipped++;
      if (droppedAtLevel === null) droppedAtLevel = level;
      continue;
    }

    if (droppedAtLevel !== null) {
      // A descendant of a row we could not address. Discarding it loses a
      // line; keeping it would attach a component to the wrong assembly.
      orphaned++;
      continue;
    }

    rows.push(row);
  }

  const topLevel = response?.topLevelAssemblyRow
    ? buildRow(response.topLevelAssemblyRow, headers)
    : null;

  return { topLevel, rows, skipped, orphaned };
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

    // A gap means the row's own parent was DROPPED (no part number, no
    // addressable source). Attaching it to whatever is on the stack would
    // silently re-parent a grandchild onto an unrelated assembly, so the
    // subtree is discarded instead — losing a line is recoverable, wiring a
    // component into the wrong assembly is not.
    // Belt and braces: parseOnshapeBom already discards descendants of a
    // dropped row, so a gap here should be unreachable. Skip rather than
    // attach to an arbitrary ancestor if it ever happens.
    if (stack.length < row.indentLevel) continue;

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
