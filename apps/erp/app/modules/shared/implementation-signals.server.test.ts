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

const { getImplementationSignals } = await import("./shared.service");

type Client = Parameters<typeof getImplementationSignals>[0];

// In-memory tables keyed by companyId; records which tables were probed.
function fakeClient(rows: Record<string, string[]>) {
  const probed: string[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, companyId: string) => ({
          limit: async () => {
            probed.push(table);
            return {
              data: (rows[table] ?? [])
                .filter((owner) => owner === companyId)
                .map((_, i) => ({ id: `${table}-${i}` }))
            };
          }
        })
      })
    })
  } as unknown as Client;
  return { client, probed };
}

const none = {
  hasItems: false,
  hasMakeMethod: false,
  hasJob: false,
  hasSalesOrder: false,
  hasTrackedEntity: false
};
const allTables = ["item", "makeMethod", "job", "salesOrder", "trackedEntity"];

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("getImplementationSignals", () => {
  it("skips the probe for a signal already seen true", async () => {
    const first = fakeClient({ item: ["c1"], job: ["c1"] });
    await expect(getImplementationSignals(first.client, "c1")).resolves.toEqual(
      { ...none, hasItems: true, hasJob: true }
    );
    expect(first.probed.sort()).toEqual([...allTables].sort());

    const second = fakeClient({ item: ["c1"], job: ["c1"] });
    await expect(
      getImplementationSignals(second.client, "c1")
    ).resolves.toEqual({ ...none, hasItems: true, hasJob: true });
    expect(second.probed.sort()).toEqual(
      ["makeMethod", "salesOrder", "trackedEntity"].sort()
    );
  });

  it("keeps one company's signals away from another's", async () => {
    const data = { item: ["c1"] };
    await getImplementationSignals(fakeClient(data).client, "c1");

    const other = fakeClient(data);
    await expect(getImplementationSignals(other.client, "c2")).resolves.toEqual(
      none
    );
    expect(other.probed).toContain("item");
  });

  it("probes everything when Redis is unavailable", async () => {
    redis.get.mockRejectedValueOnce(new Error("down"));
    redis.set.mockRejectedValueOnce(new Error("down"));
    const { client, probed } = fakeClient({ item: ["c1"] });

    await expect(getImplementationSignals(client, "c1")).resolves.toEqual({
      ...none,
      hasItems: true
    });
    expect(probed).toHaveLength(allTables.length);
  });
});
