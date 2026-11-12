// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type OperationLabelInput,
  shouldPrintOperationLabel,
  shouldPrintTravelers
} from "./travelers.ts";

describe("shouldPrintTravelers", () => {
  it.each([
    ["Draft", "In Progress", true],
    ["Completed", "In Progress", false],
    ["Partial", "In Progress", false],
    ["Draft", "Cancelled", false]
  ] as const)("%s to %s prints travelers: %s", (previous, next, expected) => {
    expect(shouldPrintTravelers(previous, next)).toBe(expected);
  });
});

function base(
  overrides: Partial<OperationLabelInput> = {}
): OperationLabelInput {
  return {
    isFirstOperation: false,
    isLastOperation: false,
    isTopLevelMakeMethod: true,
    travelerLabels: false,
    printLabelOnCompletion: false,
    ...overrides
  };
}

describe("shouldPrintOperationLabel", () => {
  it("prints at the first operation when travelers carry no label", () => {
    expect(shouldPrintOperationLabel(base({ isFirstOperation: true }))).toBe(
      true
    );
  });

  it("skips the first operation when travelers carry the label", () => {
    expect(
      shouldPrintOperationLabel(
        base({ isFirstOperation: true, travelerLabels: true })
      )
    ).toBe(false);
  });

  it("prints at the last top-level operation with the completion flag", () => {
    expect(
      shouldPrintOperationLabel(
        base({ isLastOperation: true, printLabelOnCompletion: true })
      )
    ).toBe(true);
  });

  it("skips the last sub-assembly operation even with the completion flag", () => {
    expect(
      shouldPrintOperationLabel(
        base({
          isLastOperation: true,
          isTopLevelMakeMethod: false,
          printLabelOnCompletion: true
        })
      )
    ).toBe(false);
  });

  it("prints on a single-operation routing with both settings on", () => {
    expect(
      shouldPrintOperationLabel(
        base({
          isFirstOperation: true,
          isLastOperation: true,
          travelerLabels: true,
          printLabelOnCompletion: true
        })
      )
    ).toBe(true);
  });
});
