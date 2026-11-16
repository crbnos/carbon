// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. The settings operations read and write
// through the service role here, so their own company filters are the only
// thing that keeps another company's rows out. A module's settings page
// writes rows Settings → Company owns, so a caller holding that one page
// saves them through the system handle, not through RLS.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest,
  hasLocalDatabase
} from "./fixtures/local-database";
import {
  localAnonClient,
  localServiceRoleClient
} from "./fixtures/local-supabase";
import { pageClaims } from "../page-claims";
import {
  createSubsidiary,
  updateInventorySettings,
  updatePlanningSettings,
  updateProductionSettings,
  updatePurchasingSettings,
  updateResourcesSettings
} from "../../app/modules/settings/settings.server";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
/** A caller RLS refuses everything: a write that lands came as the system. */
const anon = hasLocalDatabase ? localAnonClient() : null;

const prefix = `settest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const ids = {
  user: `${prefix}-user`,
  ours: `${prefix}-ours`,
  ourGroup: `${prefix}-our-group`,
  theirs: `${prefix}-theirs`,
  theirGroup: `${prefix}-their-group`,
  theirLocation: `${prefix}-their-location`,
  ourLocation: `${prefix}-our-location`,
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
      role: "employee",
      userId: ids.user,
      permissions: pageClaims({
        settings: {
          view: [ids.ours],
          create: [ids.ours],
          update: [ids.ours],
          delete: [ids.ours]
        }
      })
    },
    company: { id: ids.ours, groupId: ids.ourGroup },
    caller: client!,
    system: () => client!,
    pg: () => db,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });

/** A caller in our company holding every action on `page`, and nothing else. */
const pageOnly = (page: string) =>
  createServiceContext({
    actor: {
      type: "user",
      role: "employee",
      userId: ids.user,
      permissions: {
        [page]: {
          view: [ids.ours],
          create: [ids.ours],
          update: [ids.ours],
          delete: [ids.ours]
        }
      }
    },
    company: { id: ids.ours, groupId: ids.ourGroup },
    caller: anon!,
    system: () => client!,
    pg: () => db,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });

const locationOf = (id: string) =>
  db
    .selectFrom("location")
    .select(["requiresStaffing", "responsibleEmployee"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
const theirLocation = () => locationOf(ids.theirLocation);

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
      .values(
        [
          [ids.theirLocation, ids.theirs],
          [ids.ourLocation, ids.ours]
        ].map(([id, companyId]) => ({
          id: id!,
          name: id!,
          addressLine1: "1 Test Way",
          city: "Testville",
          postalCode: "00000",
          timezone: "America/New_York",
          // An owner, so a refused change of it shows.
          responsibleEmployee: ids.user,
          companyId: companyId!,
          createdBy: ids.user
        }))
      )
      .execute();
    await trx.insertInto("companySettings").values({ id: ids.ours }).execute();
    await trx
      .insertInto("companyAccountsPayableBillingAddress")
      .values({ id: ids.ours })
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

describe("a settings operation", () => {
  databaseTest("refuses another company's location for staffing", async () => {
    const result = await updateProductionSettings(ctx(), {
      locationStaffing: {
        locationId: ids.theirLocation,
        requiresStaffing: true
      }
    });

    expect(result.error?.category).toBe("notFound");
    expect((await theirLocation()).requiresStaffing).toBe(false);
  });

  databaseTest("refuses an employee of another company as a responsible employee", async () => {
    const result = await updatePlanningSettings(ctx(), {
      defaultResponsibleEmployee: ids.user
    });

    expect(result.error).toMatchObject({
      category: "rule",
      message: "Choose an employee of this company"
    });
  });

  databaseTest("refuses another company's location for its owner", async () => {
    const result = await updatePlanningSettings(ctx(), {
      locationResponsibleEmployee: {
        locationId: ids.theirLocation,
        responsibleEmployee: null
      }
    });

    // Written as the system, for this company's locations only.
    expect(result.error?.category).toBe("notFound");
    expect((await theirLocation()).responsibleEmployee).toBe(ids.user);
  });

  databaseTest("refuses a parent company from another company group", async () => {
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

describe("a caller with one settings page only", () => {
  databaseTest("saves Settings → Inventory", async () => {
    const result = await updateInventorySettings(
      pageOnly("settings.inventory"),
      { kanbanOutput: "label" }
    );

    expect(result.error).toBeNull();
    const row = await db
      .selectFrom("companySettings")
      .select("kanbanOutput")
      .where("id", "=", ids.ours)
      .executeTakeFirstOrThrow();
    expect(row.kanbanOutput).toBe("label");
  });

  databaseTest("saves the payables billing address", async () => {
    const result = await updatePurchasingSettings(
      pageOnly("settings.purchasing"),
      { accountsPayableBillingAddress: { name: "Acme" } }
    );

    expect(result.error).toBeNull();
    const row = await db
      .selectFrom("companyAccountsPayableBillingAddress")
      .select(["name", "updatedBy"])
      .where("id", "=", ids.ours)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ name: "Acme", updatedBy: ids.user });
  });

  databaseTest("moves the suggestion group on the company row", async () => {
    const result = await updateResourcesSettings(
      pageOnly("settings.resources"),
      { suggestionNotificationGroup: [ids.user] }
    );

    expect(result.error).toBeNull();
    const row = await db
      .selectFrom("company")
      .select("suggestionNotificationGroup")
      .where("id", "=", ids.ours)
      .executeTakeFirstOrThrow();
    expect(row.suggestionNotificationGroup).toEqual([ids.user]);
  });

  databaseTest("clears a location's planning owner", async () => {
    const result = await updatePlanningSettings(
      pageOnly("settings.planning"),
      {
        locationResponsibleEmployee: {
          locationId: ids.ourLocation,
          responsibleEmployee: null
        }
      }
    );

    expect(result.error).toBeNull();
    expect((await locationOf(ids.ourLocation)).responsibleEmployee).toBeNull();
  });
});
