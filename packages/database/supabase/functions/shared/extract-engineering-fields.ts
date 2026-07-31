// The engineering facts Carbon reads off a synced BOM row — release state, mass,
// material and vendor — pulled out under stable keys at write time so the
// engineering data view can read them with plain JSON paths.
//
// The input is ONE FLATTENED BOM row: the BOM route maps each Onshape BOM header
// to a property named after that header (and collapses Material to its display
// name), and that object is what lands in
// externalIntegrationMapping.metadata for integration 'onshapeData'. Header
// names are configurable per Onshape company, so the lookup is case-insensitive
// and alias-aware, and an unrecognized column yields null rather than an error:
// the raw row is still stored alongside, so adding an alias is a one-line fix
// and never a silent hole.
//
// Pure — no DB, no I/O — so it is unit-testable with `deno test`.

export type EngineeringFields = {
  state: string | null;
  mass: string | null;
  material: string | null;
  vendor: string | null;
};

/**
 * The BOM header names each engineering field may arrive under, most canonical
 * first. Matching ignores case and surrounding whitespace.
 */
const headerAliases: Record<keyof EngineeringFields, readonly string[]> = {
  state: ["State"],
  mass: ["Mass"],
  material: ["Material"],
  vendor: ["Vendor", "Supplier"],
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

/**
 * A BOM cell reads as text or it reads as nothing. Numbers and booleans are
 * stringified (a mass column can arrive as a number); a nested object — an
 * unresolved Onshape value that lost its display name — has no readable form
 * here and becomes null.
 */
function readCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

export function extractEngineeringFields(
  bomRow: Record<string, unknown>
): EngineeringFields {
  const empty: EngineeringFields = {
    state: null,
    mass: null,
    material: null,
    vendor: null,
  };

  if (bomRow === null || typeof bomRow !== "object" || Array.isArray(bomRow)) {
    return empty;
  }

  try {
    const cellsByHeader = new Map<string, unknown>();
    for (const [header, value] of Object.entries(bomRow)) {
      const normalized = normalizeHeader(header);
      // First column wins, so a lower-cased duplicate can never shadow the
      // header Onshape actually sent.
      if (!cellsByHeader.has(normalized)) {
        cellsByHeader.set(normalized, value);
      }
    }

    const readField = (field: keyof EngineeringFields): string | null => {
      for (const alias of headerAliases[field]) {
        const cell = readCell(cellsByHeader.get(normalizeHeader(alias)));
        if (cell !== null) return cell;
      }
      return null;
    };

    return {
      state: readField("state"),
      mass: readField("mass"),
      material: readField("material"),
      vendor: readField("vendor"),
    };
  } catch {
    // A BOM row is third-party JSON: an exotic value (a throwing getter, a
    // revoked proxy) must cost the engineering fields, never the BOM sync.
    return empty;
  }
}
