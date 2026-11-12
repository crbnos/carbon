// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import * as seedData from "@carbon/database/seed-data";
import { type Kysely, sql } from "kysely";

// `@carbon/database` has no `"type": "module"`, so tsx (the backup scripts)
// loads it as CommonJS and its exports arrive on `default`; a bundler (the
// jobs) gives the module itself.
const { groups: companyGroups, getGroupId } =
  (seedData as { default?: typeof seedData }).default ?? seedData;

/**
 * Loading a backup's `group` rows: a derived group's id is its row's id, so
 * with triggers on (no replica mode) the interceptor has already made it when
 * the customer, supplier or type was inserted. Keep that one.
 */
export function groupConflictClause(table: string) {
  return table === "group" ? sql` ON CONFLICT ("id") DO NOTHING` : sql``;
}

/**
 * Puts back the groups and memberships the database derives from a company's
 * rows (`sync_create_*_group`, `sync_add_*_to_group`), which a load with
 * triggers off never creates: the company-wide groups (`groups` in
 * `@carbon/database/seed-data`), a group per employee type, customer type,
 * supplier type, customer and supplier, and their members. Without them adding
 * an employee to a kept employee type failed on `membership_groupId_fkey`.
 *
 * A derived group whose row isn't here is removed first, with its memberships:
 * cascades don't run in replica mode. `wipedGroupIds` are the company's groups
 * before the wipe; a membership still pointing at one that is gone is removed
 * last, since `membership` survives an own restore. Idempotent.
 */
export async function rebuildDerivedGroups(
  trx: Kysely<KyselyDatabase>,
  companyId: string,
  wipedGroupIds: string[] = []
): Promise<void> {
  const wide = companyGroups.map((g) => ({
    ...g,
    id: getGroupId(g.idPrefix, companyId)
  }));
  const allOf = (
    flag: "isEmployeeTypeGroup" | "isCustomerTypeGroup" | "isSupplierTypeGroup"
  ) => wide.find((g) => g[flag])!.id;
  const allEmployees = allOf("isEmployeeTypeGroup");
  const allCustomers = allOf("isCustomerTypeGroup");
  const allSuppliers = allOf("isSupplierTypeGroup");

  await sql`
    WITH stale AS (
      SELECT g.id FROM "group" g
      WHERE g."companyId" = ${companyId}
        AND (
          (g."isEmployeeTypeGroup" AND g.id <> ${allEmployees}
            AND NOT EXISTS (SELECT 1 FROM "employeeType" t WHERE t.id = g.id))
          OR (g."isCustomerTypeGroup" AND g.id <> ${allCustomers}
            AND NOT EXISTS (SELECT 1 FROM "customerType" t WHERE t.id = g.id))
          OR (g."isSupplierTypeGroup" AND g.id <> ${allSuppliers}
            AND NOT EXISTS (SELECT 1 FROM "supplierType" t WHERE t.id = g.id))
          OR (g."isCustomerOrgGroup"
            AND NOT EXISTS (SELECT 1 FROM "customer" t WHERE t.id = g.id))
          OR (g."isSupplierOrgGroup"
            AND NOT EXISTS (SELECT 1 FROM "supplier" t WHERE t.id = g.id))
        )
    ),
    memberships AS (
      DELETE FROM "membership" m USING stale s
      WHERE m."groupId" = s.id OR m."memberGroupId" = s.id
    )
    DELETE FROM "group" g USING stale s WHERE g.id = s.id
  `.execute(trx);

  await sql`
    INSERT INTO "group" ("id", "name", "isEmployeeTypeGroup", "isCustomerTypeGroup", "isSupplierTypeGroup", "isCustomerOrgGroup", "isSupplierOrgGroup", "companyId")
    SELECT id, name, e, ct, st, FALSE, FALSE, ${companyId} FROM (
      VALUES ${sql.join(
        wide.map(
          (g) =>
            sql`(${g.id}::text, ${g.name}::text, ${g.isEmployeeTypeGroup}::boolean, ${g.isCustomerTypeGroup}::boolean, ${g.isSupplierTypeGroup}::boolean)`
        )
      )}
    ) AS v(id, name, e, ct, st)
    UNION ALL SELECT id, name, TRUE, FALSE, FALSE, FALSE, FALSE, "companyId" FROM "employeeType" WHERE "companyId" = ${companyId}
    UNION ALL SELECT id, name, FALSE, TRUE, FALSE, FALSE, FALSE, "companyId" FROM "customerType" WHERE "companyId" = ${companyId}
    UNION ALL SELECT id, name, FALSE, FALSE, TRUE, FALSE, FALSE, "companyId" FROM "supplierType" WHERE "companyId" = ${companyId}
    UNION ALL SELECT id, name, FALSE, FALSE, FALSE, TRUE, FALSE, "companyId" FROM "customer" WHERE "companyId" = ${companyId}
    UNION ALL SELECT id, name, FALSE, FALSE, FALSE, FALSE, TRUE, "companyId" FROM "supplier" WHERE "companyId" = ${companyId}
    ON CONFLICT ("id") DO NOTHING
  `.execute(trx);

  await sql`
    INSERT INTO "membership" ("groupId", "memberGroupId")
    SELECT x.parent, x.child FROM (
      SELECT ${allEmployees} AS parent, id AS child FROM "employeeType" WHERE "companyId" = ${companyId}
      UNION ALL SELECT ${allCustomers}, id FROM "customerType" WHERE "companyId" = ${companyId}
      UNION ALL SELECT ${allSuppliers}, id FROM "supplierType" WHERE "companyId" = ${companyId}
      UNION ALL SELECT "customerTypeId", id FROM "customer" WHERE "companyId" = ${companyId} AND "customerTypeId" IS NOT NULL
      UNION ALL SELECT "supplierTypeId", id FROM "supplier" WHERE "companyId" = ${companyId} AND "supplierTypeId" IS NOT NULL
    ) x
    WHERE NOT EXISTS (
      SELECT 1 FROM "membership" m
      WHERE m."groupId" = x.parent AND m."memberGroupId" = x.child
    )
  `.execute(trx);

  await sql`
    INSERT INTO "membership" ("groupId", "memberUserId")
    SELECT "employeeTypeId", id FROM "employee" WHERE "companyId" = ${companyId} AND "employeeTypeId" IS NOT NULL
    UNION ALL SELECT "customerId", id FROM "customerAccount" WHERE "companyId" = ${companyId}
    UNION ALL SELECT "supplierId", id FROM "supplierAccount" WHERE "companyId" = ${companyId}
    ON CONFLICT ("groupId", "memberUserId") DO NOTHING
  `.execute(trx);

  if (wipedGroupIds.length > 0) {
    await sql`
      DELETE FROM "membership" m
      WHERE (m."groupId" = ANY(${wipedGroupIds}::text[])
          AND NOT EXISTS (SELECT 1 FROM "group" g WHERE g.id = m."groupId"))
        OR (m."memberGroupId" = ANY(${wipedGroupIds}::text[])
          AND NOT EXISTS (SELECT 1 FROM "group" g WHERE g.id = m."memberGroupId"))
    `.execute(trx);
  }
}
