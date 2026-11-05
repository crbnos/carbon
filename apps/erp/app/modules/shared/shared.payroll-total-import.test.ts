// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { readPayrollTotalRow } from "./payroll-total-import";

const USER = "system";

const record = (overrides: Record<string, string> = {}) => ({
  employeeId: USER,
  periodStart: "2026-03-01",
  periodEnd: "2026-03-15",
  grossWages: "4,200.00",
  hoursPaid: "80",
  ...overrides
});

describe("readPayrollTotalRow", () => {
  it("reads amounts with thousands separators", () => {
    expect(readPayrollTotalRow(record())).toEqual({
      row: {
        employeeId: USER,
        periodStart: "2026-03-01",
        periodEnd: "2026-03-15",
        grossWages: 4200,
        hoursPaid: 80
      }
    });
  });

  it("refuses a period that ends before it starts", () => {
    expect(readPayrollTotalRow(record({ periodEnd: "2026-02-28" }))).toEqual({
      error: "Period End is before Period Start"
    });
  });

  it("refuses a date that is not YYYY-MM-DD or not a real day", () => {
    expect(readPayrollTotalRow(record({ periodStart: "03/01/2026" }))).toEqual({
      error: "Period Start must be a date as YYYY-MM-DD"
    });
    expect(readPayrollTotalRow(record({ periodEnd: "2026-02-30" }))).toEqual({
      error: "Period End must be a date as YYYY-MM-DD"
    });
  });

  it("refuses negative wages and hours", () => {
    expect(readPayrollTotalRow(record({ grossWages: "-1" }))).toEqual({
      error: "Gross Wages must be a number of 0 or more"
    });
    expect(readPayrollTotalRow(record({ hoursPaid: "" }))).toEqual({
      error: "Hours Paid must be a number of 0 or more"
    });
  });
});
