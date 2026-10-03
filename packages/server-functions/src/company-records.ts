// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";
import { NotFoundError } from "./errors";

// Record ids in an input come straight from the caller and prove nothing about
// tenancy: a permission check authorizes the CALLER for companyId, not the ids it
// sends. Several of these ids are only ever written as references into the
// caller's own rows (a ledger's locationId, an activity's trackedEntityId), and
// their single-column FKs accept a row from any company, so nothing downstream
// refuses a foreign id. Re-read them under companyId before writing.

type CompanyScopedTable =
  | "inspection"
  | "inspectionSample"
  | "jobOperationStep"
  | "location"
  | "nonConformance"
  | "productionEvent"
  | "purchaseOrder"
  | "scrapReason"
  | "storageUnit"
  | "trackedEntity"
  | "workCenter";

/**
 * Throws `NotFoundError` unless every provided id is a row of `table` in
 * `companyId`. Null / undefined / duplicate ids are ignored, so optional input
 * fields stay optional. One query per call — collect the ids first.
 */
export async function assertCompanyRecords(
  db: Kysely<KyselyDatabase>,
  table: CompanyScopedTable,
  ids: Iterable<string | null | undefined>,
  companyId: string,
  label: string
): Promise<void> {
  const unique = [
    ...new Set([...ids].filter((id): id is string => typeof id === "string"))
  ];
  if (unique.length === 0) return;

  const rows = await db
    .selectFrom(table)
    .select("id")
    .where("id", "in", unique)
    .where("companyId", "=", companyId)
    .execute();

  if (rows.length !== unique.length) {
    throw new NotFoundError(`${label} not found`);
  }
}
