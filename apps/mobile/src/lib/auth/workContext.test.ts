// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The store half of the module touches AsyncStorage, which is a native module
// vitest cannot load; only the pure choosers are under test here.
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));

const { chooseCompany, chooseLocation, parseWorkContexts } = await import(
  "./workContext"
);

const DESKS = { id: "co_desks", name: "jacob desks" };
const CYCLES = { id: "co_cycles", name: "Northspoke Cycles" };

describe("chooseCompany", () => {
  it("takes the only company an account has", () => {
    expect(chooseCompany([CYCLES], null)).toBe("co_cycles");
  });

  it("never guesses between several", () => {
    // The real case: this account's first company by name has no work centres
    // at all, and the web opens the other one. A silent pick showed a working,
    // empty board for the wrong company.
    expect(chooseCompany([DESKS, CYCLES], null)).toBeNull();
  });

  it("returns to the company that was chosen before", () => {
    expect(
      chooseCompany([DESKS, CYCLES], {
        companyId: "co_cycles",
        locationId: null
      })
    ).toBe("co_cycles");
  });

  it("drops a remembered company the account no longer belongs to", () => {
    // A different person signing in on a shared device, or a membership that
    // was removed: the stored id must not survive as the working company.
    expect(
      chooseCompany([DESKS, CYCLES], { companyId: "co_gone", locationId: null })
    ).toBeNull();
    expect(
      chooseCompany([CYCLES], { companyId: "co_gone", locationId: null })
    ).toBe("co_cycles");
  });

  it("is null for an account with no company at all", () => {
    expect(chooseCompany([], null)).toBeNull();
  });
});

describe("chooseLocation", () => {
  const me = {
    locations: [
      { id: "loc_hq", name: "Headquarters", companyId: "co_cycles" },
      { id: "loc_wh", name: "Eastside Warehouse", companyId: "co_cycles" }
    ],
    defaultLocationId: "loc_hq"
  };

  it("is null until a company is chosen", () => {
    expect(chooseLocation(me, null, null)).toBeNull();
  });

  it("is null when the payload was read for a different company", () => {
    // `/me` reports ONE company's locations. Falling back to "the first" here
    // would hand company A's location id to company B's queries.
    expect(chooseLocation(me, "co_desks", null)).toBeNull();
  });

  it("opens on the employee's default, as the web shell does", () => {
    expect(chooseLocation(me, "co_cycles", null)).toBe("loc_hq");
  });

  it("returns to the remembered location", () => {
    expect(
      chooseLocation(me, "co_cycles", {
        companyId: "co_cycles",
        locationId: "loc_wh"
      })
    ).toBe("loc_wh");
  });

  it("ignores a location remembered for another company", () => {
    expect(
      chooseLocation(me, "co_cycles", {
        companyId: "co_desks",
        locationId: "loc_wh"
      })
    ).toBe("loc_hq");
  });

  it("ignores a remembered location that no longer exists", () => {
    expect(
      chooseLocation(me, "co_cycles", {
        companyId: "co_cycles",
        locationId: "loc_closed"
      })
    ).toBe("loc_hq");
  });

  it("falls back to the first location when the default is not this company's", () => {
    expect(
      chooseLocation(
        { ...me, defaultLocationId: "loc_elsewhere" },
        "co_cycles",
        null
      )
    ).toBe("loc_hq");
    expect(
      chooseLocation({ ...me, defaultLocationId: null }, "co_cycles", null)
    ).toBe("loc_hq");
  });
});

describe("parseWorkContexts", () => {
  it("reads a stored map", () => {
    expect(
      parseWorkContexts('{"inst":{"companyId":"c","locationId":"l"}}')
    ).toEqual({ inst: { companyId: "c", locationId: "l" } });
  });

  it("is empty for nothing, rubbish, or the wrong shape", () => {
    expect(parseWorkContexts(null)).toEqual({});
    expect(parseWorkContexts("not json")).toEqual({});
    expect(parseWorkContexts("[]")).toEqual({});
    expect(parseWorkContexts("null")).toEqual({});
  });

  it("nulls fields that are not strings rather than trusting them", () => {
    expect(
      parseWorkContexts('{"a":{"companyId":7,"locationId":"l"},"b":"x"}')
    ).toEqual({ a: { companyId: null, locationId: "l" } });
  });
});
