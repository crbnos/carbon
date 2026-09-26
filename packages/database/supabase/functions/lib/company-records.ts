import type { Kysely } from "kysely";
import type { DB } from "./database.ts";

// Record ids in a payload come straight from the caller and prove nothing about
// tenancy: requirePermissions authorizes the CALLER for companyId, not the ids it
// sends. Several of these ids are only ever written as references into the
// caller's own rows (a ledger's locationId, an activity's trackedEntityId), and
// their single-column FKs accept a row from any company — so nothing downstream
// refuses a foreign id. Re-read them under companyId before writing.
export class RecordNotFoundError extends Error {
  readonly status = 404;
}

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
  | "trackedEntity";

/**
 * Throws `RecordNotFoundError` unless every provided id is a row of `table` in
 * `companyId`. Null / undefined / duplicate ids are ignored, so optional payload
 * fields stay optional. One query per call — collect the ids first.
 */
export async function assertCompanyRecords(
  db: Kysely<DB>,
  table: CompanyScopedTable,
  ids: Iterable<string | null | undefined>,
  companyId: string,
  label: string
): Promise<void> {
  const unique = [
    ...new Set([...ids].filter((id): id is string => typeof id === "string")),
  ];
  if (unique.length === 0) return;

  const rows = await db
    .selectFrom(table)
    .select("id")
    .where("id", "in", unique)
    .where("companyId", "=", companyId)
    .execute();

  if (rows.length !== unique.length) {
    throw new RecordNotFoundError(`${label} not found`);
  }
}
