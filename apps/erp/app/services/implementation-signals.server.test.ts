// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const redis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  })
};
vi.mock("@carbon/kv", () => ({ redis }));

const detect = vi.fn();
vi.mock("@carbon/onboarding/server", () => ({
  detectImplementationSignals: detect
}));

const { getImplementationSignals } = await import(
  "./implementation-signals.server"
);

const client = {} as Parameters<typeof getImplementationSignals>[0];
const signals = (overrides: Record<string, boolean>) => ({
  hasItems: false,
  hasMakeMethod: false,
  hasJob: false,
  hasSalesOrder: false,
  hasTrackedEntity: false,
  ...overrides
});

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("getImplementationSignals", () => {
  it("remembers the signals seen true and passes them as known next time", async () => {
    detect.mockResolvedValueOnce(signals({ hasItems: true, hasJob: true }));
    await getImplementationSignals(client, "c1");
    expect(detect).toHaveBeenLastCalledWith(client, "c1", {});

    detect.mockResolvedValueOnce(signals({ hasItems: true, hasJob: true }));
    await getImplementationSignals(client, "c1");
    expect(detect).toHaveBeenLastCalledWith(client, "c1", {
      hasItems: true,
      hasJob: true
    });
    // Nothing new was seen the second time, so nothing is rewritten.
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it("keeps one company's signals away from another's", async () => {
    detect.mockResolvedValueOnce(signals({ hasItems: true }));
    await getImplementationSignals(client, "c1");

    detect.mockResolvedValueOnce(signals({}));
    await getImplementationSignals(client, "c2");
    expect(detect).toHaveBeenLastCalledWith(client, "c2", {});
  });

  it("probes everything when Redis is unavailable", async () => {
    redis.get.mockRejectedValueOnce(new Error("down"));
    redis.set.mockRejectedValueOnce(new Error("down"));
    detect.mockResolvedValueOnce(signals({ hasItems: true }));
    await expect(getImplementationSignals(client, "c1")).resolves.toEqual(
      signals({ hasItems: true })
    );
    expect(detect).toHaveBeenLastCalledWith(client, "c1", {});
  });
});
