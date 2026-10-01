// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import { RampProvider } from "../provider";

type Metadata = ConstructorParameters<typeof RampProvider>[2];

function makeProvider(
  sync: Partial<{ pushPurchaseOrders: boolean; pushInvoices: boolean }> = {}
) {
  const getBusiness = vi.fn().mockResolvedValue({ id: "business-1" });
  const client = { getBusiness } as unknown as ConstructorParameters<
    typeof RampProvider
  >[0];

  const metadata = {
    sync: {
      pullTransactions: true,
      pullBills: true,
      pullReimbursements: true,
      pushPurchaseOrders: sync.pushPurchaseOrders ?? true,
      pushInvoices: sync.pushInvoices ?? true
    }
  } as Metadata;

  return {
    provider: new RampProvider(client, "company-1", metadata),
    getBusiness
  };
}

describe("RampProvider", () => {
  it("identifies as the ramp spend provider", () => {
    const { provider } = makeProvider();

    expect(provider.id).toBe("ramp");
    expect(provider.capabilities).toEqual({
      role: "spend",
      transport: "rest",
      supportsWebhooks: true,
      ownsRemoteCodingSurface: true,
      ownsLedgerFamilies: [],
      // Ramp cannot create a spend vendor without a contact email, so
      // connecting it turns `requireSupplierContactAndLocation` on — see
      // `sync/party-contact.ts`. Declared on the MODE profile, so this is also
      // what stops the requirement being a Ramp-shaped special case.
      requiresPartyContactAndLocation: ["supplier"]
    });
  });

  it("maps the stored push flags onto the entities it syncs", () => {
    const { provider } = makeProvider({ pushInvoices: false });

    expect(provider.getSyncConfig("purchaseOrder").enabled).toBe(true);
    expect(provider.getSyncConfig("bill").enabled).toBe(false);
  });

  it("reports every entity it does not sync as disabled", () => {
    const { provider } = makeProvider();

    // The inbound families (cards, reimbursements) do not run through this
    // config, and Ramp is not an accounting provider — it must never claim
    // invoices or journals.
    expect(provider.getSyncConfig("invoice").enabled).toBe(false);
    expect(provider.getSyncConfig("journalEntry").enabled).toBe(false);
    expect(provider.getSyncConfig("charge").enabled).toBe(false);
  });

  it("validates with a cheap authenticated read", async () => {
    const { provider, getBusiness } = makeProvider();

    expect(await provider.validate()).toBe(true);
    expect(getBusiness).toHaveBeenCalledOnce();
  });

  it("reports invalid rather than throwing when the read fails", async () => {
    const { provider, getBusiness } = makeProvider();
    getBusiness.mockRejectedValueOnce(new Error("401"));

    expect(await provider.validate()).toBe(false);
  });
});
