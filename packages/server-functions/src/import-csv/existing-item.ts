// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Shared pieces of the imports that attach data to an item that already
// exists (supplier price breaks, sale prices, planning, customer part
// numbers): resolving Part Number + Revision to one item, and reading the
// cells. The resolution is pure so it is unit-testable; `loadItemIndex` is
// the one read that feeds it.

import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";
import { itemKey } from "./classify-stock-row";

export type ImportRecord = Record<string, string>;

export type ImportSummary = {
  inserted: number;
  updated: number;
  errors: Array<{ row: number; reason: string }>;
  skipped: Array<{ row: number; reason: string }>;
  /** Rows that updated an existing record, so took no defaults. */
  existingRows?: number[];
};

/** A cell's text, trimmed; a missing cell is "". */
export const cell = (value: string | undefined): string => (value ?? "").trim();

/**
 * The largest value of a Postgres INTEGER column. A whole number above it
 * passes the number checks but aborts the import's transaction when written,
 * so the imports refuse it as a row error.
 */
export const MAX_INTEGER = 2147483647;

/**
 * A numeric cell: `undefined` when blank, `NaN` when it is not a finite
 * number, else the number.
 */
export function numberCell(value: string | undefined): number | undefined {
  const raw = cell(value);
  if (raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export type ItemCandidate = {
  id: string;
  readableId: string;
  revision: string | null;
  type: string;
};

/**
 * Part Number + Revision → every item with that key. `item_unique` includes
 * `type`, so a Part and a Tool may share a key; resolution decides per import.
 */
export function buildItemIndex(
  candidates: ItemCandidate[]
): Map<string, ItemCandidate[]> {
  const index = new Map<string, ItemCandidate[]>();
  for (const candidate of candidates) {
    const key = itemKey(candidate.readableId, candidate.revision ?? "0");
    const list = index.get(key);
    if (list) list.push(candidate);
    else index.set(key, [candidate]);
  }
  return index;
}

export type ItemResolution =
  | { itemId: string; readableId: string; revision: string }
  | { error: string };

/**
 * Resolve a row's Part Number + Revision (blank revision = "0") to the one
 * item of `acceptedTypes` it names: the item types whose page has the tab
 * the import mirrors.
 */
export function resolveItem(
  index: Map<string, ItemCandidate[]>,
  record: ImportRecord,
  acceptedTypes: readonly string[]
): ItemResolution {
  const readableId = cell(record.readableId);
  if (!readableId) return { error: "Missing required Part Number" };
  const revision = cell(record.revision) || "0";

  const candidates = index.get(itemKey(readableId, revision)) ?? [];
  if (candidates.length === 0) {
    return { error: `Item ${readableId} rev ${revision} not found` };
  }

  const accepted = candidates.filter((c) => acceptedTypes.includes(c.type));
  if (accepted.length === 0) {
    const types = [...new Set(candidates.map((c) => c.type))].join(", ");
    return {
      error: `Item ${readableId} rev ${revision} is a ${types}; this import takes ${acceptedTypes.join(", ")} items`
    };
  }
  if (accepted.length > 1) {
    return {
      error: `Part number ${readableId} rev ${revision} matches more than one item: ${accepted
        .map((c) => c.type)
        .join(", ")}`
    };
  }
  return { itemId: accepted[0]!.id, readableId, revision };
}

/** Every company item whose Part Number appears in the file. */
export async function loadItemIndex(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  records: ImportRecord[]
): Promise<Map<string, ItemCandidate[]>> {
  const readableIds = [
    ...new Set(records.map((r) => cell(r.readableId)).filter(Boolean))
  ];
  if (readableIds.length === 0) return new Map();
  const items = await db
    .selectFrom("item")
    .select(["id", "readableId", "revision", "type"])
    .where("companyId", "=", companyId)
    .where("readableId", "in", readableIds)
    .execute();
  return buildItemIndex(items);
}
