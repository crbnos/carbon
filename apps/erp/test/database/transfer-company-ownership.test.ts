// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. `companyGroup` has no update policy, so the
// transfer writes as the system: its own owner check is all that stops anyone
// else holding Billing at Edit from taking the company.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectLocalTestDatabase,
  hasLocalDatabase
} from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";
import { transferCompanyOwnership } from "../../app/modules/settings/settings.server";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

const prefix = `owntest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const ids = {
  owner: `${prefix}-owner`,
  admin: `${prefix}-admin`,
  next: `${prefix}-next`,
  outsider: `${prefix}-outsider`,
  ours: `${prefix}-ours`,
  ourGroup: `${prefix}-our-group`,
  theirs: `${prefix}-theirs`,
  theirGroup: `${prefix}-their-group`,
  ourType: `${prefix}-our-type`,
  theirType: `${prefix}-their-type`
};

type Db = Awaited<ReturnType<typeof connectLocalTestDatabase>>;
let db: Db;

// Every caller holds Billing at Edit in our company: only ownership differs.
const as = (userId: string) =>
  createServiceContext({
    actor: {
      type: "user",
      role: "employee",
      userId,
      permissions: {
        "settings.billing": {
          view: [ids.ours],
          create: [ids.ours],
          update: [ids.ours],
          delete: [ids.ours]
        }
      }
    },
    company: { id: ids.ours, groupId: ids.ourGroup },
    caller: client!,
    system: () => client!,
    pg: () => db,
    kv: () => {
      throw new Error("The transfer reads no cache");
    }
  });

const ownerOfOurGroup = async () =>
  (
    await db
      .selectFrom("companyGroup")
      .select("ownerId")
      .where("id", "=", ids.ourGroup)
      .executeTakeFirstOrThrow()
  ).ownerId;

beforeAll(async () => {
  if (!client) return;
  db = await connectLocalTestDatabase();
  await db.transaction().execute(async (trx) => {
    // No triggers: the employee type would want the groups a seed makes.
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx
      .insertInto("user")
      .values(
        [ids.owner, ids.admin, ids.next, ids.outsider].map((id) => ({
          id,
          email: `${id}@carbon.ms`,
          firstName: "Owner",
          lastName: "Test"
        }))
      )
      .execute();
    await trx
      .insertInto("companyGroup")
      .values([
        {
          id: ids.ourGroup,
          name: prefix,
          createdBy: ids.owner,
          ownerId: ids.owner
        },
        {
          id: ids.theirGroup,
          name: prefix,
          createdBy: ids.outsider,
          ownerId: ids.outsider
        }
      ])
      .execute();
    await trx
      .insertInto("company")
      .values(
        [
          [ids.ours, ids.ourGroup],
          [ids.theirs, ids.theirGroup]
        ].map(([id, companyGroupId]) => ({
          id: id!,
          name: id!,
          companyGroupId,
          baseCurrencyCode: "USD",
          timezone: "America/New_York"
        }))
      )
      .execute();
    await trx
      .insertInto("employeeType")
      .values([
        { id: ids.ourType, name: prefix, companyId: ids.ours },
        { id: ids.theirType, name: prefix, companyId: ids.theirs }
      ])
      .execute();
    const members: [string, string, string][] = [
      [ids.owner, ids.ours, ids.ourType],
      [ids.admin, ids.ours, ids.ourType],
      [ids.next, ids.ours, ids.ourType],
      [ids.outsider, ids.theirs, ids.theirType]
    ];
    await trx
      .insertInto("employee")
      .values(
        members.map(([id, companyId, employeeTypeId]) => ({
          id,
          companyId,
          employeeTypeId,
          active: true
        }))
      )
      .execute();
    await trx
      .insertInto("userToCompany")
      .values(
        members.map(([userId, companyId]) => ({
          userId,
          companyId,
          role: "employee" as const
        }))
      )
      .execute();
  });
});

afterAll(async () => {
  if (!client) return;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    for (const companyId of [ids.ours, ids.theirs]) {
      await trx.deleteFrom("company").where("id", "=", companyId).execute();
      await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
        trx
      );
      await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
        trx
      );
    }
    await trx
      .deleteFrom("companyGroup")
      .where("id", "in", [ids.ourGroup, ids.theirGroup])
      .execute();
    await trx
      .deleteFrom("user")
      .where("id", "in", [ids.owner, ids.admin, ids.next, ids.outsider])
      .execute();
  });
  await db.destroy();
});

describeLocal("transferCompanyOwnership", () => {
  it("refuses a caller who holds Billing at Edit but is not the owner", async () => {
    const result = await transferCompanyOwnership(as(ids.admin), {
      newOwnerId: ids.admin
    });

    expect(result.error?.category).toBe("forbidden");
    expect(await ownerOfOurGroup()).toBe(ids.owner);
  });

  it("refuses a new owner who is not an employee in the group", async () => {
    const result = await transferCompanyOwnership(as(ids.owner), {
      newOwnerId: ids.outsider
    });

    expect(result.error?.category).toBe("validation");
    expect(await ownerOfOurGroup()).toBe(ids.owner);
  });

  it("hands the owner's group to an employee of it", async () => {
    const result = await transferCompanyOwnership(as(ids.owner), {
      newOwnerId: ids.next
    });

    expect(result.error).toBeNull();
    expect(await ownerOfOurGroup()).toBe(ids.next);
    const theirs = await db
      .selectFrom("companyGroup")
      .select("ownerId")
      .where("id", "=", ids.theirGroup)
      .executeTakeFirstOrThrow();
    expect(theirs.ownerId).toBe(ids.outsider);
  });

  it("refuses the former owner afterwards", async () => {
    const result = await transferCompanyOwnership(as(ids.owner), {
      newOwnerId: ids.owner
    });

    expect(result.error?.category).toBe("forbidden");
    expect(await ownerOfOurGroup()).toBe(ids.next);
  });
});
