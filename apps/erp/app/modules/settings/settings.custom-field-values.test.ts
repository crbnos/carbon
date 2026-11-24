// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { DataType } from "~/modules/shared/types";
import {
  type CustomFieldType,
  refusedCustomFieldKeys
} from "./settings.service";

const field = (dataTypeId: DataType, listOptions: string[] | null = null) => ({
  id: "field",
  dataTypeId,
  listOptions
});

// No record read: a refused key is refused outright.
const refusedFor = (
  dataTypeId: DataType,
  value: unknown,
  listOptions: string[] | null = null
) =>
  refusedCustomFieldKeys(
    { field: value },
    [field(dataTypeId, listOptions)],
    []
  );

describe("refusedCustomFieldKeys", () => {
  // Each value is one the properties panel's input for that type sends.
  it.each([
    [DataType.Boolean, "on"],
    [DataType.Boolean, ""],
    [DataType.Date, "2026-11-24"],
    [DataType.Date, null],
    [DataType.Numeric, 12.5],
    [DataType.Numeric, "12.5"],
    [DataType.Numeric, null],
    [DataType.Text, ""],
    [DataType.Text, "Red"],
    [DataType.Link, "https://example.com/datasheet"],
    [DataType.Link, ""],
    [DataType.User, "user-1"],
    [DataType.Customer, "customer-1"],
    [DataType.Supplier, "supplier-1"]
  ])("takes the data type %i value %j", (dataTypeId, value) => {
    expect(refusedFor(dataTypeId, value)).toEqual([]);
  });

  it.each([
    [DataType.Boolean, true],
    [DataType.Boolean, "yes"],
    [DataType.Date, "2026-02-30"],
    [DataType.Date, "2026-11-24T10:00:00Z"],
    [DataType.Numeric, { amount: 3 }],
    [DataType.Numeric, [3]],
    [DataType.Numeric, ""],
    [DataType.Numeric, "12 units"],
    [DataType.Numeric, Number.NaN],
    [DataType.Text, 12],
    [DataType.Text, null],
    [DataType.Link, "javascript:alert(1)"],
    [DataType.User, ""],
    [DataType.Customer, 7],
    [DataType.File, "file.pdf"]
  ])("refuses the data type %i value %j", (dataTypeId, value) => {
    expect(refusedFor(dataTypeId, value)).toEqual(["field"]);
  });

  it("takes only one of a list field's options, or null", () => {
    const options = ["Red", "Blue"];
    expect(refusedFor(DataType.List, "Blue", options)).toEqual([]);
    expect(refusedFor(DataType.List, null, options)).toEqual([]);
    expect(refusedFor(DataType.List, "Green", options)).toEqual(["field"]);
  });

  it("refuses a key that is not one of the table's fields", () => {
    expect(
      refusedCustomFieldKeys(
        { field: "Red", other: "x" },
        [field(DataType.Text)],
        []
      )
    ).toEqual(["other"]);
  });

  // The panel posts the whole stored map back with one value changed.
  it("keeps a value every record already holds, whatever its shape", () => {
    const fields: CustomFieldType[] = [field(DataType.Boolean)];
    const sent = { field: true, retired: { kept: 1 } };
    expect(
      refusedCustomFieldKeys(sent, fields, [
        { field: true, retired: { kept: 1 } },
        { field: true, retired: { kept: 1 } }
      ])
    ).toEqual([]);
  });

  it("refuses a value one record does not hold", () => {
    expect(
      refusedCustomFieldKeys(
        { field: true },
        [field(DataType.Boolean)],
        [{ field: true }, { field: "on" }]
      )
    ).toEqual(["field"]);
  });
});
