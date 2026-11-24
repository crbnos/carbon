// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { REGISTRY_HASH } from "@carbon/database/access";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { clearClaims, getUserClaims } from "./users.server";

// The module reads its configuration once, at import.
vi.hoisted(() => {
  vi.stubEnv("SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
});

// An empty permission cache that records what is written to it.
const cache = vi.hoisted(() => ({ writes: 0, deleted: [] as string[] }));
vi.mock("@carbon/kv", () => ({
  redis: {
    hget: async () => null,
    del: async (...keys: string[]) => {
      cache.deleted.push(...keys);
      return keys.length;
    },
    multi: () => {
      const tx = {
        hset: () => {
          cache.writes++;
          return tx;
        },
        expire: () => tx,
        exec: async () => []
      };
      return tx;
    }
  }
}));

const answer = vi.hoisted(() => ({ body: {} as unknown }));

beforeEach(() => {
  cache.writes = 0;
  cache.deleted = [];
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify(answer.body), {
        headers: { "Content-Type": "application/json" }
      })
  );
});

afterEach(() => vi.unstubAllGlobals());

afterAll(() => vi.unstubAllEnvs());

describe("getUserClaims", () => {
  it("caches claims with grants", async () => {
    answer.body = {
      role: "employee",
      admin: false,
      grants: [{ subject: "role", module: "Parts", page: null, level: "View" }],
      portal: {}
    };
    const claims = await getUserClaims("user-1", "company-1");
    expect(claims.permissions["parts.parts"]?.view).toEqual(["company-1"]);
    expect(cache.writes).toBe(1);
  });

  // A database that has not run the permission migrations answers in the old
  // shape. Read it, but never cache it: the cache would outlive the migration.
  it("reads the old shape as module grants and does not cache it", async () => {
    answer.body = {
      role: "employee",
      inventory_view: ["company-1"],
      inventory_update: ["company-1"],
      sales_view: ["company-2"]
    };
    const claims = await getUserClaims("user-2", "company-1");
    // View and update round up to Edit, as the conversion migration does.
    expect(claims.permissions["inventory.receipts"]).toEqual({
      view: ["company-1"],
      create: ["company-1"],
      update: ["company-1"],
      delete: []
    });
    expect(claims.permissions["sales.quotes"]?.view).toEqual([]);
    expect(cache.writes).toBe(0);
  });
});

describe("clearClaims", () => {
  it("deletes every user's cached claims", async () => {
    const users = Array.from({ length: 1201 }, (_, i) => `user-${i}`);
    await clearClaims(users);
    expect(new Set(cache.deleted)).toEqual(
      new Set(users.map((id) => `permissions:${REGISTRY_HASH}:${id}`))
    );
  });

  it("sends nothing for no users", async () => {
    await clearClaims([]);
    expect(cache.deleted).toEqual([]);
  });
});
