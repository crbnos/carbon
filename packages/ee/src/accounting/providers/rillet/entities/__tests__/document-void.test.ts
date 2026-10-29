// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import { fakeDatabase } from "../../../../core/fake-database-test-fixture";
import { RilletBillSyncer } from "../bill";
import { RilletChargeSyncer } from "../charge";
import { RilletSalesInvoiceSyncer } from "../invoice";

describe.each([
  ["invoice", RilletSalesInvoiceSyncer],
  ["bill", RilletBillSyncer],
  ["charge", RilletChargeSyncer]
] as const)("Rillet %s void", (entityType, Syncer) => {
  function setup(
    status: string,
    mapping: { externalId: string; metadata?: Record<string, unknown> },
    failure?: Error
  ) {
    const db = fakeDatabase({
      externalIntegrationMapping: [
        {
          entityType,
          entityId: "doc-1",
          integration: "rillet",
          companyId: "company-1",
          metadata: null,
          ...mapping
        }
      ]
    });
    const deletion = failure
      ? vi.fn().mockRejectedValue(failure)
      : vi.fn().mockResolvedValue(undefined);
    const syncer = new Syncer({
      database: db.database,
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
        deleteBill: deletion,
        deleteCharge: deletion
      } as never
    });
    vi.spyOn(syncer, "fetchLocal").mockResolvedValue({
      id: "doc-1",
      status
    } as never);
    return {
      syncer,
      deletion,
      mapping: () => db.rows("externalIntegrationMapping")[0]
    };
  }
  it("propagates a mapped void before the existing mapping fast bailout", async () => {
    const { syncer, deletion, mapping } = setup("Voided", {
      externalId: "remote-1",
      metadata: { retained: true }
    });
    expect(await syncer.pushToAccounting("doc-1")).toMatchObject({
      status: "success",
      action: "deleted",
      remoteId: "remote-1"
    });
    expect(deletion).toHaveBeenCalledWith("remote-1");
    expect(mapping()).toMatchObject({
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
    const { syncer, mapping } = setup(
      "Voided",
      { externalId: "remote-1" },
      new Error("document has payments")
    );
    expect(await syncer.pushToAccounting("doc-1")).toMatchObject({
      status: "error",
      error: "document has payments"
    });
    expect(mapping()?.metadata).toBeNull();
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
