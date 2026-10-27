// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { completeJobOperationBatchValidator } from "./models";

function parse(members: Record<string, unknown>[]) {
  return completeJobOperationBatchValidator.safeParse({
    batchId: "bat_1",
    members
  });
}

describe("completeJobOperationBatchValidator", () => {
  it("parses per-member form strings into numbers", () => {
    expect(
      parse([
        { jobOperationId: "op_1", quantity: "7", scrapQuantity: "1" },
        { jobOperationId: "op_2", quantity: "20" }
      ]).data?.members
    ).toEqual([
      { jobOperationId: "op_1", quantity: 7, scrapQuantity: 1 },
      { jobOperationId: "op_2", quantity: 20 }
    ]);
  });

  it("keeps fractional quantities, rounded to internal precision", () => {
    // Operation quantities can be fractional for weight/length units of measure.
    expect(
      parse([
        { jobOperationId: "op_1", quantity: 0.123456, scrapQuantity: 0.25 }
      ]).data?.members
    ).toEqual([
      { jobOperationId: "op_1", quantity: 0.12346, scrapQuantity: 0.25 }
    ]);
  });

  it.each([
    { name: "no members", members: [] },
    {
      name: "a negative quantity",
      members: [{ jobOperationId: "op_1", quantity: -1 }]
    }
  ])("rejects $name", ({ members }) => {
    expect(parse(members).success).toBe(false);
  });

  it("accepts an excluded member whose disabled quantity input was not submitted", () => {
    expect(
      parse([
        { jobOperationId: "op_1", quantity: 5, excluded: "" },
        { jobOperationId: "op_2", excluded: "true" }
      ]).data?.members
    ).toEqual([
      { jobOperationId: "op_1", quantity: 5 },
      { jobOperationId: "op_2", excluded: "true" }
    ]);
  });
});
