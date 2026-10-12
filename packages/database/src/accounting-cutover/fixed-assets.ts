// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Fixed assets at the cutover
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 3, step 3),
// and the accumulated depreciation the wizard edits before the enable.

import { sql } from "kysely";
import { assetsLeavingWithoutJournal } from "../legacy-documents";
import { EPSILON, round } from "../precision";
import {
  type CutoverArgs,
  type CutoverDb,
  refuseAfterCutover,
  withTransaction
} from "./shared";

export type CutoverFixedAsset = {
  id: string;
  fixedAssetId: string;
  name: string;
  status: string;
  fixedAssetClassId: string;
  cost: number;
  /** As of the day before the cutover. */
  accumulatedDepreciation: number;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
};

/**
 * Assets disposed on or after the cutover whose disposal has no journal and
 * gets none at the enable (`assetsLeavingWithoutJournal`,
 * legacy-documents.ts). Such an asset leaves the books with no journal, so it
 * is not in the opening fixed assets, and its depreciation after the cutover
 * is not rebuilt.
 */
export async function getAssetsLeavingWithoutJournal(
  db: CutoverDb,
  args: CutoverArgs
): Promise<Set<string>> {
  const rows = await assetsLeavingWithoutJournal(db, args).execute();
  return new Set(rows.map((row) => row.id));
}

/**
 * Per asset, the depreciation that Posted runs booked for months on or after
 * the cutover. The asset's `accumulatedDepreciation` includes it; the enable
 * writes those runs' journals again (activate-accounting/legacy/runs.ts), so
 * the opening balance takes it out.
 */
export async function getDepreciationAfterCutover(
  db: CutoverDb,
  { companyId, cutoverDate }: CutoverArgs
): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom("depreciationRunLine as line")
    .innerJoin("depreciationRun as run", (join) =>
      join
        .onRef("run.id", "=", "line.depreciationRunId")
        .onRef("run.companyId", "=", "line.companyId")
    )
    .select([
      "line.fixedAssetId",
      sql<number>`sum("line"."amount")`.as("amount")
    ])
    .where("line.companyId", "=", companyId)
    .where("run.status", "=", "Posted")
    // A line from before per-month lines has no month: it is the run's.
    .where(
      sql<string>`coalesce("line"."periodEnd", "run"."periodEnd")`,
      ">=",
      cutoverDate
    )
    .groupBy("line.fixedAssetId")
    .execute();
  return new Map(
    rows.map((row) => [row.fixedAssetId, round(Number(row.amount))])
  );
}

/**
 * The fixed assets on the books the day before the cutover, with their class
 * accounts: registered (not Draft), acquired before the cutover, and not
 * disposed, or disposed on or
 * after it by a disposal that carries a journal after the enable (see
 * `getAssetsLeavingWithoutJournal`). `accumulatedDepreciation` is as of the
 * day before the cutover: the asset's own less what runs booked for months
 * on or after it.
 */
export async function getCutoverFixedAssets(
  db: CutoverDb,
  args: CutoverArgs
): Promise<CutoverFixedAsset[]> {
  const { companyId, cutoverDate } = args;
  const [rows, leavingWithoutJournal, depreciationAfter] = await Promise.all([
    db
      .selectFrom("fixedAsset as asset")
      .innerJoin("fixedAssetClass as class", (join) =>
        join
          .onRef("class.id", "=", "asset.fixedAssetClassId")
          .onRef("class.companyId", "=", "asset.companyId")
      )
      .select([
        "asset.id",
        "asset.fixedAssetId",
        "asset.name",
        "asset.status",
        "asset.fixedAssetClassId",
        "asset.acquisitionCost",
        "asset.accumulatedDepreciation",
        "class.assetAccountId",
        "class.accumulatedDepreciationAccountId"
      ])
      .where("asset.companyId", "=", companyId)
      // A Draft asset is not registered: it has no cost on the books yet.
      // Under Construction stays: its cost sits on its construction-in-
      // progress class's asset account, which capitalization credits.
      .where("asset.status", "!=", "Draft")
      .where((eb) =>
        eb.or([
          eb("asset.status", "!=", "Disposed"),
          eb("asset.disposalDate", ">=", cutoverDate)
        ])
      )
      .where("asset.acquisitionDate", "<", cutoverDate)
      .orderBy("asset.fixedAssetId")
      .execute(),
    getAssetsLeavingWithoutJournal(db, args),
    getDepreciationAfterCutover(db, args)
  ]);
  return rows
    .filter((row) => !leavingWithoutJournal.has(row.id))
    .map((row) => ({
      id: row.id,
      fixedAssetId: row.fixedAssetId,
      name: row.name,
      status: row.status,
      fixedAssetClassId: row.fixedAssetClassId,
      cost: Number(row.acquisitionCost),
      accumulatedDepreciation: round(
        Number(row.accumulatedDepreciation) -
          (depreciationAfter.get(row.id) ?? 0)
      ),
      assetAccountId: row.assetAccountId,
      accumulatedDepreciationAccountId: row.accumulatedDepreciationAccountId
    }));
}

/**
 * Sets an asset's accumulated depreciation as of the day before the cutover,
 * before the enable. The asset keeps what runs booked for months on or after
 * the cutover on top of it, so the stored value is the entered one plus that
 * (see `getDepreciationAfterCutover`). Returns the value as of the day
 * before the cutover.
 */
export async function updateCutoverAccumulatedDepreciation(
  db: CutoverDb,
  {
    companyId,
    cutoverDate,
    fixedAssetId,
    accumulatedDepreciation,
    userId
  }: {
    companyId: string;
    cutoverDate: string;
    fixedAssetId: string;
    accumulatedDepreciation: number;
    userId: string;
  }
): Promise<{ id: string; accumulatedDepreciation: number }> {
  if (
    !Number.isFinite(accumulatedDepreciation) ||
    accumulatedDepreciation < 0
  ) {
    throw new Error("Accumulated depreciation must be zero or more");
  }
  return withTransaction(db, async (trx) => {
    await refuseAfterCutover(trx, companyId);
    const asset = await trx
      .selectFrom("fixedAsset")
      .select(["id", "status", "acquisitionCost"])
      .where("id", "=", fixedAssetId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!asset) throw new Error("Fixed asset not found");
    if (asset.status === "Disposed") {
      // A disposal after the cutover cleared the accumulated depreciation it
      // found; changing it now would part the asset from its disposal.
      throw new Error(
        "A disposed asset keeps the accumulated depreciation its disposal cleared"
      );
    }
    const after =
      (await getDepreciationAfterCutover(trx, { companyId, cutoverDate })).get(
        fixedAssetId
      ) ?? 0;
    const stored = round(accumulatedDepreciation + after);
    if (stored > Number(asset.acquisitionCost) + EPSILON) {
      throw new Error(
        "Accumulated depreciation cannot exceed the asset's cost"
      );
    }
    const updated = await trx
      .updateTable("fixedAsset")
      .set({
        accumulatedDepreciation: stored,
        updatedBy: userId,
        updatedAt: sql`now()`
      })
      .where("id", "=", fixedAssetId)
      .where("companyId", "=", companyId)
      .returning(["id", "accumulatedDepreciation"])
      .executeTakeFirstOrThrow();
    return {
      id: updated.id,
      accumulatedDepreciation: round(
        Number(updated.accumulatedDepreciation) - after
      )
    };
  });
}
