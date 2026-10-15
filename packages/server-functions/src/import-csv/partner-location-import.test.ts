// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  addressValues,
  classifyPartnerLocationRow,
  type ExistingLocation,
  partnerLocationKey
} from "./partner-location-import";

describe("addressValues", () => {
  it("sets the mapped columns, a blank cell to NULL, and leaves the rest out", () => {
    expect(
      addressValues({
        locationName: "Dock 2",
        addressLine1: " 12 Harbour Road ",
        addressLine2: "",
        state: "Ontario",
        // An unmapped enum column arrives as undefined.
        countryCode: undefined
      })
    ).toEqual({
      addressLine1: "12 Harbour Road",
      addressLine2: null,
      stateProvince: "Ontario"
    });
    expect(addressValues({ locationName: "Dock 2" })).toEqual({});
  });
});

describe("classifyPartnerLocationRow", () => {
  const existing = new Map<string, ExistingLocation[]>([
    [
      partnerLocationKey("cus-1", "Main Plant"),
      [{ id: "loc-1", addressId: "addr-1" }]
    ],
    [
      partnerLocationKey("cus-1", "Warehouse"),
      [
        { id: "loc-2", addressId: "addr-2" },
        { id: "loc-3", addressId: "addr-3" }
      ]
    ]
  ]);
  const classify = (
    record: Record<string, string>,
    seenKeys = new Set<string>()
  ) =>
    classifyPartnerLocationRow({
      table: "customerLocation",
      record,
      existing,
      countryCodes: new Set(["CA", "US"]),
      seenKeys
    });

  it("inserts a new location with its address", () => {
    expect(
      classify({
        customerId: "cus-1",
        locationName: " East Yard ",
        city: "Hamilton",
        countryCode: "CA"
      })
    ).toEqual({
      action: "insert",
      partnerId: "cus-1",
      name: "East Yard",
      address: { city: "Hamilton", countryCode: "CA" },
      key: partnerLocationKey("cus-1", "east yard")
    });
  });

  it("updates the address of the location with that name, ignoring case", () => {
    expect(
      classify({
        customerId: "cus-1",
        locationName: "main plant",
        city: "Toronto",
        phone: ""
      })
    ).toEqual({
      action: "update",
      addressId: "addr-1",
      address: { city: "Toronto", phone: null },
      key: partnerLocationKey("cus-1", "Main Plant")
    });
    // Same name, another customer: a new location.
    expect(
      classify({ customerId: "cus-2", locationName: "Main Plant" })
    ).toMatchObject({ action: "insert" });
  });

  it("skips a known location when the file carries no address columns", () => {
    expect(
      classify({ customerId: "cus-1", locationName: "Main Plant" })
    ).toEqual({
      action: "skip",
      category: "skipped",
      reason: 'Location "Main Plant" already exists'
    });
  });

  it("refuses an ambiguous name, a repeat in the file and an unknown country", () => {
    expect(
      classify({ customerId: "cus-1", locationName: "WAREHOUSE", city: "X" })
    ).toEqual({
      action: "skip",
      category: "error",
      reason: 'More than one location of this customer is named "WAREHOUSE"'
    });
    expect(
      classify(
        { customerId: "cus-1", locationName: "East Yard" },
        new Set([partnerLocationKey("cus-1", "East Yard")])
      )
    ).toMatchObject({
      category: "error",
      reason: 'Duplicate location "East Yard" for this customer in file'
    });
    expect(
      classify({
        customerId: "cus-1",
        locationName: "East Yard",
        countryCode: "ZZ"
      })
    ).toMatchObject({ category: "error", reason: 'Country "ZZ" not found' });
  });

  it("needs the partner and a location name", () => {
    expect(classify({ locationName: "East Yard" })).toMatchObject({
      reason: "Missing required Customer"
    });
    expect(classify({ customerId: "cus-1", locationName: " " })).toMatchObject({
      reason: "Missing required Location Name"
    });
    expect(
      classifyPartnerLocationRow({
        table: "supplierLocation",
        record: { locationName: "Dock" },
        existing: new Map(),
        countryCodes: new Set(),
        seenKeys: new Set()
      })
    ).toMatchObject({ reason: "Missing required Supplier" });
  });
});
