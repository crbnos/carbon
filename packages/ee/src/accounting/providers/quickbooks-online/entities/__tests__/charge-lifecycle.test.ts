import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Qbo } from "../../models";
import { type QboCardCharge, QboChargeSyncer } from "../charge";

const { mappings } = vi.hoisted(() => ({
  mappings: new Map<
    string,
    {
      externalId: string;
      metadata?: Record<string, unknown>;
      lastSyncedAt?: string;
    }
  >()
}));
vi.mock("../../../../core/external-mapping", () => ({
  createMappingService: () => ({
    getByEntity: async (_type: string, id: string) => mappings.get(id) ?? null,
    getByEntities: async (_type: string, ids: string[]) =>
      new Map(
        ids.flatMap((id) => (mappings.has(id) ? [[id, mappings.get(id)]] : []))
      ),
    getExternalId: async (_type: string, id: string) =>
      mappings.get(id)?.externalId ?? null,
    link: async (
      _type: string,
      id: string,
      _provider: string,
      externalId: string,
      options?: { metadata?: Record<string, unknown> }
    ) => {
      mappings.set(id, {
        externalId,
        metadata: options?.metadata,
        lastSyncedAt: "2026-09-10T00:00:00Z"
      });
    },
    linkBatch: async (
      rows: Array<{ entityId: string; externalId: string }>
    ) => {
      for (const row of rows)
        mappings.set(row.entityId, { externalId: row.externalId });
    }
  })
}));
vi.mock("../../../../core/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../core/utils")>()),
  withTriggersDisabled: async (
    _db: unknown,
    operation: (tx: unknown) => Promise<unknown>
  ) => operation({})
}));

function local(
  id: string,
  status: QboCardCharge["status"] = "Posted"
): QboCardCharge {
  return {
    id,
    companyId: "company-1",
    cardTransactionId: id,
    type: "Charge",
    status,
    supplierId: "vendor",
    supplierExternalId: "remote-vendor",
    merchantName: "Vendor",
    memo: null,
    updatedAt: null
  };
}

function setup(provider: object, status: QboCardCharge["status"] = "Posted") {
  const syncer = new QboChargeSyncer({
    database: {} as never,
    companyId: "company-1",
    entityType: "charge",
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    provider: { id: "quickbooks", ...provider } as never
  });
  vi.spyOn(syncer, "fetchLocal").mockImplementation(async (id) =>
    local(id, status)
  );
  const internals = syncer as unknown as {
    fetchLocalBatch(ids: string[]): Promise<Map<string, QboCardCharge>>;
    mapToRemote(row: QboCardCharge): Promise<object>;
  };
  vi.spyOn(internals, "fetchLocalBatch").mockImplementation(
    async (ids) => new Map(ids.map((id) => [id, local(id, status)]))
  );
  vi.spyOn(internals, "mapToRemote").mockImplementation(async (row) => ({
    DocNumber: row.id,
    PaymentType: "CreditCard",
    AccountRef: { value: "card" },
    Line: []
  }));
  return syncer;
}

beforeEach(() => mappings.clear());

describe("QBO charge durability", () => {
  it("processes loaded mixed batch rows without single refetches and isolates each failure", async () => {
    for (const id of ["updated", "voided", "unchanged"])
      mappings.set(id, {
        externalId: `remote-${id}`,
        lastSyncedAt: "2026-09-09T00:00:00Z"
      });
    const updatePurchase = vi.fn(
      async () => ({ Id: "remote-updated", SyncToken: "8" }) as Qbo.Purchase
    );
    const deletePurchase = vi.fn(async () => undefined);
    const createPurchase = vi.fn(async (payload: { DocNumber: string }) => {
      if (payload.DocNumber === "bad") throw new Error("bad purchase");
      return {
        Id: `remote-${payload.DocNumber}`,
        SyncToken: "0"
      } as Qbo.Purchase;
    });
    const syncer = setup({
      getPurchase: async () => ({ Id: "remote-updated", SyncToken: "7" }),
      updatePurchase,
      deletePurchase,
      createPurchase
    });
    vi.mocked(syncer.fetchLocal).mockImplementation(async () => {
      throw new Error("must use batch snapshot");
    });
    const batch = syncer as unknown as {
      fetchLocalBatch(ids: string[]): Promise<Map<string, QboCardCharge>>;
    };
    vi.mocked(batch.fetchLocalBatch).mockResolvedValue(
      new Map([
        ["updated", { ...local("updated"), updatedAt: "2026-09-10T00:00:00Z" }],
        ["voided", local("voided", "Voided")],
        ["bad", local("bad")],
        ["good", local("good")],
        [
          "unchanged",
          { ...local("unchanged"), updatedAt: "2026-09-08T00:00:00Z" }
        ]
      ])
    );
    const result = await syncer.pushBatchToAccounting([
      "updated",
      "voided",
      "bad",
      "missing",
      "good",
      "unchanged"
    ]);
    expect(
      result.results.map(({ localId, status, action }) => ({
        localId,
        status,
        action
      }))
    ).toEqual([
      { localId: "updated", status: "success", action: "updated" },
      { localId: "voided", status: "success", action: "deleted" },
      { localId: "bad", status: "error", action: "none" },
      { localId: "missing", status: "error", action: "none" },
      { localId: "good", status: "success", action: "created" },
      { localId: "unchanged", status: "skipped", action: "none" }
    ]);
    expect(syncer.fetchLocal).not.toHaveBeenCalled();
    expect(batch.fetchLocalBatch).toHaveBeenCalledTimes(1);
    expect(updatePurchase).toHaveBeenCalledTimes(1);
    expect(deletePurchase).toHaveBeenCalledTimes(1);
    expect(mappings.get("good")?.externalId).toBe("remote-good");
    expect(mappings.get("voided")?.metadata?.voided).toBe(true);
  });

  it("preserves QBO's sparse update path for a mapped charge edited after sync", async () => {
    mappings.set("a", {
      externalId: "remote-a",
      lastSyncedAt: "2026-09-09T00:00:00Z"
    });
    const updatePurchase = vi.fn(
      async () => ({ Id: "remote-a", SyncToken: "8" }) as Qbo.Purchase
    );
    const syncer = setup({
      getPurchase: async () => ({ Id: "remote-a", SyncToken: "7" }),
      updatePurchase
    });
    vi.mocked(syncer.fetchLocal).mockResolvedValue({
      ...local("a"),
      updatedAt: "2026-09-10T00:00:00Z"
    });
    expect(await syncer.pushToAccounting("a")).toMatchObject({
      status: "success",
      action: "updated"
    });
    expect(updatePurchase).toHaveBeenCalledWith(
      expect.objectContaining({ Id: "remote-a", SyncToken: "7" })
    );
  });

  it("does not persist a phantom mapping after an ambiguous create response", async () => {
    const syncer = setup({ createPurchase: async () => ({}) });
    expect(await syncer.pushToAccounting("a")).toMatchObject({
      status: "error"
    });
    expect(mappings.has("a")).toBe(false);
  });

  it("fails closed when a void has no durable remote identity", async () => {
    const createPurchase = vi.fn();
    const deletePurchase = vi.fn();
    const syncer = setup({ createPurchase, deletePurchase }, "Voided");
    expect(await syncer.pushToAccounting("a")).toMatchObject({
      status: "error",
      error: expect.stringContaining("remote identity")
    });
    expect(createPurchase).not.toHaveBeenCalled();
    expect(deletePurchase).not.toHaveBeenCalled();
  });

  it("retains the first charge mapping when a later purchase fails", async () => {
    const createPurchase = vi.fn(async (payload: { DocNumber: string }) => {
      if (payload.DocNumber === "b") throw new Error("Purchase b failed");
      return { Id: "remote-a", SyncToken: "0" } as Qbo.Purchase;
    });
    const syncer = setup({ createPurchase });
    const first = await syncer.pushBatchToAccounting(["a", "b"]);
    expect(first.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localId: "a",
          status: "success",
          remoteId: "remote-a"
        })
      ])
    );
    expect(mappings.get("a")?.externalId).toBe("remote-a");
    await syncer.pushBatchToAccounting(["a", "b"]);
    expect(
      createPurchase.mock.calls.filter(([payload]) => payload.DocNumber === "a")
    ).toHaveLength(1);
  });

  it("reuses one deterministic request identity after remote success loses its response", async () => {
    const identities: Array<string | undefined> = [];
    const createPurchase = vi.fn(
      async (_payload: unknown, requestId?: string) => {
        identities.push(requestId);
        if (identities.length === 1)
          throw new Error("Response lost after create");
        return { Id: "remote-a", SyncToken: "0" } as Qbo.Purchase;
      }
    );
    const syncer = setup({ createPurchase });
    expect((await syncer.pushToAccounting("a")).status).toBe("error");
    expect((await syncer.pushToAccounting("a")).status).toBe("success");
    expect(identities[0]).toMatch(/^[a-f0-9]{40}$/);
    expect(identities[1]).toBe(identities[0]);
  });

  it("deletes a mapped void and records a durable tombstone", async () => {
    mappings.set("a", { externalId: "remote-a", metadata: { retained: true } });
    const deletePurchase = vi.fn(async () => undefined);
    const syncer = setup({ deletePurchase }, "Voided");
    expect(await syncer.pushToAccounting("a")).toMatchObject({
      status: "success",
      action: "deleted",
      remoteId: "remote-a"
    });
    expect(mappings.get("a")?.metadata).toMatchObject({
      voided: true,
      retained: true
    });
    await syncer.pushToAccounting("a");
    expect(deletePurchase).toHaveBeenCalledTimes(1);
  });

  it("keeps a rejected void as an error without marking the mapping deleted", async () => {
    mappings.set("a", { externalId: "remote-a" });
    const syncer = setup(
      {
        deletePurchase: async () => {
          throw new Error("Period locked");
        }
      },
      "Voided"
    );
    expect(await syncer.pushToAccounting("a")).toMatchObject({
      status: "error",
      error: "Period locked"
    });
    expect(mappings.get("a")?.metadata?.voided).not.toBe(true);
  });
});
