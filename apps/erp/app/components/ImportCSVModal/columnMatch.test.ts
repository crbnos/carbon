// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { matchColumnsExactly, mergeSuggestedColumns } from "./columnMatch";

const fields = {
  name: { label: "Name" },
  processType: { label: "Process Type" },
  defaultStandardFactor: { label: "Default Unit" }
};

describe("matchColumnsExactly", () => {
  it("matches a header to a field's label or name, ignoring case and spaces", () => {
    expect(
      matchColumnsExactly(fields, [" name ", "processtype", "Notes"])
    ).toEqual({ name: " name ", processType: "processtype" });
  });

  it("prefers the label when both the label and the name are columns", () => {
    expect(
      matchColumnsExactly(fields, ["processType", "Process Type"])
    ).toEqual({ processType: "Process Type" });
  });

  it("matches the fields it can when others have no column", () => {
    expect(matchColumnsExactly(fields, ["Name", "Unit"])).toEqual({
      name: "Name"
    });
  });
});

describe("mergeSuggestedColumns", () => {
  const fileColumns = ["Name", "Type of process", "Unit"];

  it("keeps every mapped field and fills only the unmapped ones", () => {
    expect(
      mergeSuggestedColumns({
        current: { name: "Name" },
        suggested: {
          name: "Unit",
          processType: "Type of process",
          defaultStandardFactor: "Unit"
        },
        fileColumns
      })
    ).toEqual({
      name: "Name",
      processType: "Type of process",
      defaultStandardFactor: "Unit"
    });
  });

  it("keeps the mapped fields when the AI returns nothing usable", () => {
    expect(
      mergeSuggestedColumns({
        current: { name: "Name" },
        suggested: {},
        fileColumns
      })
    ).toEqual({ name: "Name" });
  });

  it("skips a column that is not in the file, such as N/A", () => {
    expect(
      mergeSuggestedColumns({
        current: {},
        suggested: { processType: "N/A", defaultStandardFactor: "Units" },
        fileColumns
      })
    ).toEqual({});
  });

  it("skips a column that another field is already mapped to", () => {
    expect(
      mergeSuggestedColumns({
        current: { name: "Name" },
        suggested: { processType: "Name" },
        fileColumns
      })
    ).toEqual({ name: "Name" });
  });

  it("keeps a column the user picked, None included", () => {
    expect(
      mergeSuggestedColumns({
        current: { processType: "None" },
        suggested: { processType: "Type of process" },
        fileColumns
      })
    ).toEqual({ processType: "None" });
  });
});
