// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Runs against the local stack (SUPABASE_DB_URL, and Redis for the cache
// case); skipped without one. The one grant write (`writeAccessGrants`) and
// the API key operations that reach it: what it refuses, and what a save
// clears. The plan check is the one stubbed boundary.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { pagesOf } from "@carbon/database/access";
import type { KyselyTx } from "@carbon/database/client";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest,
  hasLocalDatabase
} from "../fixtures/local-database";

vi.mock("@carbon/ee/plan.server", () => ({
  companyHasFeature: vi.fn(async () => true)
}));
// The unit-test config stubs Redis; the cache case needs the local one.
const redisUrl = await vi.hoisted(async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  for (const file of [".env.local", "../../.env.local"]) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(/^REDIS_URL=(.+)$/m);
    if (match?.[1]) return match[1].trim();
  }
  return null;
});
vi.mock("@carbon/env", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(redisUrl ? { REDIS_URL: redisUrl } : {})
}));

const { writeAccessGrants } = await import("@carbon/ee/permissions.server");
const { companyHasFeature } = await import("@carbon/ee/plan.server");
const { createApiKey } = await import(
  "../../../app/modules/settings/settings.server"
);
const { getPermissionCacheKey } = await import("@carbon/auth/users.server");
const { redis } = await import("@carbon/kv");

const prefix = `grants-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const ids = {
  user: `${prefix}-user`,
  mover: `${prefix}-mover`,
  ours: `${prefix}-ours`,
  ourGroup: `${prefix}-our-group`,
  theirs: `${prefix}-theirs`,
  theirGroup: `${prefix}-their-group`,
  ourType: `${prefix}-our-type`,
  otherType: `${prefix}-other-type`,
  theirType: `${prefix}-their-type`,
  ourKey: `${prefix}-our-key`,
  theirKey: `${prefix}-their-key`
};

type Db = Awaited<ReturnType<typeof connectLocalTestDatabase>>;
let db: Db;

const all = (companyId: string) => ({
  view: [companyId],
  create: [companyId],
  update: [companyId],
  delete: [companyId]
});

/** A user of our company holding every Settings page at Full, and nothing else. */
const settingsEditor = () =>
  createServiceContext({
    actor: {
      type: "user",
      role: "employee",
      userId: ids.user,
      permissions: Object.fromEntries(
        pagesOf("settings").map((page) => [page, all(ids.ours)])
      )
    },
    company: { id: ids.ours, groupId: ids.ourGroup },
    // The plan check is stubbed; nothing else reads these.
    caller: {} as never,
    system: () => ({}) as never,
    pg: () => db,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });

const keyGrants = (keyId: string) =>
  db
    .selectFrom("permission")
    .select(["module", "page", "level"])
    .where("apiKeyId", "=", keyId)
    .where("companyId", "=", ids.ours)
    .execute();

const keysNamed = (name: string) =>
  db
    .selectFrom("apiKey")
    .select("id")
    .where("companyId", "=", ids.ours)
    .where("name", "=", name)
    .execute();

beforeAll(async () => {
  if (!hasLocalDatabase) return;
  db = await connectLocalTestDatabase();
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx
      .insertInto("user")
      .values(
        [ids.user, ids.mover].map((id) => ({
          id,
          email: `${id}@carbon.ms`,
          firstName: "Grants",
          lastName: "Test"
        }))
      )
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
      .insertInto("employeeType")
      .values([
        { id: ids.ourType, name: prefix, companyId: ids.ours },
        { id: ids.otherType, name: `${prefix}-other`, companyId: ids.ours },
        { id: ids.theirType, name: prefix, companyId: ids.theirs }
      ])
      .execute();
    await trx
      .insertInto("employee")
      .values(
        [ids.user, ids.mover].map((id) => ({
          id,
          companyId: ids.ours,
          employeeTypeId: ids.ourType,
          active: true
        }))
      )
      .execute();
    await trx
      .insertInto("apiKey")
      .values(
        [
          [ids.ourKey, ids.ours],
          [ids.theirKey, ids.theirs]
        ].map(([id, companyId]) => ({
          id: id!,
          companyId: companyId!,
          name: id!,
          keyHash: id!,
          createdBy: ids.user
        }))
      )
      .execute();
  });
});

afterAll(async () => {
  if (!hasLocalDatabase) return;
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
      .where("id", "in", [ids.user, ids.mover])
      .execute();
  });
  await db.destroy();
});

describe("writeAccessGrants", () => {
  const write = (args: Partial<Parameters<typeof writeAccessGrants>[2]>) =>
    writeAccessGrants({} as never, db, {
      companyId: ids.ours,
      subject: { apiKeyId: ids.ourKey },
      change: { set: [] },
      actor: settingsEditor().actor,
      actorId: ids.user,
      ...args
    });

  databaseTest("refuses another company's key, role or person", async () => {
    for (const subject of [
      { apiKeyId: ids.theirKey },
      { employeeTypeId: ids.theirType },
      { userId: `${prefix}-nobody` }
    ]) {
      const { error } = await write({
        subject,
        change: { set: [{ module: "Sales", page: null, level: "View" }] }
      });
      expect(error?.code).toBe("notFound");
    }
    const theirs = await db
      .selectFrom("permission")
      .select("id")
      .where("companyId", "=", ids.ours)
      .where((eb) =>
        eb.or([
          eb("apiKeyId", "=", ids.theirKey),
          eb("employeeTypeId", "=", ids.theirType)
        ])
      )
      .execute();
    expect(theirs).toEqual([]);
  });

  databaseTest("refuses Workflows on a key", async () => {
    const { error } = await write({
      change: { set: [{ module: "Workflows", page: null, level: "View" }] }
    });
    expect(error?.code).toBe("validation");
    expect(await keyGrants(ids.ourKey)).toEqual([]);
  });

  databaseTest("refuses a key above its writer and keeps what it had", async () => {
    expect(
      (
        await write({
          change: { set: [{ module: "Sales", page: null, level: "View" }] },
          actor: { type: "system", onBehalfOf: ids.user }
        })
      ).error
    ).toBeNull();

    const { error } = await write({
      change: {
        set: [{ module: "Users", page: "users.accounts", level: "Full" }]
      }
    });
    expect(error?.code).toBe("forbidden");
    expect(await keyGrants(ids.ourKey)).toEqual([
      { module: "Sales", page: null, level: "View" }
    ]);
  });
});

describe("createApiKey", () => {
  databaseTest("refuses a key with more access than its creator, and creates none", async () => {
    const name = `${prefix}-users-full`;
    const result = await createApiKey(settingsEditor(), {
      name,
      grants: [{ module: "Users", page: "users.accounts", level: "Full" }]
    });
    expect(result.error?.category).toBe("forbidden");
    expect(await keysNamed(name)).toEqual([]);
  });

  databaseTest("creates a key within its creator's access", async () => {
    const name = `${prefix}-settings-full`;
    const result = await createApiKey(settingsEditor(), {
      name,
      grants: [{ module: "Settings", page: null, level: "Full" }]
    });
    expect(result.error).toBeNull();
    expect(await keysNamed(name)).toHaveLength(1);
  });
});

describe("a role save", () => {
  it.skipIf(!hasLocalDatabase || !redisUrl)(
    "clears the claims of every member of the role",
    async () => {
      const cached = getPermissionCacheKey(ids.user);
      await redis.set(cached, "{}");
      expect(await redis.get(cached)).toBe("{}");

      const { error } = await writeAccessGrants({} as never, db, {
        companyId: ids.ours,
        subject: { employeeTypeId: ids.ourType },
        change: { set: [{ module: "Sales", page: null, level: "View" }] },
        actorId: ids.user
      });
      expect(error).toBeNull();
      expect(await redis.get(cached)).toBeNull();
    },
    60_000
  );
});

// Converting a console operator: the user row and the type move commit or
// roll back together, and choosing a type needs no Permissions plan.
describe("a type move that keeps the grants", () => {
  const renameMover = (lastName: string) => (tx: KyselyTx) =>
    tx
      .updateTable("user")
      .set({ lastName })
      .where("id", "=", ids.mover)
      .execute();
  const move = (employeeType: string, lastName = "Moved") =>
    writeAccessGrants({} as never, db, {
      companyId: ids.ours,
      subject: { userId: ids.mover },
      change: { keep: true },
      employeeType,
      subjectRow: renameMover(lastName),
      actorId: ids.user
    });
  const mover = () =>
    db
      .selectFrom("employee")
      .innerJoin("user", "user.id", "employee.id")
      .select(["employee.employeeTypeId", "user.lastName"])
      .where("employee.id", "=", ids.mover)
      .where("employee.companyId", "=", ids.ours)
      .executeTakeFirstOrThrow();
  const moverGrants = () =>
    db
      .selectFrom("permission")
      .select(["module", "page", "level"])
      .where("userId", "=", ids.mover)
      .where("companyId", "=", ids.ours)
      .execute();

  databaseTest("moves the person and writes their row, keeping their own grants, without the Permissions plan", async () => {
    const own = await writeAccessGrants({} as never, db, {
      companyId: ids.ours,
      subject: { userId: ids.mover },
      change: { set: [{ module: "Sales", page: null, level: "View" }] },
      actorId: ids.user
    });
    expect(own.error).toBeNull();

    vi.mocked(companyHasFeature).mockResolvedValue(false);
    try {
      expect((await move(ids.otherType)).error).toBeNull();
    } finally {
      vi.mocked(companyHasFeature).mockResolvedValue(true);
    }
    expect(await mover()).toEqual({
      employeeTypeId: ids.otherType,
      lastName: "Moved"
    });
    expect(await moverGrants()).toEqual([
      { module: "Sales", page: null, level: "View" }
    ]);
  });

  databaseTest("refuses a move to another company's type and rolls the person's row back", async () => {
    const before = await mover();
    const { error } = await move(ids.theirType, "Never");
    expect(error?.code).toBe("notFound");
    expect(await mover()).toEqual(before);
  });

  databaseTest("refuses keeping the grants with no type to move to", async () => {
    for (const args of [
      { subject: { userId: ids.mover } },
      { subject: { employeeTypeId: ids.ourType }, employeeType: ids.otherType }
    ]) {
      const { error } = await writeAccessGrants({} as never, db, {
        companyId: ids.ours,
        change: { keep: true },
        actorId: ids.user,
        ...args
      });
      expect(error?.code).toBe("validation");
    }
  });

  it.skipIf(!hasLocalDatabase || !redisUrl)(
    "clears the person's claims after a move, and leaves them after a refused one",
    async () => {
      const cached = getPermissionCacheKey(ids.mover);
      await redis.set(cached, "{}");
      expect((await move(ids.theirType)).error?.code).toBe("notFound");
      expect(await redis.get(cached)).toBe("{}");

      expect((await move(ids.ourType)).error).toBeNull();
      expect(await redis.get(cached)).toBeNull();
    },
    60_000
  );
});
