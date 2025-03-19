import { Kysely, Transaction } from "npm:kysely@0.27.6";
import { DB } from "../database.ts";

export async function getCurrencyByCode(
  db: Kysely<DB> | Transaction<DB>,
  companyId: string,
  currencyCode: string
) {
  return await db
    .selectFrom("currencies")
    .selectAll()
    .where("code", "=", currencyCode)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
}