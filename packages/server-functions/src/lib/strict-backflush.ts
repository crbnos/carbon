// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Strict backflush (companySettings.requireBackflushStorageUnit,
// .ai/specs/2026-10-14-strict-backflush.md): a stocked material is consumed
// only from its own storage unit, and a missing or short bin refuses the
// backflush instead of falling back to another bin. The SQL job-completion
// backflush (`backflush_job_materials`) enforces the same rule.

import type { Database } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import {
  binShortfall,
  getPullFromLocations,
  missingPullFromLocations,
  needsPullFrom,
  summarizeList
} from "@carbon/database/strict-backflush";
import { getLogger } from "@carbon/logger";
import { round } from "@carbon/utils";
import { type Kysely, sql } from "kysely";
import { InvalidInputError, ServerFnError } from "../errors";

const logger = getLogger("server-functions", "strict-backflush");

type LedgerInsert = Database["public"]["Tables"]["itemLedger"]["Insert"];

export async function isStrictBackflush(
  db: Kysely<DB>,
  companyId: string
): Promise<boolean> {
  const row = await db
    .selectFrom("companySettings")
    .where("id", "=", companyId)
    .select("requireBackflushStorageUnit")
    .executeTakeFirst();
  return row?.requireBackflushStorageUnit === true;
}

type BinCoverArgs = {
  companyId: string;
  itemId: string;
  locationId: string;
  storageUnitId: string | null | undefined;
  quantity: number;
  plannedRows: LedgerInsert[];
};

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
 * Why `storageUnitId` cannot cover `quantity` — a missing bin or a short one —
 * or null when it can. Takes the bin's lock either way (see below).
 */
export async function binCoverProblem(
  db: Kysely<DB>,
  args: BinCoverArgs
): Promise<string | null> {
  const { companyId, itemId, locationId, storageUnitId, quantity } = args;

  if (!storageUnitId) {
    const item = await readItemName(db, itemId, companyId);
    return `${item} has no Pull From storage unit on this job`;
  }

  // Serialize strict draws on this bin and item until the caller's transaction
  // ends, so two completions cannot both pass the check and overdraw it. SQL
  // `backflush_job_materials` takes the same key.
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`strict-backflush:${companyId}:${storageUnitId}:${itemId}`}, 0))`.execute(
    db
  );

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

  const [item, storageUnit] = await Promise.all([
    readItemName(db, itemId, companyId),
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
  const { makeMethodId, companyId } = args;

  const [lines, locations] = await Promise.all([
    db
      .selectFrom("methodMaterial")
      .innerJoin("item", "item.id", "methodMaterial.itemId")
      .where("methodMaterial.makeMethodId", "=", makeMethodId)
      .where("methodMaterial.companyId", "=", companyId)
      .select([
        "methodMaterial.methodType",
        "methodMaterial.itemType",
        "methodMaterial.storageUnitIds",
        "methodMaterial.order",
        "item.id as itemId",
        "item.itemTrackingType",
        "item.readableIdWithRevision"
      ])
      .orderBy("methodMaterial.order")
      .execute(),
    getPullFromLocations(db, companyId)
  ]);

  const locationIds = locations.map((location) => location.id);

  // One entry per part: the toast names what to fix, not where.
  const parts = [
    ...new Set(
      lines
        .filter(needsPullFrom)
        .filter(
          (line) =>
            missingPullFromLocations(line.storageUnitIds, locationIds).length >
            0
        )
        .map((line) => line.readableIdWithRevision ?? line.itemId)
    )
  ];

  if (parts.length === 0) return;

  const list = summarizeList(parts);
  throw new InvalidInputError(
    `Set a Pull From storage unit before you activate this version: ${list}`
  );
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
