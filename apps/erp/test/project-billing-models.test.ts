// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// sales.models loads @carbon/onboarding, which builds Lingui `msg`
// descriptors at module load; the macro is not transformed under plain
// vitest (as in sales.models.test.ts).
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

vi.mock("@carbon/content/glossary", () => ({
  glossaryEntries: () => [],
  terms: {}
}));

const { billableItemActionValidator } = await import(
  "../app/modules/projects/projects.models"
);
const { contractLaborRateValidator, customerContractLineValidator } =
  await import("../app/modules/sales/sales.models");

const fixedLine = {
  customerContractId: "con_1",
  revenueType: "One-time",
  itemId: "item_1",
  quantity: 1,
  rate: 0,
  discountPercent: 0,
  taxPercent: 0,
  startDate: "2026-01-01",
  revenueMethod: "Daily"
};

describe("billableItemActionValidator", () => {
  it("refuses a write-off with no reason", () => {
    const result = billableItemActionValidator.safeParse({
      ids: ["pbi_1"],
      action: "writeOff"
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["reason"]);
    }
  });

  it("accepts a write-off with a reason", () => {
    const result = billableItemActionValidator.safeParse({
      ids: ["pbi_1", "pbi_2"],
      action: "writeOff",
      reason: "Rework at our cost"
    });
    expect(result.success).toBe(true);
  });

  it("refuses a price edit with no price or on two items", () => {
    expect(
      billableItemActionValidator.safeParse({ ids: ["pbi_1"], action: "price" })
        .success
    ).toBe(false);
    expect(
      billableItemActionValidator.safeParse({
        ids: ["pbi_1", "pbi_2"],
        action: "price",
        unitPrice: 150
      }).success
    ).toBe(false);
  });

  it("releases with no reason", () => {
    expect(
      billableItemActionValidator.safeParse({
        ids: ["pbi_1"],
        action: "release"
      }).success
    ).toBe(true);
  });
});

describe("customerContractLineValidator billing lines", () => {
  it("defaults a line to Fixed with the notice defaults", () => {
    const result = customerContractLineValidator.safeParse(fixedLine);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.billingMethod).toBe("Fixed");
      expect(result.data.noticePercent).toBe(75);
      expect(result.data.noticeWindowDays).toBe(60);
    }
  });

  it("refuses a Cost Plus line with no fee", () => {
    const result = customerContractLineValidator.safeParse({
      ...fixedLine,
      billingMethod: "Cost Plus",
      revenueMethod: "Percent Complete",
      projectId: "proj_1",
      projectElementId: "pe_1"
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toEqual([
        ["feePercent"]
      ]);
    }
  });

  it("refuses a billing line with no billing element", () => {
    const result = customerContractLineValidator.safeParse({
      ...fixedLine,
      billingMethod: "Time & Materials",
      revenueMethod: "Right to Invoice",
      projectId: "proj_1"
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["projectElementId"]);
    }
  });

  it("refuses a revenue method the billing method does not allow", () => {
    const tm = customerContractLineValidator.safeParse({
      ...fixedLine,
      billingMethod: "Time & Materials",
      revenueMethod: "Percent Complete",
      projectId: "proj_1",
      projectElementId: "pe_1"
    });
    expect(tm.success).toBe(false);

    const fixed = customerContractLineValidator.safeParse({
      ...fixedLine,
      revenueMethod: "Right to Invoice"
    });
    expect(fixed.success).toBe(false);
  });

  it("allows a Fixed Percent Complete line only with a billing element", () => {
    expect(
      customerContractLineValidator.safeParse({
        ...fixedLine,
        revenueMethod: "Percent Complete"
      }).success
    ).toBe(false);
    expect(
      customerContractLineValidator.safeParse({
        ...fixedLine,
        revenueMethod: "Percent Complete",
        projectId: "proj_1",
        projectElementId: "pe_1"
      }).success
    ).toBe(true);
  });

  it("keeps the notice percent within 75 to 85", () => {
    expect(
      customerContractLineValidator.safeParse({
        ...fixedLine,
        noticePercent: 90
      }).success
    ).toBe(false);
  });
});

describe("contractLaborRateValidator", () => {
  it("needs exactly one of a labor category and an employee", () => {
    const base = {
      customerContractLineId: "conl_1",
      billRate: 160,
      effectiveFrom: "2026-01-01"
    };
    expect(contractLaborRateValidator.safeParse(base).success).toBe(false);
    expect(
      contractLaborRateValidator.safeParse({
        ...base,
        laborCategoryId: "lc_1",
        employeeId: "user_1"
      }).success
    ).toBe(false);
    expect(
      contractLaborRateValidator.safeParse({ ...base, laborCategoryId: "lc_1" })
        .success
    ).toBe(true);
  });
});
