// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  type ApiKeyRecord,
  apiKeyCacheKey,
  bustApiKeyCache,
  getApiKeyRecord,
  hashApiKey
} from "./api-key.server";

// The module reads its configuration once, at import.
vi.hoisted(() => {
  vi.stubEnv("SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
});

// Redis as an in-memory map that keeps each entry's TTL. With `down` set it
// behaves as @carbon/kv's withResilience() does: every call resolves null.
const kv = vi.hoisted(() => ({
  entries: new Map<string, { value: string; ttl: number }>(),
  down: false
}));
vi.mock("@carbon/kv", () => ({
  redis: {
    get: async (key: string) =>
      kv.down ? null : (kv.entries.get(key)?.value ?? null),
    set: async (key: string, value: string, _ex: "EX", ttl: number) => {
      if (kv.down) return null;
      kv.entries.set(key, { value, ttl });
      return "OK";
    },
    del: async (key: string) =>
      kv.down ? null : Number(kv.entries.delete(key))
  }
}));

const KEY_ROW = {
  id: "key1",
  companyId: "c1",
  companyGroupId: "g1",
  createdBy: "u1",
  rateLimit: 60,
  rateLimitWindow: "1m",
  expiresAt: null
};

// What the select returns: the key with its grants embedded. A grant naming
// another company is ignored.
const DB_ROW = {
  ...KEY_ROW,
  permission: [
    { companyId: "c1", module: "Sales", page: null, level: "View" },
    { companyId: "c2", module: "Parts", page: null, level: "Full" }
  ]
};

// A module grant reaches every page of the module, and no module key.
const ROW = {
  ...KEY_ROW,
  permissions: expect.objectContaining({
    "sales.quotes": { view: ["c1"], create: [], update: [], delete: [] },
    "sales.customers": { view: ["c1"], create: [], update: [], delete: [] },
    "parts.parts": { view: [], create: [], update: [], delete: [] }
  })
} as unknown as ApiKeyRecord;

const KEY = "crbn_test_key";
const CACHE_KEY = apiKeyCacheKey(hashApiKey(KEY));

// PostgREST's answer to the apiKey lookup, and how many lookups reached it.
const db = {
  reads: 0,
  respond: (): Response => json(DB_ROW)
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });

beforeEach(() => {
  kv.entries.clear();
  kv.down = false;
  db.reads = 0;
  db.respond = () => json(DB_ROW);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname !== "/rest/v1/apiKey") return json({}, 404);
    db.reads++;
    return db.respond();
  });
});

afterEach(() => vi.unstubAllGlobals());

afterAll(() => vi.unstubAllEnvs());

describe("getApiKeyRecord", () => {
  it("reads the database on a miss and caches the record for 30 seconds", async () => {
    expect(await getApiKeyRecord(KEY)).toEqual(ROW);
    expect(db.reads).toBe(1);
    const cached = kv.entries.get(CACHE_KEY);
    expect(cached?.ttl).toBe(30);
    expect(JSON.parse(cached?.value ?? "null")).toEqual(ROW);
  });

  it("serves a cached record without reading the database", async () => {
    const record = { ...KEY_ROW, permissions: {} };
    kv.entries.set(CACHE_KEY, { value: JSON.stringify(record), ttl: 30 });

    expect(await getApiKeyRecord(KEY)).toEqual(record);
    expect(db.reads).toBe(0);
  });

  it("caches an unknown key as a negative and serves it without the database", async () => {
    db.respond = () =>
      json(
        { code: "PGRST116", message: "no rows", details: null, hint: null },
        406
      );

    expect(await getApiKeyRecord(KEY)).toBeNull();
    expect(kv.entries.get(CACHE_KEY)).toEqual({ value: "null", ttl: 30 });

    expect(await getApiKeyRecord(KEY)).toBeNull();
    expect(db.reads).toBe(1);
  });

  // A blip must not reject a valid key for the whole TTL.
  it("does not cache the null from a failed lookup", async () => {
    db.respond = () =>
      json(
        {
          code: "57P01",
          message: "terminating connection",
          details: null,
          hint: null
        },
        500
      );

    expect(await getApiKeyRecord(KEY)).toBeNull();
    expect(kv.entries.size).toBe(0);
  });

  it("falls through to the database when Redis is down", async () => {
    kv.down = true;

    await expect(getApiKeyRecord(KEY)).resolves.toEqual(ROW);
    expect(db.reads).toBe(1);
  });
});

describe("bustApiKeyCache", () => {
  it("deletes the cache entry for the key hash", async () => {
    kv.entries.set(apiKeyCacheKey("abc"), { value: "null", ttl: 30 });

    await bustApiKeyCache("abc");

    expect(kv.entries.has(apiKeyCacheKey("abc"))).toBe(false);
  });
});
