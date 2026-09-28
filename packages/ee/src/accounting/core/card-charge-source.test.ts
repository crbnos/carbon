import { parseAbsolute } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { QboChargeSyncer } from "../providers/quickbooks-online/entities/charge";
import { RilletChargeSyncer } from "../providers/rillet/entities/charge";
import { XeroChargeSyncer } from "../providers/xero/entities/charge";

describe.each([
  ["quickbooks", QboChargeSyncer],
  ["xero", XeroChargeSyncer],
  ["rillet", RilletChargeSyncer]
] as const)("%s card source", (providerId, Syncer) => {
  it("fetches charge headers and supplier mappings in one tenant-scoped query", async () => {
    const reads: string[] = [];
    const filters: unknown[][] = [];
    const rows = ["a", "b"].map((id) => ({
      id,
      companyId: "company-1",
      cardTransactionId: id,
      type: "Charge",
      status: "Posted",
      supplierId: `supplier-${id}`,
      supplierExternalId: `remote-${id}`,
      merchantName: null,
      memo: null,
      updatedAt: parseAbsolute("2026-09-09T00:00:00Z", "UTC").toDate()
    }));
    const database = {
      selectFrom(table: string) {
        reads.push(table);
        const builder = {
          select: () => builder,
          leftJoin: (_table: string, join: (builder: unknown) => unknown) => {
            const clause = {
              onRef: (...args: unknown[]) => {
                filters.push(args);
                return clause;
              },
              on: (...args: unknown[]) => {
                filters.push(args);
                return clause;
              }
            };
            join(clause);
            return builder;
          },
          where: (...args: unknown[]) => {
            filters.push(args);
            return builder;
          },
          execute: async () => rows,
          executeTakeFirst: async () => ({ externalId: "remote" })
        };
        return builder;
      }
    };
    const syncer = new Syncer({
      database: database as never,
      companyId: "company-1",
      provider: { id: providerId } as never,
      entityType: "charge",
      config: {
        enabled: true,
        direction: "push-to-accounting",
        owner: "carbon"
      }
    });
    const result = await (
      syncer as unknown as {
        fetchLocalBatch(
          ids: string[]
        ): Promise<
          Map<
            string,
            { supplierExternalId: string | null; updatedAt: string | null }
          >
        >;
      }
    ).fetchLocalBatch(["a", "b"]);
    expect(reads).toHaveLength(1);
    expect(filters).toContainEqual([
      "cardTransaction.companyId",
      "=",
      "company-1"
    ]);
    expect(filters).toContainEqual([
      "mapping.companyId",
      "=",
      "cardTransaction.companyId"
    ]);
    expect(filters).toContainEqual(["mapping.integration", "=", providerId]);
    expect(result.get("a")?.supplierExternalId).toBe("remote-a");
    expect(result.get("a")?.updatedAt).toBe("2026-09-09T00:00:00.000Z");
  });
});

describe.each([
  ["quickbooks", QboChargeSyncer],
  ["xero", XeroChargeSyncer]
] as const)("%s charge batch source", (providerId, Syncer) => {
  it("reads multi-ID card sources and charge mappings once through the real batch entry point", async () => {
    const reads: string[] = [];
    const filters: unknown[][] = [];
    const database = {
      selectFrom(table: string) {
        reads.push(table);
        const query = {
          select: () => query,
          selectAll: () => query,
          leftJoin: (_table: string, join: (clause: unknown) => unknown) => {
            const clause = { onRef: () => clause, on: () => clause };
            join(clause);
            return query;
          },
          where: (...args: unknown[]) => {
            filters.push(args);
            return query;
          },
          execute: async () =>
            table === "cardTransaction"
              ? ["a", "b"].map((id) => ({
                  id,
                  companyId: "company-1",
                  cardTransactionId: id,
                  type: "Charge",
                  status: "Posted",
                  supplierId: `supplier-${id}`,
                  supplierExternalId: `remote-${id}`,
                  merchantName: null,
                  memo: null,
                  updatedAt: "2026-09-09T00:00:00Z"
                }))
              : ["a", "b"].map((entityId) => ({
                  entityId,
                  externalId: `remote-${entityId}`,
                  lastSyncedAt: parseAbsolute(
                    "2026-09-10T00:00:00Z",
                    "UTC"
                  ).toDate()
                })),
          executeTakeFirst: async () => ({
            externalId: "remote",
            lastSyncedAt: "2026-09-10T00:00:00Z"
          })
        };
        return query;
      }
    };
    const syncer = new Syncer({
      database: database as never,
      companyId: "company-1",
      provider: { id: providerId } as never,
      entityType: "charge",
      config: {
        enabled: true,
        direction: "push-to-accounting",
        owner: "carbon"
      }
    });
    const result = await syncer.pushBatchToAccounting(["a", "b"]);
    expect(result.results.map((item) => item.status)).toEqual([
      "skipped",
      "skipped"
    ]);
    expect(reads.filter((table) => table === "cardTransaction")).toHaveLength(
      1
    );
    expect(
      reads.filter((table) => table === "externalIntegrationMapping")
    ).toHaveLength(1);
    expect(filters).toContainEqual(["entityId", "in", ["a", "b"]]);
    expect(filters).toContainEqual(["companyId", "=", "company-1"]);
    expect(filters).toContainEqual(["integration", "=", providerId]);
  });
});
