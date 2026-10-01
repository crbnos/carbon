// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type { RampVendor } from "../models";
import { buildRampVendorResolution, decideRampSpendVendor } from "../spend";

/**
 * The bug: in push-only mode Rillet holds Ramp's accounting seat, and Carbon
 * pushed each bill against a Ramp vendor it matched or created — a bill-pay
 * vendor with NO accounting vendor. Ramp showed the bill's "Accounting
 * Merchant" empty, so someone had to pick the Rillet vendor by hand before
 * Rillet could post it. The lines were already coded with Rillet's account
 * ids; the vendor was the half Carbon never addressed by Rillet's id.
 *
 * These pin the DECISION; performing it (the PATCH, the mapping write) is glue.
 */

const supplier = { id: "sup_amazon", name: "Amazon" };
const RILLET_VENDOR = "019f-rillet-amazon";

const rilletMapping = { entityId: "sup_amazon", externalId: RILLET_VENDOR };
const rampMapping = (
  externalId: string,
  metadata: Record<string, unknown> | null = null
) => ({ entityId: "sup_amazon", externalId, metadata });

function decide(args: {
  vendorMappings?: ReturnType<typeof rampMapping>[];
  delegated?: boolean;
  vendors?: RampVendor[];
}) {
  return decideRampSpendVendor(
    buildRampVendorResolution({
      vendorMappings: args.vendorMappings ?? [],
      accountingVendorMappings: args.delegated ? [rilletMapping] : [],
      vendors: args.vendors
    }),
    supplier
  );
}

describe("decideRampSpendVendor — Carbon holds the seat", () => {
  it("uses a mapped vendor as-is", () => {
    expect(decide({ vendorMappings: [rampMapping("rv_1")] })).toEqual({
      action: "use",
      vendorId: "rv_1"
    });
  });

  it("matches by name without linking — Carbon publishes no accounting vendors", () => {
    expect(decide({ vendors: [{ id: "rv_1", name: "Amazon" }] })).toEqual({
      action: "match",
      vendorId: "rv_1"
    });
  });
});

describe("decideRampSpendVendor — another system holds the seat", () => {
  it("links a vendor Carbon mapped before linking existed", () => {
    // Every install that pushed a bill before this change has a mapping with no
    // link. The first push after it must repair the vendor, not skip it.
    expect(
      decide({
        delegated: true,
        vendorMappings: [rampMapping("rv_1")],
        vendors: [{ id: "rv_1", name: "Amazon" }]
      })
    ).toEqual({ action: "match", vendorId: "rv_1", linkTo: RILLET_VENDOR });
  });

  it("uses the mapping alone once the link is recorded", () => {
    expect(
      decide({
        delegated: true,
        vendorMappings: [
          rampMapping("rv_1", { accountingVendorRemoteId: RILLET_VENDOR })
        ]
      })
    ).toEqual({ action: "use", vendorId: "rv_1" });
  });

  it("re-links when the seat-holder's vendor changed since the link was recorded", () => {
    expect(
      decide({
        delegated: true,
        vendorMappings: [
          rampMapping("rv_1", { accountingVendorRemoteId: "019f-old" })
        ],
        vendors: [{ id: "rv_1", name: "Amazon" }]
      })
    ).toEqual({ action: "match", vendorId: "rv_1", linkTo: RILLET_VENDOR });
  });

  it("adopts the Ramp vendor the accounting vendor is already linked to", () => {
    // Ramp allows an accounting vendor ONE linked vendor — typically one Ramp
    // made from the seat-holder's own vendor sync. That is where this
    // supplier's bills belong, even over a vendor Carbon mapped or created, and
    // linking Carbon's instead would be refused as a second link.
    expect(
      decide({
        delegated: true,
        vendorMappings: [rampMapping("rv_carbon")],
        vendors: [
          { id: "rv_carbon", name: "Amazon" },
          {
            id: "rv_from_rillet",
            name: "Amazon.com",
            accounting_vendor_remote_id: RILLET_VENDOR
          }
        ]
      })
    ).toEqual({
      action: "match",
      vendorId: "rv_from_rillet",
      linkedTo: RILLET_VENDOR
    });
  });

  it("links a vendor matched by name", () => {
    expect(
      decide({ delegated: true, vendors: [{ id: "rv_1", name: "amazon " }] })
    ).toEqual({ action: "match", vendorId: "rv_1", linkTo: RILLET_VENDOR });
  });

  it("records an existing link without re-sending it", () => {
    expect(
      decide({
        delegated: true,
        vendorMappings: [rampMapping("rv_1")],
        vendors: [
          {
            id: "rv_1",
            name: "Amazon",
            accounting_vendor_remote_id: RILLET_VENDOR
          }
        ]
      })
    ).toEqual({ action: "match", vendorId: "rv_1", linkedTo: RILLET_VENDOR });
  });

  it("leaves a vendor a human linked to a DIFFERENT accounting vendor", () => {
    expect(
      decide({
        delegated: true,
        vendorMappings: [rampMapping("rv_1")],
        vendors: [
          {
            id: "rv_1",
            name: "Amazon",
            accounting_vendor_remote_id: "019f-rillet-aws"
          }
        ]
      })
    ).toEqual({
      action: "match",
      vendorId: "rv_1",
      conflict: "019f-rillet-aws"
    });
  });

  it("creates and then links when no Ramp vendor matches", () => {
    expect(decide({ delegated: true, vendors: [] })).toEqual({
      action: "create",
      linkTo: RILLET_VENDOR
    });
  });

  it("creates rather than guessing between two same-named vendors", () => {
    expect(
      decide({
        delegated: true,
        vendors: [
          { id: "rv_1", name: "Amazon" },
          { id: "rv_2", name: "AMAZON" }
        ]
      })
    ).toEqual({ action: "create", linkTo: RILLET_VENDOR });
  });

  it("behaves as before for a supplier the seat-holder does not have yet", () => {
    expect(
      decideRampSpendVendor(
        buildRampVendorResolution({
          vendorMappings: [rampMapping("rv_1")],
          accountingVendorMappings: []
        }),
        supplier
      )
    ).toEqual({ action: "use", vendorId: "rv_1" });
  });

  it("keeps a mapped vendor when the vendor list could not be read", () => {
    const resolution = buildRampVendorResolution({
      vendorMappings: [rampMapping("rv_1")],
      accountingVendorMappings: [rilletMapping]
    });
    resolution.vendorLookup = { ok: false, error: new Error("503") };

    expect(decideRampSpendVendor(resolution, supplier)).toEqual({
      action: "use",
      vendorId: "rv_1"
    });
  });
});
