// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// SQL `backflush_job_materials` mirrors these rules.

import { InvalidInputError, ServerFnError } from "@carbon/api/errors";
import type { Database } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { inOrder } from "@carbon/database/rows";
import {
  activationRefusalMessage,
  binShortfall,
  getMethodPartsMissingPullFrom,
  getStrictBackflushSettings,
  pullFromStorageUnit,
  strictBackflushLockKey,
  summarizeList
} from "@carbon/database/strict-backflush";
import { getLogger } from "@carbon/logger";
import { round } from "@carbon/utils";
import { type Kysely, sql } from "kysely";

const logger = getLogger("erp", "strict-backflush");

type LedgerInsert = Database["public"]["Tables"]["itemLedger"]["Insert"];

export {
  getStrictBackflushSettings,
  type StrictBackflushSettings
} from "@carbon/database/strict-backflush";

export async function isStrictBackflush(
  db: Kysely<DB>,
  companyId: string
): Promise<boolean> {
  return (await getStrictBackflushSettings(db, companyId)).strict;
}

type BinCoverArgs = {
  companyId: string;
  itemId: string;
  locationId: string;
  storageUnitId: string | null | undefined;
  quantity: number;
  plannedRows: LedgerInsert[];
  preventNegative: boolean;
  jobReadableId: string;
  /** False in a dry run: its lock would end with its rollback. */
  lock?: boolean;
};

export async function resolvePullFromStorageUnits(
  db: Kysely<DB>,
  companyId: string,
  materials: { id: string; storageUnitId: string | null }[]
): Promise<Map<string, string | null>> {
  const ids = materials.map((material) => material.id);
  const pickLines =
    ids.length === 0
      ? []
      : await db
          .selectFrom("pickingListLine")
          .where("companyId", "=", companyId)
          .where("jobMaterialId", "in", ids)
          .where("storageUnitId", "is not", null)
          .select(["jobMaterialId", "storageUnitId", "toStorageUnitId"])
          .orderBy("createdAt")
          .orderBy("id")
          .execute();
  return new Map(
    materials.map((material) => [
      material.id,
      pullFromStorageUnit(
        material.storageUnitId,
        pickLines.filter((line) => line.jobMaterialId === material.id)
      )
    ])
  );
}

/** Locks every (bin, item) pair in key-hash order, as the SQL does, so two
 *  completions cannot deadlock. */
export async function lockStrictBins(
  db: Kysely<DB>,
  companyId: string,
  pairs: { storageUnitId: string | null | undefined; itemId: string }[]
): Promise<void> {
  const keys = [
    ...new Set(
      pairs.flatMap((pair) =>
        pair.storageUnitId
          ? [strictBackflushLockKey(companyId, pair.storageUnitId, pair.itemId)]
          : []
      )
    )
  ];
  if (keys.length === 0) return;
  await sql`SELECT pg_advisory_xact_lock(k) FROM (SELECT DISTINCT hashtextextended(key, 0) AS k FROM unnest(${keys}::text[]) AS key ORDER BY k) AS locks`.execute(
    db
  );
}

/** `plannedRows`: ledger rows built but not yet written. */
export async function assertBinCovers(
  db: Kysely<DB>,
  args: BinCoverArgs
): Promise<void> {
  const problem = await binCoverProblem(db, args);
  if (problem) throw strictBackflushRefusal([problem]);
}

const SHORTFALLS_SHOWN = 3;

export function strictBackflushRefusal(problems: string[]): ServerFnError {
  if (problems.length > SHORTFALLS_SHOWN) {
    logger.warn("Strict backflush refused", { problems });
  }
  return new ServerFnError(summarizeList(problems, SHORTFALLS_SHOWN), 409);
}

export async function binCoverProblem(
  db: Kysely<DB>,
  args: BinCoverArgs
): Promise<string | null> {
  const { companyId, itemId, locationId, storageUnitId, quantity } = args;

  if (!storageUnitId) {
    const item = await readItemName(db, itemId, companyId);
    return `${item} has no Pull From storage unit on job ${args.jobReadableId}`;
  }

  if (!args.preventNegative) return null;

  // Held until the caller's transaction ends, so two completions cannot both
  // pass the check and overdraw the bin.
  if (args.lock !== false) {
    await lockStrictBins(db, companyId, [{ storageUnitId, itemId }]);
  }

  const row = await db
    .selectFrom("itemLedger")
    .where("itemId", "=", itemId)
    .where("storageUnitId", "=", storageUnitId)
    .where("locationId", "=", locationId)
    .where("companyId", "=", companyId)
    .where("trackedEntityId", "is", null)
    .select((eb) => eb.fn.sum<number>("quantity").as("onHand"))
    .executeTakeFirst();
  const onHand = Number(row?.onHand ?? 0);

  const alreadyDrawn = args.plannedRows
    .filter(
      (planned) =>
        planned.itemId === itemId && planned.storageUnitId === storageUnitId
    )
    .reduce((sum, planned) => sum - Number(planned.quantity), 0);

  if (binShortfall({ onHand, alreadyDrawn, quantity }) === 0) return null;

  const [item, storageUnit] = await inOrder([
    () => readItemName(db, itemId, companyId),
    () =>
      db
        .selectFrom("storageUnit")
        .where("id", "=", storageUnitId)
        .where("companyId", "=", companyId)
        .select("name")
        .executeTakeFirst()
  ]);
  const have = round(Math.max(onHand - alreadyDrawn, 0));
  return `Not enough ${item} in ${storageUnit?.name ?? storageUnitId}: need ${round(quantity)}, have ${have}`;
}

export async function assertMethodHasPullFrom(
  db: Kysely<DB>,
  args: { makeMethodId: string; companyId: string }
): Promise<void> {
  const parts = await getMethodPartsMissingPullFrom(db, args);
  if (parts.length > 0) {
    throw new InvalidInputError(activationRefusalMessage(parts));
  }
}

async function readItemName(
  db: Kysely<DB>,
  itemId: string,
  companyId: string
): Promise<string> {
  const item = await db
    .selectFrom("item")
    .where("id", "=", itemId)
    .where("companyId", "=", companyId)
    .select("readableIdWithRevision")
    .executeTakeFirst();
  return item?.readableIdWithRevision ?? itemId;
}
