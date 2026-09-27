import { QboChargeSyncer, XeroChargeSyncer } from "@carbon/ee/accounting";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardChargeSource } from "../../../../../ee/src/accounting/core/card-charge-source";
import type { SyncOperationRequest } from "./accounting-sync-operations";
import { reconcileEntities } from "./reconcile-executor";

const { requests, mapping } = vi.hoisted(() => ({
  requests: [] as SyncOperationRequest[],
  mapping: {
    entityId: "charge-1",
    externalId: "remote-1",
    lastSyncedAt: "2026-09-10T00:00:00Z",
    metadata: {} as Record<string, unknown>
  }
}));
vi.mock("./accounting-sync-operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounting-sync-operations")>()),
  enqueueSyncOperations: async (
    _client: unknown,
    args: { requests: SyncOperationRequest[] }
  ) => {
    requests.push(...args.requests);
    return args.requests.map(() => ({ outcome: "enqueued" }));
  },
  insertTerminalSyncOperations: async () => []
}));
vi.mock("../../../../../ee/src/accounting/core/external-mapping", () => ({
  createMappingService: () => ({
    getByEntity: async () => mapping,
    getByEntities: async () => new Map([[mapping.entityId, mapping]]),
    link: async (
      _type: string,
      _id: string,
      _provider: string,
      _externalId: string,
      options: { metadata: Record<string, unknown> }
    ) => {
      mapping.metadata = options.metadata;
    }
  })
}));
vi.mock(
  "../../../../../ee/src/accounting/core/utils",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../../ee/src/accounting/core/utils")
    >()),
    withTriggersDisabled: async (
      _db: unknown,
      callback: (tx: unknown) => Promise<unknown>
    ) => callback({})
  })
);

beforeEach(() => {
  requests.length = 0;
  mapping.metadata = {};
});

describe.each([
  "xero",
  "quickbooks"
])("%s reconciled card void", (providerId) => {
  it.each([
    true,
    false
  ])("enqueues a mapped void, reaches the native adapter, and persists only confirmed deletion (confirmed=%s)", async (confirmed) => {
    const client = {
      from(table: string) {
        const query = {
          select: () => query,
          eq: () => query,
          in: async () => ({
            error: null,
            data:
              table === "cardTransaction"
                ? [{ id: "charge-1", status: "Voided" }]
                : []
          })
        };
        return query;
      }
    };
    const database = {
      selectFrom: () => {
        const query = {
          select: () => query,
          where: () => query,
          execute: async () => [mapping]
        };
        return query;
      }
    };
    const summary = await reconcileEntities({
      client: client as never,
      database: database as never,
      companyId: "company-1",
      providerId,
      integrationMetadata: {},
      createdBy: "system",
      scope: "void",
      refs: [{ entityType: "charge", entityId: "charge-1" }]
    });
    expect(summary.enqueued).toBe(1);
    expect(requests[0]).toMatchObject({
      entityType: "charge",
      entityId: "charge-1"
    });

    const remoteCalls: string[] = [];
    const provider = {
      id: providerId,
      deletePurchase: async () => {
        remoteCalls.push("delete");
        if (!confirmed) throw new Error("Provider refused deletion");
      },
      request: async (method: string) => {
        remoteCalls.push(method);
        if (!confirmed && method === "POST")
          throw new Error("Provider refused deletion");
        return {
          error: false,
          data: {
            BankTransactions: [
              {
                BankTransactionID: "remote-1",
                Type: "SPEND",
                BankAccount: { Code: "card" },
                LineItems: [],
                Status: method === "GET" ? "AUTHORISED" : "DELETED"
              }
            ]
          }
        };
      }
    };
    const Syncer = providerId === "xero" ? XeroChargeSyncer : QboChargeSyncer;
    const syncer = new Syncer({
      database: {} as never,
      companyId: "company-1",
      provider: provider as never,
      entityType: "charge",
      config: {
        enabled: true,
        direction: "push-to-accounting",
        owner: "carbon"
      }
    });
    const localSource: CardChargeSource = {
      id: "charge-1",
      companyId: "company-1",
      cardTransactionId: "CARD-1",
      type: "Charge",
      status: "Voided",
      supplierId: "supplier",
      supplierExternalId: "remote-supplier",
      merchantName: null,
      memo: null,
      updatedAt: null
    };
    vi.spyOn(
      syncer as unknown as {
        fetchLocalBatch(ids: string[]): Promise<Map<string, CardChargeSource>>;
      },
      "fetchLocalBatch"
    ).mockResolvedValue(new Map([[localSource.id, localSource]]));
    const result = await syncer.pushBatchToAccounting(
      requests.map((request) => request.entityId)
    );
    expect(result.results[0]).toMatchObject(
      confirmed
        ? {
            status: "success",
            action: "deleted"
          }
        : { status: "error" }
    );
    expect(remoteCalls.length).toBeGreaterThan(0);
    expect(mapping.metadata.voided === true).toBe(confirmed);
    expect(
      (
        await reconcileEntities({
          client: client as never,
          database: database as never,
          companyId: "company-1",
          providerId,
          integrationMetadata: {},
          createdBy: "system",
          scope: "void-repeat",
          refs: [{ entityType: "charge", entityId: "charge-1" }]
        })
      ).enqueued
    ).toBe(confirmed ? 0 : 1);
  });
});
