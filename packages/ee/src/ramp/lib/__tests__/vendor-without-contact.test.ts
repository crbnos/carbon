// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import { describeMissingVendorFields } from "../../../spend/parties";
import type { RampClient } from "../client";
import { RampIntegrationMetadataSchema } from "../models";
import {
  buildRampVendorResolution,
  resolveOrCreateRampSpendVendor
} from "../spend";

/**
 * Ramp's beta lets a spend vendor be created with no `business_vendor_contacts`
 * — for suppliers paid by ACH, who often have no contact on file. Carbon only
 * omits the contact when the install opts in; otherwise a contactless supplier
 * is still refused before any request is made.
 */

const achSupplier = {
  id: "sup_ach",
  name: "Midwest Steel",
  country: "US",
  contact: null,
  address: {
    line1: null,
    line2: null,
    city: null,
    stateProvince: "OH",
    postalCode: null
  }
};

function harness() {
  const createSpendVendor = vi.fn().mockResolvedValue({ id: "ramp_v1" });
  const client = { createSpendVendor } as unknown as RampClient;
  const mapping = { link: vi.fn().mockResolvedValue(undefined) };
  const resolution = buildRampVendorResolution({
    vendorMappings: [],
    accountingVendorMappings: [],
    vendors: []
  });
  return { client, createSpendVendor, mapping, resolution };
}

describe("resolveOrCreateRampSpendVendor — vendor without a contact", () => {
  it("does not create a contactless vendor unless the install opts in", async () => {
    const { client, createSpendVendor, mapping, resolution } = harness();

    const vendorId = await resolveOrCreateRampSpendVendor(
      mapping as never,
      client,
      achSupplier,
      "company_1",
      resolution
    );

    expect(vendorId).toBeNull();
    expect(createSpendVendor).not.toHaveBeenCalled();
  });

  it("creates the vendor with no business_vendor_contacts when opted in", async () => {
    const { client, createSpendVendor, mapping, resolution } = harness();

    const vendorId = await resolveOrCreateRampSpendVendor(
      mapping as never,
      client,
      achSupplier,
      "company_1",
      resolution,
      { allowWithoutContact: true }
    );

    expect(vendorId).toBe("ramp_v1");
    const body = createSpendVendor.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("business_vendor_contacts");
    expect(body).toMatchObject({
      name: "Midwest Steel",
      country: "US",
      state: "OH",
      external_vendor_id: "sup_ach"
    });
  });

  it("still sends the contact when the supplier has an email", async () => {
    const { client, createSpendVendor, mapping, resolution } = harness();

    await resolveOrCreateRampSpendVendor(
      mapping as never,
      client,
      {
        ...achSupplier,
        contact: {
          email: "ap@midweststeel.com",
          firstName: null,
          lastName: null,
          phone: null
        }
      },
      "company_1",
      resolution,
      { allowWithoutContact: true }
    );

    const body = createSpendVendor.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.business_vendor_contacts).toEqual({
      email: "ap@midweststeel.com"
    });
  });

  it("still requires a country when opted in", async () => {
    const { client, createSpendVendor, mapping, resolution } = harness();

    const vendorId = await resolveOrCreateRampSpendVendor(
      mapping as never,
      client,
      { ...achSupplier, country: null },
      "company_1",
      resolution,
      { allowWithoutContact: true }
    );

    expect(vendorId).toBeNull();
    expect(createSpendVendor).not.toHaveBeenCalled();
  });
});

describe("describeMissingVendorFields — contact optional", () => {
  it("does not ask for a contact email when the contact is optional", () => {
    const message = describeMissingVendorFields(
      { ...achSupplier, country: null },
      { contactOptional: true }
    );

    expect(message).not.toContain("a contact email");
    expect(message).toContain("a country");
  });
});

describe("RampIntegrationMetadataSchema — allowVendorsWithoutContact", () => {
  const credentials = { type: "oauth2" as const, accessToken: "token" };

  it("is off when the setting has never been saved", () => {
    expect(
      RampIntegrationMetadataSchema.parse({ credentials })
        .allowVendorsWithoutContact
    ).toBe(false);
  });

  it('is on only for an explicit "true"', () => {
    expect(
      RampIntegrationMetadataSchema.parse({
        credentials,
        allowVendorsWithoutContact: "true"
      }).allowVendorsWithoutContact
    ).toBe(true);
    expect(
      RampIntegrationMetadataSchema.parse({
        credentials,
        allowVendorsWithoutContact: "false"
      }).allowVendorsWithoutContact
    ).toBe(false);
  });
});
