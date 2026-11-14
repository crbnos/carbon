// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  rescheduledFromToday,
  withDatesInStep,
  withStartDate
} from "../app/modules/production/ui/Planning/suggested-order-dates";

const TODAY = "2026-11-05";
const LEAD = 7;

const order = (overrides: object = {}) => ({
  quantity: 5,
  startDate: "2026-10-25",
  dueDate: "2026-11-01",
  isASAP: true,
  ...overrides
});

describe("withStartDate", () => {
  it("moves a late order to start today and be due a lead time later", () => {
    expect(withStartDate(order(), TODAY, LEAD, TODAY)).toEqual({
      quantity: 5,
      startDate: "2026-11-05",
      dueDate: "2026-11-12",
      isASAP: false
    });
  });

  it("keeps an order ASAP while its start is still before today", () => {
    expect(withStartDate(order(), "2026-11-04", LEAD, TODAY).isASAP).toBe(true);
  });

  it("adds no ASAP flag to an order that has none", () => {
    expect(
      withStartDate({ quantity: 1, dueDate: null }, TODAY, LEAD, TODAY)
    ).toEqual({ quantity: 1, startDate: TODAY, dueDate: "2026-11-12" });
  });
});

describe("rescheduledFromToday", () => {
  it("starts a late ASAP order today, due a lead time later, and keeps it ASAP", () => {
    expect(rescheduledFromToday(order(), LEAD, TODAY)).toEqual({
      quantity: 5,
      startDate: TODAY,
      dueDate: "2026-11-12",
      isASAP: true
    });
  });

  it("does not make an order ASAP that was not", () => {
    expect(
      rescheduledFromToday(order({ isASAP: false }), LEAD, TODAY).isASAP
    ).toBe(false);
  });

  it("adds no flag to a purchase order, which has none", () => {
    expect(
      rescheduledFromToday({ quantity: 1, dueDate: null }, LEAD, TODAY)
    ).not.toHaveProperty("isASAP");
  });
});

describe("withDatesInStep", () => {
  it("moves the due date with an edited start date", () => {
    const [edited] = withDatesInStep(
      [order({ startDate: "2026-11-20" })],
      [order()],
      LEAD,
      TODAY
    );
    expect(edited).toMatchObject({
      startDate: "2026-11-20",
      dueDate: "2026-11-27",
      isASAP: false
    });
  });

  it("moves the start date with an edited due date", () => {
    const [edited] = withDatesInStep(
      [order({ dueDate: "2026-11-30" })],
      [order()],
      LEAD,
      TODAY
    );
    expect(edited).toMatchObject({
      startDate: "2026-11-23",
      dueDate: "2026-11-30",
      isASAP: false
    });
  });

  it("leaves rows whose dates did not change, and rows that are new", () => {
    const unchanged = order({ quantity: 9 });
    const added = order({ startDate: "2026-12-01", dueDate: "2026-12-01" });
    expect(
      withDatesInStep([unchanged, added], [order()], LEAD, TODAY)
    ).toEqual([unchanged, added]);
  });
});
