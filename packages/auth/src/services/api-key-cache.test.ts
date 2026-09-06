import { beforeEach, describe, expect, it, vi } from "vitest";

// Same simulation preamble as auth-redis-resilience.test.ts: @carbon/kv is wrapped
// in withResilience(), so reads/writes resolve `null` instead of throwing when
// Redis is unreachable.
vi.mock("@carbon/kv", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(null),
    getdel: vi.fn().mockResolvedValue(null)
  }
}));

// Env is validated at import time (getEnv throws on missing required vars), so we
// stub the config module rather than requiring a full environment in the test run.
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
  SESSION_SECRET: "test-session-secret"
}));

const db = vi.hoisted(() => ({ single: vi.fn() }));

vi.mock("../lib/supabase/client.server", () => {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = db.single;
  return { getCarbonServiceRole: vi.fn(() => chain) };
});

import { redis } from "@carbon/kv";
import {
  type ApiKeyRecord,
  apiKeyCacheKey,
  bustApiKeyCache,
  getApiKeyRecord,
  hashApiKey
} from "./api-key.server";

const mockRedis = redis as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

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

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue("OK");
  mockRedis.del.mockResolvedValue(1);
  db.single.mockResolvedValue({ data: ROW, error: null });
});

describe("getApiKeyRecord", () => {
  it("cache miss: one DB read, then writes the record with a 30s TTL", async () => {
    const record = await getApiKeyRecord(KEY);
    expect(record).toEqual(ROW);
    expect(db.single).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalledWith(
      CACHE_KEY,
      JSON.stringify(ROW),
      "EX",
      30
    );
  });

  it("cache hit: returns the cached record with zero DB reads", async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(ROW));
    const record = await getApiKeyRecord(KEY);
    expect(record).toEqual(ROW);
    expect(db.single).not.toHaveBeenCalled();
  });

  it("unknown key: returns null, caches the negative, and serves it without the DB", async () => {
    db.single.mockResolvedValue({
      data: null,
      error: { message: "not found" }
    });
    expect(await getApiKeyRecord(KEY)).toBeNull();
    expect(db.single).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalledWith(CACHE_KEY, "null", "EX", 30);

    mockRedis.get.mockResolvedValue("null");
    expect(await getApiKeyRecord(KEY)).toBeNull();
    expect(db.single).toHaveBeenCalledTimes(1);
  });

  it("Redis down (reads and writes resolve null): falls through to the DB without throwing", async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue(null);
    await expect(getApiKeyRecord(KEY)).resolves.toEqual(ROW);
    expect(db.single).toHaveBeenCalledTimes(1);
  });
});

describe("bustApiKeyCache", () => {
  it("deletes the cache entry for the key hash", async () => {
    await bustApiKeyCache("abc");
    expect(mockRedis.del).toHaveBeenCalledWith("apikey:auth:abc");
  });
});
