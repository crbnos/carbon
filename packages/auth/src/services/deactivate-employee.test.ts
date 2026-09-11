import { beforeEach, describe, expect, it, vi } from "vitest";

// Same simulation preamble as the sibling auth tests: @carbon/kv is wrapped in
// withResilience(), and env is validated at import time, so both are stubbed
// rather than requiring Redis and a full environment in the test run.
vi.mock("@carbon/kv", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(null),
    getdel: vi.fn().mockResolvedValue(null)
  }
}));

vi.mock("../config/env", () => ({
  RESEND_DOMAIN: "test.dev",
  DOMAIN: "localhost",
  ERP_URL: "http://localhost:3000",
  MES_URL: "http://localhost:3001",
  VERCEL_URL: "",
  CarbonEdition: "Community",
  REFRESH_ACCESS_TOKEN_THRESHOLD: 60,
  SESSION_KEY: "auth",
  SESSION_MAX_AGE: 60 * 60 * 24 * 7,
  SESSION_SECRET: "test-session-secret",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  SUPABASE_JWT_SECRET: "test-jwt-secret"
}));

vi.mock("./auth-events.server", () => ({
  logRoleChange: vi.fn(),
  logPermissionChange: vi.fn()
}));

import { deactivateEmployee } from "./users.server";

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

    // Regression guard: deleting employeeJob here made deactivation lossy —
    // title, start date, department, shift, manager, location, tags and custom
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
