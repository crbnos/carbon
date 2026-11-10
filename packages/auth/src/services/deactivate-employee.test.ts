// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPermissionCacheKey } from "./users";
import { deactivateEmployee } from "./users.server";

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

// The audit log, captured at the logger.
const audit = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@carbon/logger", () => {
  const log = {
    info: (_message: string, fields: unknown) => audit.calls.push(fields),
    warn: () => {},
    error: () => {},
    debug: () => {}
  };
  return { getLogger: () => log };
});

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
  audit.calls = [];
});

describe("deactivateEmployee", () => {
  const client = () =>
    makeClient({
      userPermission: {
        data: { permissions: { parts_view: [COMPANY, OTHER_COMPANY] } },
        error: null
      },
      group: { data: [{ id: "grp_1" }], error: null },
      permission: {
        data: [
          { module: "Inventory", page: null, level: "Edit" },
          { module: "Sales", page: "sales.quotes", level: "None" }
        ],
        error: null
      }
    }) as any;

  it("records the person's grants it deletes in the audit event", async () => {
    await deactivateEmployee(client(), USER, COMPANY, "usr_admin");

    const grants = [
      { module: "Inventory", page: null, level: "Edit" },
      { module: "Sales", page: "sales.quotes", level: "None" }
    ];
    expect(audit.calls).toContainEqual(
      expect.objectContaining({
        authEvent: "role_changed",
        actor: "usr_admin",
        targetUserId: USER,
        reason: "deactivate",
        before: grants,
        after: [],
        revoked: grants
      })
    );
  });

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
    expect(ops).toContainEqual(
      expect.objectContaining({ table: "permission", op: "delete" })
    );
    expect(result.success).toBe(true);
  });

  it("invalidates the cached claims itself, for callers that skip deactivateUser", async () => {
    kv.set(getPermissionCacheKey(USER), "{}");

    await deactivateEmployee(client(), USER, COMPANY);

    // requirePermissions reads this cache (1h TTL) before the database, and the
    // create*Account rollbacks call this function directly rather than through
    // deactivateUser — so the invalidation has to live here.
    expect(kv.has(getPermissionCacheKey(USER))).toBe(false);
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
