// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely } from "kysely";
import { type KyselyDatabase, type KyselyTx, withTransaction } from "../client";
import type { Level } from "./levels";
import {
  clampLevel,
  isPageModule,
  type ModuleEnum,
  moduleId
} from "./registry";
import type { Grant } from "./resolve";

export type GrantSubject =
  | { employeeTypeId: string }
  | { userId: string }
  | { apiKeyId: string };

/** One stored grant: a level on a module (`page` null) or on one of its pages. */
export type StoredGrant = {
  module: ModuleEnum;
  page: string | null;
  level: Level;
};

/** One grant to store. A null level stores nothing: the subject inherits. */
export type GrantInput = Omit<StoredGrant, "level"> & { level: Level | null };

function subjectColumn(subject: GrantSubject) {
  if ("employeeTypeId" in subject)
    return ["employeeTypeId", subject.employeeTypeId] as const;
  if ("userId" in subject) return ["userId", subject.userId] as const;
  return ["apiKeyId", subject.apiKeyId] as const;
}

/** Which subject a `permission` row belongs to: the column it sets. */
export function subjectTypeOfRow(row: {
  employeeTypeId: string | null;
  userId: string | null;
}): Grant["subject"] {
  return row.userId ? "person" : row.employeeTypeId ? "role" : "key";
}

/**
 * Every grant in the company, with the subject it belongs to. One on a module
 * with no pages grants nothing, so it is left out.
 */
export async function readCompanyGrants(
  db: Kysely<KyselyDatabase> | KyselyTx,
  companyId: string,
  subject?: GrantSubject
) {
  let query = db
    .selectFrom("permission")
    .select([
      "employeeTypeId",
      "userId",
      "apiKeyId",
      "module",
      "page",
      "level",
      "convertedFrom"
    ])
    .where("companyId", "=", companyId);
  if (subject) {
    const [column, id] = subjectColumn(subject);
    query = query.where(column, "=", id);
  }
  const rows = await query.execute();
  return rows.flatMap((row) =>
    isPageModule(row.module) ? [{ ...row, module: row.module }] : []
  );
}

/** The subject's grants in the company (`readCompanyGrants` for one subject). */
export async function readGrants(
  db: Kysely<KyselyDatabase> | KyselyTx,
  companyId: string,
  subject: GrantSubject
): Promise<(StoredGrant & { convertedFrom: string[] | null })[]> {
  const rows = await readCompanyGrants(db, companyId, subject);
  return rows.map(({ module, page, level, convertedFrom }) => ({
    module,
    page,
    level,
    convertedFrom
  }));
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
        grant.page ?? (moduleId(grant.module) as string),
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
  return withTransaction(db, write);
}

/**
 * Remove one grant of one subject in one company, so the subject inherits that
 * module or page again. The subject's other grants, and their `convertedFrom`,
 * stay as they are.
 */
export async function removeGrant(
  db: Kysely<KyselyDatabase> | KyselyTx,
  {
    companyId,
    subject,
    module,
    page
  }: {
    companyId: string;
    subject: GrantSubject;
    module: ModuleEnum;
    page: string | null;
  }
) {
  const [column, id] = subjectColumn(subject);
  let query = db
    .deleteFrom("permission")
    .where("companyId", "=", companyId)
    .where(column, "=", id)
    .where("module", "=", module);
  query =
    page === null
      ? query.where("page", "is", null)
      : query.where("page", "=", page);
  await query.execute();
}
