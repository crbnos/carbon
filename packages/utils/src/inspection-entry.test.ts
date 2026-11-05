// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  defaultInspectionGridLayout,
  formatSpecLabel,
  formatToleranceLimits,
  isMultiCellPaste,
  parseAttributeToken,
  parseClipboardGrid,
  parseMeasurementToken,
  passAllTargets,
  planPaste
} from "./inspection-entry";

describe("defaultInspectionGridLayout", () => {
  it("puts parts down the page once samples outnumber characteristics", () => {
    expect(
      defaultInspectionGridLayout({ sampleCount: 125, characteristicCount: 8 })
    ).toBe("byPart");
    expect(
      defaultInspectionGridLayout({ sampleCount: 5, characteristicCount: 12 })
    ).toBe("byCharacteristic");
    expect(
      defaultInspectionGridLayout({ sampleCount: 4, characteristicCount: 4 })
    ).toBe("byCharacteristic");
  });
});

describe("formatToleranceLimits", () => {
  it("writes both limits at the plan's precision, with the unit", () => {
    expect(
      formatToleranceLimits(
        { nominal: 10, lower: 9.9, upper: 10.1, decimals: 2 },
        "mm"
      )
    ).toBe("9.90 – 10.10 mm");
    expect(
      formatToleranceLimits({ nominal: 5, lower: 4, upper: 6, decimals: 0 })
    ).toBe("4 – 6");
  });
});

describe("formatSpecLabel", () => {
  it("writes nominal, tolerance and unit without doubled signs", () => {
    expect(
      formatSpecLabel({
        nominalValue: "10",
        tolerancePlus: "+0.1",
        toleranceMinus: "-0.05",
        unit: "mm"
      })
    ).toBe("10 +0.1/−0.05 mm");
    expect(
      formatSpecLabel({
        nominalValue: "No burrs",
        tolerancePlus: null,
        toleranceMinus: null
      })
    ).toBe("No burrs");
  });
});

describe("parseClipboardGrid", () => {
  it("splits a spreadsheet copy into rows of tab-separated cells", () => {
    expect(parseClipboardGrid("10.01\t10.02\r\n9.99\t\r\n")).toEqual([
      ["10.01", "10.02"],
      ["9.99", ""]
    ]);
  });

  it("tells a block from a single value", () => {
    expect(isMultiCellPaste(parseClipboardGrid("10.01"))).toBe(false);
    expect(isMultiCellPaste(parseClipboardGrid("10.01\n10.02"))).toBe(true);
    expect(isMultiCellPaste(parseClipboardGrid("10.01\t10.02"))).toBe(true);
  });
});

describe("parseMeasurementToken", () => {
  it.each([
    ["10.05", 10.05],
    [" +10.05 ", 10.05],
    ["-0.5", -0.5],
    ["10,05", 10.05],
    ["1,234.5", 1234.5],
    [".5", 0.5],
    ["1e-3", 0.001]
  ])("reads %s as %d", (token, value) => {
    expect(parseMeasurementToken(token)).toBe(value);
  });

  it.each(["", "abc", "10.0.1", "1,2,3", "10mm"])("rejects %s", (token) =>
    expect(parseMeasurementToken(token)).toBeNull()
  );
});

describe("parseAttributeToken", () => {
  it.each(["P", "pass", "OK", "1", "✓"])("reads %s as a pass", (token) =>
    expect(parseAttributeToken(token)).toBe(true)
  );
  it.each(["F", "Fail", "NG", "0", "x"])("reads %s as a fail", (token) =>
    expect(parseAttributeToken(token)).toBe(false)
  );
  it("is null for anything else", () => {
    expect(parseAttributeToken("maybe")).toBeNull();
  });
});

describe("planPaste", () => {
  const base = (overrides: Partial<Parameters<typeof planPaste>[0]> = {}) =>
    planPaste({
      grid: [
        ["a", "b"],
        ["c", ""]
      ],
      layout: "byCharacteristic",
      origin: { characteristicIndex: 0, sampleIndex: 0 },
      characteristicCount: 5,
      sampleLimit: 10,
      ...overrides
    });

  it("runs rows down the characteristics by characteristic", () => {
    expect(base()).toEqual({
      cells: [
        { characteristicIndex: 0, sampleIndex: 0, token: "a" },
        { characteristicIndex: 1, sampleIndex: 0, token: "c" },
        { characteristicIndex: 0, sampleIndex: 1, token: "b" }
      ],
      outOfRange: 0
    });
  });

  it("runs rows down the samples by part", () => {
    expect(
      base({
        layout: "byPart",
        origin: { characteristicIndex: 2, sampleIndex: 3 }
      })
    ).toEqual({
      cells: [
        { characteristicIndex: 2, sampleIndex: 3, token: "a" },
        { characteristicIndex: 3, sampleIndex: 3, token: "b" },
        { characteristicIndex: 2, sampleIndex: 4, token: "c" }
      ],
      outOfRange: 0
    });
  });

  it("counts cells past the grid's edge instead of keeping them", () => {
    expect(
      base({
        origin: { characteristicIndex: 4, sampleIndex: 9 }
      })
    ).toEqual({
      cells: [{ characteristicIndex: 4, sampleIndex: 9, token: "a" }],
      outOfRange: 2
    });
  });
});

describe("passAllTargets", () => {
  it("fills only empty cells among the first max(n, samples) columns", () => {
    expect(
      passAllTargets({
        statuses: ["Passed", undefined, "Failed", "Pending", undefined],
        sampleSize: 3,
        existingSamples: 4,
        columnCount: 5
      })
    ).toEqual([1, 3]);
  });

  it("never reaches past the columns the grid shows", () => {
    expect(
      passAllTargets({
        statuses: [],
        sampleSize: 8,
        existingSamples: 0,
        columnCount: 2
      })
    ).toEqual([0, 1]);
  });
});
