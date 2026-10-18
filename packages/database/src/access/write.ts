import type { Kysely } from "kysely";
import type { KyselyDatabase, KyselyTx } from "../client";
import type { Database } from "../types";
import type { Level } from "./levels";
import { clampLevel } from "./registry";

export type GrantModule = Database["public"]["Enums"]["module"];

export type GrantSubject =
  | { employeeTypeId: string }
  | { userId: string }
  | { apiKeyId: string };

/** One grant to store. A null level stores nothing: the subject inherits. */
export type GrantInput = {
  module: GrantModule;
  page: string | null;
  level: Level | null;
};

function subjectColumn(subject: GrantSubject) {
  if ("employeeTypeId" in subject)
    return ["employeeTypeId", subject.employeeTypeId] as const;
  if ("userId" in subject) return ["userId", subject.userId] as const;
  return ["apiKeyId", subject.apiKeyId] as const;
}

/** The subject's grants in the company. */
export function readGrants(
  db: Kysely<KyselyDatabase> | KyselyTx,
  companyId: string,
  subject: GrantSubject
) {
  const [column, id] = subjectColumn(subject);
  return db
    .selectFrom("permission")
    .select(["module", "page", "level"])
    .where("companyId", "=", companyId)
    .where(column, "=", id)
    .execute();
}

/**
 * Replace every grant of one subject in one company, in one transaction. Each
 * level is clamped to its page's `maxLevel`. The new rows carry no
 * `convertedFrom`: a save clears the conversion report for the subject.
 */
export async function replaceGrants(
  db: Kysely<KyselyDatabase> | KyselyTx,
  {
    companyId,
    subject,
    grants,
    userId
  }: {
    companyId: string;
    subject: GrantSubject;
    grants: readonly GrantInput[];
    /** Who made the change, for `createdBy`. */
    userId: string;
  }
) {
  const [column, id] = subjectColumn(subject);
  const rows = grants
    .filter((grant) => grant.level !== null)
    .map((grant) => ({
      companyId,
      employeeTypeId: column === "employeeTypeId" ? id : null,
      userId: column === "userId" ? id : null,
      apiKeyId: column === "apiKeyId" ? id : null,
      module: grant.module,
      page: grant.page,
      level: clampLevel(
        grant.page ?? grant.module.toLowerCase(),
        grant.level as Level
      ),
      createdBy: userId
    }));

  const write = async (tx: KyselyTx) => {
    await tx
      .deleteFrom("permission")
      .where("companyId", "=", companyId)
      .where(column, "=", id)
      .execute();
    if (rows.length) await tx.insertInto("permission").values(rows).execute();
  };
  if (db.isTransaction) return write(db as KyselyTx);
  return db.transaction().execute(write);
}
