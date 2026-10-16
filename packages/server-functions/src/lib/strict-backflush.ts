// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Strict backflush (companySettings.requireBackflushStorageUnit,
// .ai/specs/2026-10-14-strict-backflush.md): a stocked material is consumed
// only from its own storage unit, never another bin. A missing bin refuses the
// backflush; a short bin refuses it only while preventNegativeBackflush is on —
// with it off the bin is drawn below zero. The SQL job-completion backflush
// (`backflush_job_materials`) enforces the same rules.

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
import { InvalidInputError, ServerFnError } from "../errors";

const logger = getLogger("server-functions", "strict-backflush");

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
  /** The material's Pull From (`resolvePullFromStorageUnits`). */
  storageUnitId: string | null | undefined;
  quantity: number;
  plannedRows: LedgerInsert[];
  /** Refuse a short bin (true) or let it go negative (false). */
  preventNegative: boolean;
  /** The job's readable id, for the missing-bin message. */
  jobReadableId: string;
};

/**
 * The Pull From of each material, by job material id. A pick points a line at
 * lineside; `pullFromStorageUnit` recovers the bin it was picked from, so what
 * no pick covered still comes from the Pull From.
 */
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

/**
 * Takes the strict lock of every (bin, item) pair for the rest of the
 * caller's transaction, in one fixed order (by key hash), so two completions
 * drawing the same pairs cannot deadlock. SQL `backflush_job_materials` locks
 * in the same order. Locks are re-entrant, so taking one twice is harmless.
 */
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

/**
 * Refuses (409) when `storageUnitId` is missing or cannot cover `quantity`.
 * `plannedRows` are the ledger rows this backflush has built but not yet
 * written — their draws on the same item and bin are subtracted first.
 */
export async function assertBinCovers(
  db: Kysely<DB>,
  args: BinCoverArgs
): Promise<void> {
  const problem = await binCoverProblem(db, args);
  if (problem) throw strictBackflushRefusal([problem]);
}

// A shortfall reads "Not enough X in BIN: need n, have m" — long enough that
// three of them fill a toast.
const SHORTFALLS_SHOWN = 3;

/** One refusal for every material the backflush cannot cover, so the
 *  material controller fixes them all before the operator retries. The toast
 *  names the first few and counts the rest; the log keeps the full list. */
export function strictBackflushRefusal(problems: string[]): ServerFnError {
  if (problems.length > SHORTFALLS_SHOWN) {
    logger.warn("Strict backflush refused", { problems });
  }
  return new ServerFnError(summarizeList(problems, SHORTFALLS_SHOWN), 409);
}

/**
 * Why `storageUnitId` cannot cover `quantity` — a missing bin, or a short one
 * while `preventNegative` — or null when it can. Takes the bin's lock whenever
 * it checks the quantity (see below).
 */
export async function binCoverProblem(
  db: Kysely<DB>,
  args: BinCoverArgs
): Promise<string | null> {
  const { companyId, itemId, locationId, storageUnitId, quantity } = args;

  if (!storageUnitId) {
    const item = await readItemName(db, itemId, companyId);
    return `${item} has no Pull From storage unit on job ${args.jobReadableId}`;
  }

  // Negative stock allowed: the material is drawn from its own bin whatever
  // that bin holds, so there is nothing to check or serialize.
  if (!args.preventNegative) return null;

  // Serialize strict draws on this bin and item until the caller's transaction
  // ends, so two completions cannot both pass the check and overdraw it.
  // A caller drawing several pairs locks them all first (`lockStrictBins`).
  await lockStrictBins(db, companyId, [{ storageUnitId, itemId }]);

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

/**
 * Refuses (400) to activate a make method while a pulled, stocked line has no
 * Pull From storage unit at one of `getPullFromLocations` (an active work
 * center and an active storage unit).
 */
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
