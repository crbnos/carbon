// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Pure rules behind the inspection entry grids (ERP `InspectionMeasurementGrid`,
 * MES `InspectionMeasurementMatrix`): the layout default, the limits label,
 * and how a pasted block or a "Pass all" maps onto cells. No React, no I/O.
 * Spec: `.ai/specs/2026-11-05-inspection-entry-ergonomics.md`.
 */

import type { ToleranceLimits } from "@carbon/database/inspection-verdict";
import { MEASUREMENT_FORMAT } from "./format";

// "byCharacteristic": one row per characteristic, one column per sample.
// "byPart": one row per sample (a part), one column per characteristic.
export const inspectionGridLayouts = ["byCharacteristic", "byPart"] as const;
export type InspectionGridLayout = (typeof inspectionGridLayouts)[number];

export const INSPECTION_GRID_LAYOUT_STORAGE_KEY =
  "carbon:inspection-grid-layout";
export const INSPECTION_DRAWING_HIDDEN_STORAGE_KEY =
  "carbon:inspection-drawing-hidden";

export function isInspectionGridLayout(
  value: unknown
): value is InspectionGridLayout {
  return (
    typeof value === "string" &&
    (inspectionGridLayouts as readonly string[]).includes(value)
  );
}

// Parts down the page once there are more samples than characteristics: the
// long axis then scrolls vertically instead of sideways.
export function defaultInspectionGridLayout({
  sampleCount,
  characteristicCount
}: {
  sampleCount: number;
  characteristicCount: number;
}): InspectionGridLayout {
  return sampleCount > characteristicCount ? "byPart" : "byCharacteristic";
}

const readingFormat = new Intl.NumberFormat("en-US", MEASUREMENT_FORMAT);

// A reading or limit as a plain decimal: `String(0.0000005)` is "5e-7".
export function formatReading(value: number): string {
  return readingFormat.format(value);
}

// A limit already rounded to `decimals` places, written with exactly that many.
function padDecimals(value: number, decimals: number): string {
  const text = formatReading(value);
  if (decimals === 0) return text;
  const [whole, fraction = ""] = text.split(".");
  return `${whole}.${fraction.padEnd(decimals, "0")}`;
}

export function formatToleranceLimits(
  limits: ToleranceLimits,
  unit?: string | null
): string {
  const range = `${padDecimals(limits.lower, limits.decimals)} – ${padDecimals(limits.upper, limits.decimals)}`;
  return unit ? `${range} ${unit}` : range;
}

// The plan's own notation, e.g. "10 +0.1/−0.05 mm" — the tooltip under the limits.
export function formatSpecLabel(feature: {
  nominalValue: string | null;
  tolerancePlus: string | null;
  toleranceMinus: string | null;
  unit?: string | null;
}): string {
  return [
    feature.nominalValue,
    feature.tolerancePlus != null || feature.toleranceMinus != null
      ? `+${(feature.tolerancePlus ?? "0").replace(/^[+-]/, "")}/−${(feature.toleranceMinus ?? "0").replace(/^[+-]/, "")}`
      : null,
    feature.unit
  ]
    .filter(Boolean)
    .join(" ");
}

// Spreadsheets copy a block as tab-separated cells, one line per row.
export function parseClipboardGrid(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
    lines.pop();
  }
  return lines.map((line) => line.split("\t"));
}

export function isMultiCellPaste(grid: string[][]): boolean {
  return grid.length > 1 || (grid[0]?.length ?? 0) > 1;
}

// A pasted reading. Both decimal marks are read: "1,234.5" (comma groups),
// "1.234,5" (dot groups) and "10,05" (comma decimal). Null when the token is
// not a number, and for a lone comma that could mean either ("1,234" is 1234
// or 1.234): a skipped cell is better than a reading 1000 times too small.
export function parseMeasurementToken(token: string): number | null {
  let text = token.replace(/\s/g, "");
  if (text === "") return null;
  if (text.includes(",") && text.includes(".")) {
    // Both marks: the last one is the decimal, the other groups thousands.
    // A token that fits neither convention is skipped, not guessed.
    if (/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(text)) {
      text = text.replace(/,/g, "");
    } else if (/^[+-]?\d{1,3}(\.\d{3})+(,\d*)?$/.test(text)) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      return null;
    }
  } else if ((text.match(/,/g) ?? []).length === 1) {
    if (/^[+-]?[1-9]\d{0,2},\d{3}$/.test(text)) return null;
    text = text.replace(",", ".");
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) return null;
  const value = Number(text.replace(/^\+/, ""));
  return Number.isFinite(value) ? value : null;
}

const PASS_TOKENS = new Set([
  "p",
  "pass",
  "passed",
  "ok",
  "1",
  "true",
  "y",
  "yes",
  "go",
  "✓",
  "✔"
]);
const FAIL_TOKENS = new Set([
  "f",
  "fail",
  "failed",
  "ng",
  "nok",
  "0",
  "false",
  "n",
  "no",
  "nogo",
  "no-go",
  "x",
  "✗",
  "✘"
]);

// A pasted go / no-go result. Null when the token is neither.
export function parseAttributeToken(token: string): boolean | null {
  const text = token.trim().toLowerCase();
  if (PASS_TOKENS.has(text)) return true;
  if (FAIL_TOKENS.has(text)) return false;
  return null;
}

export type PasteCell = {
  characteristicIndex: number;
  sampleIndex: number;
  token: string;
};

// Lays a pasted block onto the grid from the focused cell. By characteristic,
// pasted rows run down the characteristics and columns across the samples; by
// part, rows run down the samples and columns across the characteristics.
// Blank tokens are left out; cells past the grid's edge are counted, not kept.
// Cells come back in sample order, so anonymous samples are made in column order.
export function planPaste({
  grid,
  layout,
  origin,
  characteristicCount,
  sampleLimit
}: {
  grid: string[][];
  layout: InspectionGridLayout;
  origin: { characteristicIndex: number; sampleIndex: number };
  characteristicCount: number;
  sampleLimit: number;
}): { cells: PasteCell[]; outOfRange: number } {
  const cells: PasteCell[] = [];
  let outOfRange = 0;
  grid.forEach((line, r) => {
    line.forEach((token, c) => {
      if (token.trim() === "") return;
      const characteristicIndex =
        origin.characteristicIndex + (layout === "byCharacteristic" ? r : c);
      const sampleIndex =
        origin.sampleIndex + (layout === "byCharacteristic" ? c : r);
      if (
        characteristicIndex >= characteristicCount ||
        sampleIndex >= sampleLimit
      ) {
        outOfRange += 1;
        return;
      }
      cells.push({ characteristicIndex, sampleIndex, token: token.trim() });
    });
  });
  cells.sort(
    (a, b) =>
      a.sampleIndex - b.sampleIndex ||
      a.characteristicIndex - b.characteristicIndex
  );
  return { cells, outOfRange };
}

// The samples "Pass all" records a pass on: each empty cell among the first
// max(n, samples that exist) columns, never past the columns the grid shows.
export function passAllTargets({
  statuses,
  sampleSize,
  existingSamples,
  columnCount
}: {
  statuses: readonly (string | undefined)[];
  sampleSize: number;
  existingSamples: number;
  columnCount: number;
}): number[] {
  const limit = Math.min(columnCount, Math.max(sampleSize, existingSamples));
  const targets: number[] = [];
  for (let i = 0; i < limit; i++) {
    const status = statuses[i];
    if (status == null || status === "Pending") targets.push(i);
  }
  return targets;
}

// The order samples take in the grid on first load: the order they were made.
// The loader's embed has no order of its own (an UPDATE moves a row), so a
// position read from it can name another sample after any reload.
export function compareSamplesByCreation(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string }
): number {
  return a.createdAt < b.createdAt
    ? -1
    : a.createdAt > b.createdAt
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;
}

// Which sample each grid position (column or row index) shows. A sample keeps
// the position it already has, so a reload never moves a reading under the
// inspector's cursor or sends the next save to another sample. A sample made
// by a save the loader has not returned yet keeps its position too. Samples
// with no position yet take the lowest free ones, in `sampleIds` order.
// `dropMissing` is for serial lots: a serial sample is made only by a scan,
// which reloads the page, so an id the loader no longer returns was deleted.
// Its position is freed; every other sample keeps its own.
export function placeSamples(
  previous: Readonly<Record<number, string>>,
  sampleIds: readonly string[],
  options: { dropMissing?: boolean } = {}
): Record<number, string> {
  const next: Record<number, string> = {};
  const placed = new Set<string>();
  const loaded = options.dropMissing ? new Set(sampleIds) : null;
  for (const [position, id] of Object.entries(previous)) {
    if (placed.has(id)) continue;
    if (loaded && !loaded.has(id)) continue;
    next[Number(position)] = id;
    placed.add(id);
  }
  let slot = 0;
  for (const id of sampleIds) {
    if (placed.has(id)) continue;
    while (slot in next) slot += 1;
    next[slot] = id;
    placed.add(id);
  }
  return next;
}
