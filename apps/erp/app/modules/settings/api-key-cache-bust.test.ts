import { describe, expect, it, vi } from "vitest";

const bustApiKeyCache = vi.hoisted(() => vi.fn());

// settings.server.ts drags @carbon/ee and the integration hooks in at module load;
// none of that is under test here.
vi.mock("@carbon/auth/auth.server", () => ({ bustApiKeyCache }));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));
vi.mock("@carbon/ee", () => ({
  getIntegrationConfigById: vi.fn(),
  resolveIntegrationSecrets: vi.fn(),
  splitSecrets: vi.fn()
}));
vi.mock("@carbon/ee/hooks.server", () => ({
  getIntegrationServerHooks: vi.fn()
}));

import { invalidateApiKeyCache } from "./settings.server";

function fakeClient(row: { keyHash: string } | null) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(async () => ({ data: row, error: null }));
  return chain as unknown as Parameters<typeof invalidateApiKeyCache>[0];
}

describe("invalidateApiKeyCache", () => {
  it("busts the cache with the row's keyHash and returns it for a post-delete re-bust", async () => {
    bustApiKeyCache.mockClear();
    const hash = await invalidateApiKeyCache(
      fakeClient({ keyHash: "hash-1" }),
      "key-1"
    );
    expect(hash).toBe("hash-1");
    expect(bustApiKeyCache).toHaveBeenCalledTimes(1);
    expect(bustApiKeyCache).toHaveBeenCalledWith("hash-1");
  });

  it("does nothing and returns null when the row is missing", async () => {
    bustApiKeyCache.mockClear();
    const hash = await invalidateApiKeyCache(fakeClient(null), "key-gone");
    expect(hash).toBeNull();
    expect(bustApiKeyCache).not.toHaveBeenCalled();
  });
});
