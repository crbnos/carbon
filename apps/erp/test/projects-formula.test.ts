// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  evaluateFormula,
  parseParameterFormula
} from "~/modules/projects/projects.models";

function evaluate(text: string, values: Record<string, number>) {
  const parsed = parseParameterFormula(text);
  if (!("ast" in parsed)) throw new Error(parsed.error);
  return evaluateFormula(parsed.ast, (id) => values[id] ?? null);
}

describe("parseParameterFormula", () => {
  it("parses a subtraction and lists its refs", () => {
    const parsed = parseParameterFormula("= SNS-7 - SNS-9");
    expect(parsed).toMatchObject({ refs: ["SNS-7", "SNS-9"] });
  });

  it("evaluates max and a product", () => {
    expect(
      evaluate("= max(SNS-3, SNS-4) * 1.2", { "SNS-3": 10, "SNS-4": 20 })
    ).toEqual({ value: 24, reason: null });
  });

  it("evaluates unary minus over a parenthesis", () => {
    expect(evaluate("= -(2 + 3) / 5", {})).toEqual({ value: -1, reason: null });
  });

  it("gives null with a reason on a division by zero", () => {
    const result = evaluate("= SNS-1 / 0", { "SNS-1": 4 });
    expect(result.value).toBeNull();
    expect(result.reason).toBe("Division by zero");
  });

  it("refuses an unknown character and names its position", () => {
    expect(parseParameterFormula("= SNS-1; drop")).toMatchObject({
      position: 7
    });
  });

  it("refuses a formula without =", () => {
    expect(parseParameterFormula("SNS-1 + 1")).toHaveProperty("error");
  });
});
