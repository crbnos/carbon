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

const ROW: ApiKeyRecord = {
  id: "key1",
  companyId: "c1",
  companyGroupId: "g1",
  createdBy: "u1",
  scopes: { sales_view: ["c1"] },
  rateLimit: 60,
  rateLimitWindow: "1m",
  expiresAt: null
};

const KEY = "crbn_test_key";
const CACHE_KEY = apiKeyCacheKey(hashApiKey(KEY));

// PostgREST's answer to the apiKey lookup, and how many lookups reached it.
const db = {
  reads: 0,
  respond: (): Response => json(ROW)
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
  db.respond = () => json(ROW);
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
    expect(kv.entries.get(CACHE_KEY)).toEqual({
      value: JSON.stringify(ROW),
      ttl: 30
    });
  });

  it("serves a cached record without reading the database", async () => {
    kv.entries.set(CACHE_KEY, { value: JSON.stringify(ROW), ttl: 30 });

    expect(await getApiKeyRecord(KEY)).toEqual(ROW);
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
