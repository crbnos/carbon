// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { apiKeyCacheKey } from "./api-key.server";
import {
  deactivateEmployee,
  deactivateUser,
  deleteUserApiKeys
} from "./users.server";

// Import-safety: the module builds a Supabase client at import.
vi.hoisted(() => {
  vi.stubEnv("SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
});

afterAll(() => vi.unstubAllEnvs());

// Redis as an in-memory map.
const kv = vi.hoisted(() => new Map<string, string>());
vi.mock("@carbon/kv", () => ({
  redis: {
    get: async (key: string) => kv.get(key) ?? null,
    set: async (key: string, value: string) => {
      kv.set(key, value);
      return "OK";
    },
    del: async (key: string) => Number(kv.delete(key))
  }
}));

const USER = "usr_1";
const COMPANY = "cmp_1";
const OTHER_COMPANY = "cmp_2";

type Op = { table: string; op: string; payload?: unknown };

let ops: Op[];

/**
 * Minimal stand-in for the Supabase client: every builder method returns the
 * same object so calls chain, and the object is awaitable so `Promise.all` over
 * a list of builders resolves. Each terminal verb is recorded so a test can
 * assert on which tables were written and how.
 */
function makeClient(reads: Record<string, unknown>) {
  const builder = (table: string) => {
    const record = (op: string, payload?: unknown) => {
      ops.push({ table, op, payload });
      return chain;
    };

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      update: (payload: unknown) => record("update", payload),
      delete: () => record("delete"),
      insert: (payload: unknown) => record("insert", payload),
      upsert: (payload: unknown) => record("upsert", payload),
      maybeSingle: () => Promise.resolve(reads[table] ?? { data: null }),
      single: () => Promise.resolve(reads[table] ?? { data: null }),
      then: (resolve: (value: unknown) => unknown) =>
        resolve(reads[table] ?? { data: null, error: null })
    };

    return chain;
  };

  return { from: (table: string) => builder(table) };
}

beforeEach(() => {
  ops = [];
  kv.clear();
});

describe("deactivateEmployee", () => {
  const client = () =>
    makeClient({
      userPermission: {
        data: { permissions: { parts_view: [COMPANY, OTHER_COMPANY] } },
        error: null
      },
      group: { data: [{ id: "grp_1" }], error: null }
    }) as any;

  it("keeps the employeeJob row so org placement survives", async () => {
    await deactivateEmployee(client(), USER, COMPANY);

    // Deleting employeeJob made deactivation lossy: title, start date, department, shift, manager, location, tags and custom
    // fields cannot be reconstructed when the person is re-invited.
    expect(ops.filter((o) => o.table === "employeeJob")).toEqual([]);
  });

  it("still removes everything that grants access", async () => {
    const result = await deactivateEmployee(client(), USER, COMPANY);

    expect(ops).toContainEqual(
      expect.objectContaining({ table: "userToCompany", op: "delete" })
    );
    expect(ops).toContainEqual(
      expect.objectContaining({
        table: "employee",
        op: "update",
        payload: { active: false }
      })
    );
    expect(ops).toContainEqual(
      expect.objectContaining({ table: "membership", op: "delete" })
    );
    expect(result.success).toBe(true);
  });

  it("invalidates the cached claims itself, for callers that skip deactivateUser", async () => {
    kv.set(`permissions:${USER}`, "{}");

    await deactivateEmployee(client(), USER, COMPANY);

    // requirePermissions reads this cache (1h TTL) before the database, and the
    // create*Account rollbacks call this function directly rather than through
    // deactivateUser — so the invalidation has to live here.
    expect(kv.has(`permissions:${USER}`)).toBe(false);
  });

  it("strips only the deactivating company from the permission map", async () => {
    await deactivateEmployee(client(), USER, COMPANY);

    const update = ops.find(
      (o) => o.table === "userPermission" && o.op === "update"
    );
    expect(update?.payload).toEqual({
      permissions: { parts_view: [OTHER_COMPANY] }
    });
  });
});

describe("deleteUserApiKeys", () => {
  const keys = [
    { id: "key_1", keyHash: "hash_1" },
    { id: "key_2", keyHash: "hash_2" }
  ];

  it("deletes the person's keys and drops their cached lookups, so they stop at once", async () => {
    kv.set(apiKeyCacheKey("hash_1"), "{}");
    kv.set(apiKeyCacheKey("hash_2"), "{}");
    const client = makeClient({ apiKey: { data: keys, error: null } }) as any;

    const result = await deleteUserApiKeys(client, USER, COMPANY);

    expect(result.success).toBe(true);
    expect(ops).toEqual([{ table: "apiKey", op: "delete" }]);
    expect(kv.size).toBe(0);
  });

  it("deletes nothing when the keys cannot be read", async () => {
    const client = makeClient({
      apiKey: { data: null, error: { message: "boom" } }
    }) as any;

    const result = await deleteUserApiKeys(client, USER, COMPANY);

    expect(result.success).toBe(false);
    expect(ops).toEqual([]);
  });
});

describe("deactivateUser", () => {
  it("removes the API keys before the membership, so a failed cleanup changes nothing and can be retried", async () => {
    // After the membership is gone a retry takes the "already deactivated"
    // branch and never reaches the keys, which would keep working.
    const client = makeClient({
      apiKey: { data: null, error: { message: "boom" } },
      userToCompany: { data: { role: "employee" }, error: null }
    }) as any;

    const result = await deactivateUser(client, USER, COMPANY);

    expect(result.success).toBe(false);
    expect(ops).toEqual([]);
  });
});
