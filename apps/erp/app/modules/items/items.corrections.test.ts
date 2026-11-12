// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  methodCorrectionTriggerValidator,
  methodCorrectionValidator
} from "./items.models";

describe("methodCorrectionValidator", () => {
  const base = {
    makeMethodId: "mm_1",
    name: "Re-torque nut",
    returnTo: "Re-inspect"
  };

  it("accepts a correction with no attempt limit", () => {
    const result = methodCorrectionValidator.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data?.maxAttempts).toBeUndefined();
  });

  it("accepts a whole positive attempt limit from a form", () => {
    const result = methodCorrectionValidator.safeParse({
      ...base,
      maxAttempts: "3"
    });
    expect(result.data?.maxAttempts).toBe(3);
  });

  it("refuses a zero or fractional attempt limit", () => {
    expect(
      methodCorrectionValidator.safeParse({ ...base, maxAttempts: "0" }).success
    ).toBe(false);
    expect(
      methodCorrectionValidator.safeParse({ ...base, maxAttempts: "1.5" })
        .success
    ).toBe(false);
  });

  it("refuses an unknown return rule and a blank name", () => {
    expect(
      methodCorrectionValidator.safeParse({ ...base, returnTo: "Skip" }).success
    ).toBe(false);
    expect(
      methodCorrectionValidator.safeParse({ ...base, name: "  " }).success
    ).toBe(false);
  });
});

describe("methodCorrectionTriggerValidator", () => {
  it("maps a list value", () => {
    const result = methodCorrectionTriggerValidator.safeParse({
      methodOperationStepId: "step_1",
      methodCorrectionId: "mcor_1",
      listValue: "Too loose"
    });
    expect(result.success).toBe(true);
  });

  it("maps a measurement condition", () => {
    const result = methodCorrectionTriggerValidator.safeParse({
      methodOperationStepId: "step_1",
      methodCorrectionId: "mcor_1",
      measurementCondition: "Above Maximum"
    });
    expect(result.success).toBe(true);
  });

  it("clears a mapping when no correction is given", () => {
    const result = methodCorrectionTriggerValidator.safeParse({
      methodOperationStepId: "step_1",
      methodCorrectionId: "",
      listValue: "Too loose"
    });
    expect(result.success).toBe(true);
    expect(result.data?.methodCorrectionId).toBeUndefined();
  });

  it("needs exactly one of a list value and a measurement condition", () => {
    expect(
      methodCorrectionTriggerValidator.safeParse({
        methodOperationStepId: "step_1",
        methodCorrectionId: "mcor_1"
      }).success
    ).toBe(false);
    expect(
      methodCorrectionTriggerValidator.safeParse({
        methodOperationStepId: "step_1",
        methodCorrectionId: "mcor_1",
        listValue: "Too loose",
        measurementCondition: "Below Minimum"
      }).success
    ).toBe(false);
  });
});
