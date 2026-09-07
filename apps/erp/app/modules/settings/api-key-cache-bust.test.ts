import { describe, expect, it, vi } from "vitest";

const bustApiKeyCache = vi.hoisted(() => vi.fn());
const getCarbonServiceRole = vi.hoisted(() => vi.fn());

// settings.server.ts drags @carbon/ee and the integration hooks in at module load;
// none of that is under test here.
vi.mock("@carbon/auth/auth.server", () => ({ bustApiKeyCache }));
vi.mock("@carbon/auth/client.server", () => ({ getCarbonServiceRole }));
vi.mock("@carbon/ee", () => ({
  getIntegrationConfigById: vi.fn(),
  resolveIntegrationSecrets: vi.fn(),
  splitSecrets: vi.fn()
}));
vi.mock("@carbon/ee/hooks.server", () => ({
  getIntegrationServerHooks: vi.fn()
}));

import { invalidateApiKeyCache } from "./settings.server";

/** Records the `.eq()` filters so the companyId scoping can be asserted. */
function stubServiceRole(row: { keyHash: string } | null) {
  const eq = vi.fn();
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((column: string, value: string) => {
    eq(column, value);
    return chain;
  });
  chain.maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  getCarbonServiceRole.mockReturnValue(chain);
  return eq;
}

describe("invalidateApiKeyCache", () => {
  it("busts the cache with the row's keyHash and returns it for a post-delete re-bust", async () => {
    bustApiKeyCache.mockClear();
    stubServiceRole({ keyHash: "hash-1" });
    const hash = await invalidateApiKeyCache("key-1", "company-1");
    expect(hash).toBe("hash-1");
    expect(bustApiKeyCache).toHaveBeenCalledTimes(1);
    expect(bustApiKeyCache).toHaveBeenCalledWith("hash-1");
  });

  // The lookup must not use the caller's client: apiKey RLS SELECT wants
  // `settings_view` while the revoke routes gate on `users_update`, so the row
  // was invisible and the bust silently did nothing.
  it("reads with the service role, scoped to the company", async () => {
    bustApiKeyCache.mockClear();
    const eq = stubServiceRole({ keyHash: "hash-1" });
    await invalidateApiKeyCache("key-1", "company-1");
    expect(getCarbonServiceRole).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("id", "key-1");
    expect(eq).toHaveBeenCalledWith("companyId", "company-1");
  });

  it("does nothing and returns null when the row is missing", async () => {
    bustApiKeyCache.mockClear();
    stubServiceRole(null);
    const hash = await invalidateApiKeyCache("key-gone", "company-1");
    expect(hash).toBeNull();
    expect(bustApiKeyCache).not.toHaveBeenCalled();
  });
});
