import { describe, expect, it, vi } from "vitest";
import { RilletBillSyncer } from "../bill";
import { RilletSalesInvoiceSyncer } from "../invoice";

const { linked } = vi.hoisted(() => ({ linked: [] as unknown[] }));
vi.mock("../../../../core/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../core/utils")>()),
  withTriggersDisabled: async (
    _db: unknown,
    cb: (tx: unknown) => Promise<unknown>
  ) => {
    const b = {
      values: (row: unknown) => {
        linked.push(row);
        return b;
      },
      onConflict: () => b,
      execute: async () => []
    };
    return cb({ insertInto: () => b });
  }
}));

describe.each([
  ["invoice", RilletSalesInvoiceSyncer],
  ["bill", RilletBillSyncer]
] as const)("Rillet %s void", (entityType, Syncer) => {
  function setup(status: string, mapping: unknown, failure?: Error) {
    linked.length = 0;
    const deletion = failure
      ? vi.fn().mockRejectedValue(failure)
      : vi.fn().mockResolvedValue(undefined);
    const syncer = new Syncer({
      database: {} as never,
      companyId: "company-1",
      entityType,
      config: {
        enabled: true,
        direction: "push-to-accounting",
        owner: "carbon"
      },
      provider: {
        id: "rillet",
        deleteInvoice: deletion,
        deleteBill: deletion
      } as never
    });
    vi.spyOn(syncer, "fetchLocal").mockResolvedValue({
      id: "doc-1",
      status
    } as never);
    (syncer as any).mappingService = { getByEntity: async () => mapping };
    return { syncer, deletion };
  }
  it("propagates a mapped void before the existing mapping fast bailout", async () => {
    const { syncer, deletion } = setup("Voided", {
      externalId: "remote-1",
      metadata: { retained: true }
    });
    expect(await syncer.pushToAccounting("doc-1")).toMatchObject({
      status: "success",
      action: "deleted",
      remoteId: "remote-1"
    });
    expect(deletion).toHaveBeenCalledWith("remote-1");
    expect(linked[0]).toMatchObject({
      entityId: "doc-1",
      externalId: "remote-1",
      metadata: { retained: true, voided: true }
    });
  });
  it("skips repeat deletes after the durable marker", async () => {
    const { syncer, deletion } = setup("Voided", {
      externalId: "remote-1",
      metadata: { voided: true }
    });
    expect(await syncer.pushToAccounting("doc-1")).toMatchObject({
      status: "success",
      action: "deleted"
    });
    expect(deletion).not.toHaveBeenCalled();
  });
  it("does not hide failed remote deletion behind the old mapping", async () => {
    const { syncer } = setup(
      "Voided",
      { externalId: "remote-1" },
      new Error("document has payments")
    );
    expect(await syncer.pushToAccounting("doc-1")).toMatchObject({
      status: "error",
      error: "document has payments"
    });
    expect(linked).toHaveLength(0);
  });
  it("keeps ordinary posted replay immutable", async () => {
    const { syncer, deletion } = setup("Submitted", { externalId: "remote-1" });
    expect(await syncer.pushToAccounting("doc-1")).toMatchObject({
      status: "skipped",
      remoteId: "remote-1"
    });
    expect(deletion).not.toHaveBeenCalled();
  });
});
