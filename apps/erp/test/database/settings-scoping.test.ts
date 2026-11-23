// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. The settings operations read and write
// through the service role here, so their own company filters are the only
// thing that keeps another company's rows out.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectLocalTestDatabase,
  hasLocalDatabase
} from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";
import {
  createSubsidiary,
  updatePlanningSettings,
  updateProductionSettings
} from "../../app/modules/settings/settings.server";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

const prefix = `settest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const ids = {
  user: `${prefix}-user`,
  ours: `${prefix}-ours`,
  ourGroup: `${prefix}-our-group`,
  theirs: `${prefix}-theirs`,
  theirGroup: `${prefix}-their-group`,
  theirLocation: `${prefix}-their-location`,
  theirEmployeeType: `${prefix}-their-type`
};

type Db = Awaited<ReturnType<typeof connectLocalTestDatabase>>;
let db: Db;

// A Carbon user who manages settings in our company only, and is an active
// employee of the other company only.
const ctx = () =>
  createServiceContext({
    actor: {
      type: "user",
      userId: ids.user,
      permissions: {
        settings: {
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
      throw new Error("No operation here reads the cache");
    }
  });

const theirLocation = () =>
  db
    .selectFrom("location")
    .select(["requiresStaffing", "responsibleEmployee"])
    .where("id", "=", ids.theirLocation)
    .executeTakeFirstOrThrow();

beforeAll(async () => {
  if (!client) return;
  db = await connectLocalTestDatabase();
  await db.transaction().execute(async (trx) => {
    // No triggers: the employee type would want the groups a seed makes.
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx
      .insertInto("user")
      .values({
        id: ids.user,
        email: `${prefix}@carbon.ms`,
        firstName: "Settings",
        lastName: "Test"
      })
      .execute();
    await trx
      .insertInto("companyGroup")
      .values([
        { id: ids.ourGroup, name: prefix, createdBy: ids.user },
        { id: ids.theirGroup, name: prefix, createdBy: ids.user }
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
      .insertInto("location")
      .values({
        id: ids.theirLocation,
        name: "Their plant",
        addressLine1: "1 Test Way",
        city: "Testville",
        postalCode: "00000",
        timezone: "America/New_York",
        companyId: ids.theirs,
        createdBy: ids.user
      })
      .execute();
    await trx
      .insertInto("employeeType")
      .values({
        id: ids.theirEmployeeType,
        name: prefix,
        companyId: ids.theirs
      })
      .execute();
    await trx
      .insertInto("employee")
      .values({
        id: ids.user,
        companyId: ids.theirs,
        employeeTypeId: ids.theirEmployeeType,
        active: true
      })
      .execute();
  });
});

afterAll(async () => {
  if (!client) return;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    // A subsidiary exists only when its test failed.
    const subsidiaries = await trx
      .selectFrom("company")
      .select("id")
      .where("name", "=", `${prefix}-subsidiary`)
      .execute();
    for (const companyId of [
      ids.ours,
      ids.theirs,
      ...subsidiaries.map(({ id }) => id)
    ]) {
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
    await trx.deleteFrom("user").where("id", "=", ids.user).execute();
  });
  await db.destroy();
});

describeLocal("a settings operation", () => {
  it("refuses another company's location for staffing", async () => {
    const result = await updateProductionSettings(ctx(), {
      locationStaffing: {
        locationId: ids.theirLocation,
        requiresStaffing: true
      }
    });

    expect(result.error?.category).toBe("notFound");
    expect((await theirLocation()).requiresStaffing).toBe(false);
  });

  it("refuses an employee of another company as a responsible employee", async () => {
    const result = await updatePlanningSettings(ctx(), {
      defaultResponsibleEmployee: ids.user
    });

    expect(result.error).toMatchObject({
      category: "rule",
      message: "Choose an employee of this company"
    });
  });

  it("refuses another company's location for its owner", async () => {
    const result = await updatePlanningSettings(ctx(), {
      locationResponsibleEmployee: {
        locationId: ids.theirLocation,
        responsibleEmployee: null
      }
    });

    expect(result.error).toMatchObject({
      category: "forbidden",
      message: "You do not have permission to change this location"
    });
  });

  it("refuses a parent company from another company group", async () => {
    const result = await createSubsidiary(ctx(), {
      name: `${prefix}-subsidiary`,
      addressLine1: "1 Main St",
      city: "Springfield",
      postalCode: "12345",
      countryCode: "US",
      baseCurrencyCode: "USD",
      timezone: "America/New_York",
      parentCompanyId: ids.theirs
    });

    expect(result.error).toMatchObject({
      category: "notFound",
      message: "Parent company not found"
    });
  });
});
