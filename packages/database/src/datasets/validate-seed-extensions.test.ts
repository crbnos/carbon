// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { satellite } from "./data/satellite/index.ts";
import type { Dataset, ItemSpec, PartyAddressSpec } from "./types.ts";
import { validateDataset } from "./validate.ts";

const ECCN = "Export classification (ECCN)";

// A copy of satellite with one buy part carrying values and one customer
// carrying an address override. Only the touched arrays are copied: the
// dataset holds functions structuredClone refuses.
function withExtensions(
  values: ItemSpec["customFieldValues"],
  address?: PartyAddressSpec
): Dataset {
  const [firstPart, ...otherParts] = satellite.items.buyParts;
  const [firstCustomer, ...otherCustomers] = satellite.foundation.customers;
  return {
    ...satellite,
    foundation: {
      ...satellite.foundation,
      customers: [{ ...firstCustomer!, address }, ...otherCustomers]
    },
    items: {
      ...satellite.items,
      buyParts: [{ ...firstPart!, customFieldValues: values }, ...otherParts]
    }
  };
}

const extensionViolations = (dataset: Dataset) =>
  validateDataset(dataset).filter(
    (v) => v.includes("customFieldValues") || v.includes("address.countryCode")
  );

const OSLO: PartyAddressSpec = {
  addressLine1: "1 Example Gate",
  city: "Oslo",
  stateProvince: "Oslo",
  postalCode: "0150",
  countryCode: "NO"
};

describe("seed extensions", () => {
  it("accepts a value on a defined part field and a valid country", () => {
    expect(
      extensionViolations(withExtensions({ [ECCN]: "9A515" }, OSLO))
    ).toEqual([]);
  });

  it("rejects a value for a field the dataset does not define", () => {
    const violations = extensionViolations(
      withExtensions({ "No such field": "x" })
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('"No such field"');
  });

  it("rejects a List value that is not one of the field's options", () => {
    const listField = {
      table: "part",
      name: "Export jurisdiction",
      dataType: "List" as const,
      listOptions: ["ITAR", "EAR", "EAR99"]
    };
    const base = withExtensions({ "Export jurisdiction": "Classified" });
    const dataset = {
      ...base,
      ops: { ...base.ops, customFields: [...base.ops.customFields, listField] }
    };
    const violations = extensionViolations(dataset);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(
      '"Classified" is not one of its listOptions'
    );
  });

  it("rejects a country code that is not 2 upper-case letters", () => {
    const violations = extensionViolations(
      withExtensions(undefined, { ...OSLO, countryCode: "usa" })
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('"usa"');
  });
});
