// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  cutoverPaymentAdjustment,
  invoicePostedBefore,
  lesseeScheduleHasPaid
} from "./lease-payments";

const rent = (periodStart: string, periodEnd: string, dueDate: string) => ({
  periodStart,
  periodEnd,
  dueDate,
  paymentType: "Rent" as const
});

describe("lesseeScheduleHasPaid", () => {
  // Monthly rent from 2026-01-15; the line for the lease month ending
  // 2026-06-14 is the last one before a 2026-06-20 cutover.
  const paidThrough = { periodDate: "2026-06-14", isLastLine: false };
  const commencementDate = "2026-01-15";

  it("pays an advance row at the start of its month", () => {
    const june = rent("2026-05-15", "2026-06-14", "2026-05-15");
    const july = rent("2026-06-15", "2026-07-14", "2026-06-15");
    expect(
      lesseeScheduleHasPaid({
        payment: june,
        commencementDate,
        timing: "Advance",
        paidThrough
      })
    ).toBe(true);
    // Due before the cutover, but its month's line comes after it.
    expect(
      lesseeScheduleHasPaid({
        payment: july,
        commencementDate,
        timing: "Advance",
        paidThrough
      })
    ).toBe(false);
  });

  it("pays an arrears row at the end of its month", () => {
    const june = rent("2026-05-15", "2026-06-14", "2026-06-14");
    const july = rent("2026-06-15", "2026-07-14", "2026-07-14");
    expect(
      lesseeScheduleHasPaid({
        payment: june,
        commencementDate,
        timing: "Arrears",
        paidThrough
      })
    ).toBe(true);
    expect(
      lesseeScheduleHasPaid({
        payment: july,
        commencementDate,
        timing: "Arrears",
        paidThrough
      })
    ).toBe(false);
  });

  it("pays a short last arrears row with the month before it, as the schedule does", () => {
    // Commenced 2026-01-01, ends 2027-01-15: the stub is due on its last
    // day, but the schedule takes it off at the end of December.
    const stub = rent("2027-01-01", "2027-01-15", "2027-01-15");
    expect(
      lesseeScheduleHasPaid({
        payment: stub,
        commencementDate: "2026-01-01",
        timing: "Arrears",
        paidThrough: { periodDate: "2026-12-31", isLastLine: false }
      })
    ).toBe(true);
  });

  it("pays nothing before the first line, and everything by the last", () => {
    const first = rent("2026-01-15", "2026-02-14", "2026-01-15");
    expect(
      lesseeScheduleHasPaid({
        payment: first,
        commencementDate,
        timing: "Advance",
        paidThrough: null
      })
    ).toBe(false);
    expect(
      lesseeScheduleHasPaid({
        payment: { ...first, paymentType: "Purchase Option" },
        commencementDate,
        timing: "Advance",
        paidThrough: { periodDate: "2026-02-14", isLastLine: true }
      })
    ).toBe(true);
  });
});

describe("invoicePostedBefore", () => {
  it("is a posted invoice dated before the cutover", () => {
    expect(
      invoicePostedBefore(
        { status: "Open", postingDate: "2026-06-01" },
        "2026-06-20"
      )
    ).toBe(true);
    expect(
      invoicePostedBefore(
        { status: "Paid", postingDate: "2026-06-20" },
        "2026-06-20"
      )
    ).toBe(false);
    expect(
      invoicePostedBefore({ status: "Draft", postingDate: null }, "2026-06-20")
    ).toBe(false);
    expect(
      invoicePostedBefore(
        { status: "Voided", postingDate: "2026-06-01" },
        "2026-06-20"
      )
    ).toBe(false);
    expect(invoicePostedBefore(null, "2026-06-20")).toBe(false);
  });
});

describe("cutoverPaymentAdjustment", () => {
  it("adds back a payment the schedule took off and no invoice has yet", () => {
    expect(
      cutoverPaymentAdjustment([
        { amount: 1000, paidBySchedule: true, settledBeforeCutover: false },
        { amount: 1000, paidBySchedule: true, settledBeforeCutover: true }
      ])
    ).toBe(1000);
  });

  it("takes off a payment invoiced before the schedule reached it", () => {
    expect(
      cutoverPaymentAdjustment([
        { amount: 1000, paidBySchedule: false, settledBeforeCutover: true },
        { amount: 1000, paidBySchedule: false, settledBeforeCutover: false }
      ])
    ).toBe(-1000);
  });
});
