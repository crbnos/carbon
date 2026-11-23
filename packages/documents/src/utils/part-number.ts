// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";

/**
 * Which part numbers a document line prints: ours, the other party's, or both
 * in either order. "Theirs" is the customer on a sales document and the
 * supplier on a purchasing document. Each line stores its own choice.
 */
export type PartNumberDisplay =
  Database["public"]["Enums"]["partNumberDisplay"];

/** Every value, in the order the selects list them. */
export const PART_NUMBER_DISPLAYS = [
  "Ours First",
  "Theirs First",
  "Theirs Only",
  "Ours Only"
] as const satisfies readonly PartNumberDisplay[];

export function isPartNumberDisplay(
  value: unknown
): value is PartNumberDisplay {
  return (PART_NUMBER_DISPLAYS as readonly unknown[]).includes(value);
}

/**
 * What a legacy line (a null display choice) prints, per surface. Each value
 * repeats what the surface printed before the setting existed. The purchase
 * order PDF prints its legacy lines in code instead: our part number as the
 * title with the supplier's in the "Supplier Part ID:" row
 * (`purchaseOrder/vars.ts`).
 */
export const LEGACY_PART_NUMBER_DISPLAY = {
  quote: "Ours First",
  sharedQuote: "Ours Only",
  salesOrder: "Ours First",
  salesInvoice: "Ours Only",
  packingSlip: "Ours Only",
  purchaseOrderEmail: "Ours First"
} as const satisfies Record<string, PartNumberDisplay>;

export type PartNumberSurface = keyof typeof LEGACY_PART_NUMBER_DISPLAY;

export function resolvePartNumberDisplay(
  surface: PartNumberSurface,
  stored: PartNumberDisplay | null | undefined
): PartNumberDisplay {
  return stored ?? LEGACY_PART_NUMBER_DISPLAY[surface];
}

/** Whose part number "theirs" is: the customer's or the supplier's. */
export type PartNumberParty = "customer" | "supplier";

/** What the Edit document select shows for a document's lines. */
export type PartNumberDisplaySummary = PartNumberDisplay | "mixed" | null;

export function summarizePartNumberDisplay(
  values: readonly (PartNumberDisplay | null | undefined)[]
): PartNumberDisplaySummary {
  if (values.length === 0) return null;
  const first = values[0] ?? null;
  return values.every((value) => (value ?? null) === first) ? first : "mixed";
}

/** Our part number and the other party's, as one line holds them. */
export type PartNumbers = {
  ours: string | null | undefined;
  theirs: string | null | undefined;
  theirsRevision?: string | null;
};

/**
 * The part number one line prints. A line with no number of theirs, or one
 * equal to ours, prints ours whatever the choice.
 */
export function formatPartNumber(
  parts: PartNumbers,
  display: PartNumberDisplay
): string {
  const ours = parts.ours?.trim() ?? "";
  const theirs = parts.theirs?.trim() ?? "";
  const revision = parts.theirsRevision?.trim() ?? "";
  if (!theirs || (theirs === ours && !revision)) return ours;
  const theirsText = revision ? `${theirs} Rev ${revision}` : theirs;
  if (!ours) return theirsText;
  switch (display) {
    case "Ours First":
      return `${ours} (${theirsText})`;
    case "Theirs First":
      return `${theirsText} (${ours})`;
    case "Theirs Only":
      return theirsText;
    case "Ours Only":
      return ours;
  }
}

/**
 * The part number a line prints on `surface`: the Edit document modal's
 * unsaved `draft`, else the line's `stored` choice, else the surface's legacy
 * output.
 */
export function formatLinePartNumber(
  surface: PartNumberSurface,
  parts: PartNumbers,
  stored: PartNumberDisplay | null | undefined,
  draft?: PartNumberDisplay
): string {
  return formatPartNumber(
    parts,
    resolvePartNumberDisplay(surface, draft ?? stored)
  );
}
