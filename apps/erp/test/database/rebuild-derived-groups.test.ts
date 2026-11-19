// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The groups and memberships a restore loads with triggers off and must put
// back itself. Runs against the local database (SUPABASE_DB_URL); skipped
// without one. Everything happens in one transaction that is rolled back.

import { rebuildDerivedGroups } from "@carbon/jobs/backups";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";

const ROLLBACK = "rolled back on purpose";

databaseTest("puts back a company's derived groups and nothing else", async () => {
  const db = await connectLocalTestDatabase();
  const co = `ddgrp${crypto.randomUUID().replaceAll("-", "").slice(0, 15)}`;
  const id = (name: string) => `${co}-${name}`;
  // "All Employees" etc. are keyed on the company id's characters.
  const wide = (prefix: string) =>
    `${prefix}-${co.slice(0, 4)}-${co.slice(4, 8)}-${co.slice(8, 20)}`;

  await db
    .transaction()
    .execute(async (trx) => {
      await sql`SET LOCAL session_replication_role = 'replica'`.execute(trx);
      for (const statement of [
        sql`INSERT INTO "companyGroup" (id, name) VALUES (${id("grp")}, ${co})`,
        sql`INSERT INTO "company" (id, name, "baseCurrencyCode", "companyGroupId") VALUES (${co}, ${co}, 'USD', ${id("grp")})`,
        sql`INSERT INTO "employeeType" (id, name, "companyId") VALUES (${id("et")}, 'Admin', ${co})`,
        sql`INSERT INTO "customerType" (id, name, "companyId", "createdBy") VALUES (${id("ct")}, 'Retail', ${co}, 'system')`,
        sql`INSERT INTO "supplierType" (id, name, "companyId", "createdBy") VALUES (${id("st")}, 'Metal', ${co}, 'system')`,
        sql`INSERT INTO "customer" (id, name, "companyId", "customerTypeId") VALUES (${id("cu")}, 'Acme', ${co}, ${id("ct")})`,
        sql`INSERT INTO "supplier" (id, name, "companyId", "supplierTypeId") VALUES (${id("su")}, 'Steel Co', ${co}, ${id("st")})`,
        sql`INSERT INTO "employee" (id, "companyId", "employeeTypeId") VALUES ('system', ${co}, ${id("et")})`,
        // What a restore leaves: a derived group whose customer is gone, with a
        // membership, and a membership into a group the wipe removed.
        sql`INSERT INTO "group" (id, name, "isCustomerOrgGroup", "companyId") VALUES (${id("stale")}, 'Gone Inc', TRUE, ${co})`,
        sql`INSERT INTO "membership" ("groupId", "memberGroupId") VALUES (${id("ct")}, ${id("stale")})`,
        sql`INSERT INTO "membership" ("groupId", "memberUserId") VALUES (${id("wiped")}, 'system')`,
        // Not one of the wiped groups: not this rebuild's to touch.
        sql`INSERT INTO "membership" ("groupId", "memberUserId") VALUES (${id("other")}, 'system')`
      ]) {
        await statement.execute(trx);
      }

      const groups = () =>
        sql<{
          id: string;
          name: string;
          flags: string;
        }>`SELECT id, name, concat_ws(',',
              CASE WHEN "isEmployeeTypeGroup" THEN 'employeeType' END,
              CASE WHEN "isCustomerTypeGroup" THEN 'customerType' END,
              CASE WHEN "isSupplierTypeGroup" THEN 'supplierType' END,
              CASE WHEN "isCustomerOrgGroup" THEN 'customer' END,
              CASE WHEN "isSupplierOrgGroup" THEN 'supplier' END) AS flags
            FROM "group" WHERE "companyId" = ${co}`
          .execute(trx)
          .then((r) => r.rows.sort((a, b) => a.id.localeCompare(b.id)));
      const ids = [
        ...["00000000-0000", "11111111-1111", "22222222-2222"].map(wide),
        ...["et", "ct", "st", "cu", "su", "stale", "wiped", "other"].map(id)
      ];
      const memberships = () =>
        sql<{ link: string }>`
          SELECT m."groupId" || ' <- ' || coalesce(m."memberGroupId", m."memberUserId") AS link
          FROM "membership" m
          WHERE m."groupId" = ANY(${ids}::text[]) OR m."memberGroupId" = ANY(${ids}::text[])`
          .execute(trx)
          .then((r) => r.rows.map((x) => x.link).sort());

      await rebuildDerivedGroups(trx, co, [id("wiped")]);

      const expectedGroups = [
        { id: wide("00000000-0000"), name: "All Employees", flags: "employeeType" },
        { id: wide("11111111-1111"), name: "All Customers", flags: "customerType" },
        { id: wide("22222222-2222"), name: "All Suppliers", flags: "supplierType" },
        { id: id("ct"), name: "Retail", flags: "customerType" },
        { id: id("cu"), name: "Acme", flags: "customer" },
        { id: id("et"), name: "Admin", flags: "employeeType" },
        { id: id("st"), name: "Metal", flags: "supplierType" },
        { id: id("su"), name: "Steel Co", flags: "supplier" }
      ].sort((a, b) => a.id.localeCompare(b.id));
      const expectedMemberships = [
        `${wide("00000000-0000")} <- ${id("et")}`,
        `${wide("11111111-1111")} <- ${id("ct")}`,
        `${wide("22222222-2222")} <- ${id("st")}`,
        `${id("ct")} <- ${id("cu")}`,
        `${id("other")} <- system`,
        `${id("et")} <- system`,
        `${id("st")} <- ${id("su")}`
      ].sort();

      expect(await groups()).toEqual(expectedGroups);
      expect(await memberships()).toEqual(expectedMemberships);

      // A second run changes nothing.
      await rebuildDerivedGroups(trx, co, [id("wiped")]);
      expect(await groups()).toEqual(expectedGroups);
      expect(await memberships()).toEqual(expectedMemberships);

      throw new Error(ROLLBACK);
    })
    .catch((error: Error) => {
      if (error.message !== ROLLBACK) throw error;
    })
    .finally(() => db.destroy());
});
