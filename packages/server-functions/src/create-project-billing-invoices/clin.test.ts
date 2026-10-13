// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { acrnPositions, planClinSections } from "./clin";

type Line = {
  key: string;
  customerContractLineId: string;
  quantity: number;
  unitPrice: number;
};

const line = (
  key: string,
  customerContractLineId: string,
  amount: number
): Line => ({ key, customerContractLineId, quantity: 1, unitPrice: amount });

const keys = (
  sections: ReturnType<typeof planClinSections<Line>>["sections"]
) =>
  sections.map((section) =>
    section.type === "comment"
      ? `comment:${section.description}`
      : section.line.key
  );

describe("planClinSections", () => {
  it("puts a comment line before each CLIN's lines, in number order", () => {
    const { sections } = planClinSections(
      [
        line("b1", "lineB", 100),
        line("a1", "lineA", 50),
        line("b2", "lineB", 25)
      ],
      [
        { id: "lineA", lineItemNumber: "0002", description: "Test support" },
        { id: "lineB", lineItemNumber: "0001", description: "Engineering" }
      ],
      new Map(),
      { decimalPlaces: 2 }
    );
    expect(keys(sections)).toEqual([
      "comment:CLIN 0001 — Engineering: 125.00",
      "b1",
      "b2",
      "comment:CLIN 0002 — Test support: 50.00",
      "a1"
    ]);
  });

  it("allocates a CLIN's amount to its ACRNs, oldest funds first", () => {
    const acrns = acrnPositions(
      [
        {
          customerContractLineId: "lineA",
          acrn: "AB",
          fundedDate: "2026-03-01",
          fundedCost: 40000,
          fundedFee: 0
        },
        {
          customerContractLineId: "lineA",
          acrn: "AA",
          fundedDate: "2026-01-01",
          fundedCost: 9000,
          fundedFee: 1000
        }
      ],
      []
    );
    const { sections, allocations } = planClinSections(
      [line("a1", "lineA", 12345)],
      [{ id: "lineA", lineItemNumber: "0001", description: "Engineering" }],
      acrns,
      { decimalPlaces: 2 }
    );
    expect(allocations).toEqual([
      { customerContractLineId: "lineA", acrn: "AA", amount: 10000 },
      { customerContractLineId: "lineA", acrn: "AB", amount: 2345 }
    ]);
    expect(keys(sections)[0]).toBe(
      "comment:CLIN 0001 — Engineering: 12,345.00 (ACRN AA 10,000.00; ACRN AB 2,345.00)"
    );
  });

  it("counts what earlier invoices allocated to an ACRN", () => {
    const acrns = acrnPositions(
      [
        {
          customerContractLineId: "lineA",
          acrn: "AA",
          fundedDate: "2026-01-01",
          fundedCost: 10000,
          fundedFee: 0
        },
        {
          customerContractLineId: "lineA",
          acrn: "AB",
          fundedDate: "2026-02-01",
          fundedCost: 10000,
          fundedFee: 0
        }
      ],
      [{ customerContractLineId: "lineA", acrn: "AA", amount: 9000 }]
    );
    const { allocations } = planClinSections(
      [line("a1", "lineA", 3000)],
      [{ id: "lineA", lineItemNumber: "0001", description: "Engineering" }],
      acrns,
      { decimalPlaces: 2 }
    );
    expect(allocations).toEqual([
      { customerContractLineId: "lineA", acrn: "AA", amount: 1000 },
      { customerContractLineId: "lineA", acrn: "AB", amount: 2000 }
    ]);
  });

  it("gives no comment line and no allocation to lines with no number", () => {
    const lines = [line("a1", "lineA", 100), line("b1", "lineB", 50)];
    const { sections, allocations } = planClinSections(
      lines,
      [
        { id: "lineA", lineItemNumber: null, description: "Engineering" },
        { id: "lineB", lineItemNumber: null, description: "Test support" }
      ],
      new Map(),
      { decimalPlaces: 2 }
    );
    expect(keys(sections)).toEqual(["a1", "b1"]);
    expect(allocations).toEqual([]);
  });
});
