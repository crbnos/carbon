// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectLocalTestDatabase,
  hasLocalDatabase
} from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";
import {
  updateSavedViewOrder,
  upsertSavedView
} from "../../app/modules/shared/shared.server";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

const prefix = `viewtest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const ids = {
  company: `${prefix}-company`,
  group: `${prefix}-group`,
  owner: `${prefix}-owner`,
  other: `${prefix}-other`,
  first: `${prefix}-first`,
  second: `${prefix}-second`,
  othersView: `${prefix}-others-view`
};

type Db = Awaited<ReturnType<typeof connectLocalTestDatabase>>;
let db: Db;

const as = (userId: string) =>
  createServiceContext({
    // A member of the company: saved views need no module permission.
    actor: {
      type: "user",
      userId,
      permissions: {
        parts: { view: [ids.company], create: [], update: [], delete: [] }
      }
    },
    company: { id: ids.company, groupId: ids.group },
    caller: client!,
    system: () => client!,
    pg: () => db,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });

const views = () =>
  db
    .selectFrom("tableView")
    .select(["id", "sortOrder", "createdBy", "updatedBy"])
    .where("companyId", "=", ids.company)
    .orderBy("id")
    .execute();

beforeAll(async () => {
  if (!client) return;
  db = await connectLocalTestDatabase();
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx
      .insertInto("user")
      .values(
        [ids.owner, ids.other].map((id) => ({
          id,
          email: `${id}@example.com`,
          firstName: "View",
          lastName: "Test"
        }))
      )
      .execute();
    await trx
      .insertInto("companyGroup")
      .values({ id: ids.group, name: prefix, createdBy: ids.owner })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: ids.company,
        name: prefix,
        companyGroupId: ids.group,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    await trx
      .insertInto("tableView")
      .values(
        [
          [ids.first, ids.owner, 1],
          [ids.second, ids.owner, 2],
          [ids.othersView, ids.other, 3]
        ].map(([id, createdBy, sortOrder]) => ({
          id: id as string,
          name: id as string,
          table: "part",
          type: "Private" as const,
          companyId: ids.company,
          createdBy: createdBy as string,
          sortOrder: sortOrder as number
        }))
      )
      .execute();
  });
});

afterAll(async () => {
  if (!client) return;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx.deleteFrom("tableView").where("companyId", "=", ids.company).execute();
    await trx.deleteFrom("company").where("id", "=", ids.company).execute();
    await trx.deleteFrom("companyGroup").where("id", "=", ids.group).execute();
    await trx
      .deleteFrom("user")
      .where("id", "in", [ids.owner, ids.other])
      .execute();
  });
  await db.destroy();
});

describeLocal("a saved view", () => {
  it("keeps its creator when someone else's call updates it", async () => {
    const result = await upsertSavedView(as(ids.other), {
      id: ids.first,
      name: "Renamed",
      table: "part",
      type: "Private"
    });

    expect(result.error).toBeNull();
    const first = (await views()).find((view) => view.id === ids.first);
    expect(first).toMatchObject({ createdBy: ids.owner, updatedBy: ids.other });
  });

  it("is reordered with the caller's other views in one go", async () => {
    const result = await updateSavedViewOrder(as(ids.owner), {
      updates: [
        { id: ids.first, sortOrder: 2 },
        { id: ids.second, sortOrder: 1 }
      ]
    });

    expect(result.error).toBeNull();
    expect(await views()).toEqual([
      expect.objectContaining({ id: ids.first, sortOrder: 2, updatedBy: ids.owner }),
      expect.objectContaining({ id: ids.othersView, sortOrder: 3 }),
      expect.objectContaining({ id: ids.second, sortOrder: 1, updatedBy: ids.owner })
    ]);
  });

  it("is not reordered when the reorder names another user's view", async () => {
    const before = await views();

    const result = await updateSavedViewOrder(as(ids.owner), {
      updates: [
        { id: ids.first, sortOrder: 9 },
        { id: ids.othersView, sortOrder: 8 }
      ]
    });

    expect(result.error?.category).toBe("notFound");
    expect(await views()).toEqual(before);
  });
});
