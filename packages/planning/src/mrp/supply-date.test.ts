// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  jobCompletionDate,
  purchaseOrderLineArrivalDate
} from "./supply-date.ts";

const TODAY = "2026-10-01";

describe("purchaseOrderLineArrivalDate", () => {
  it("uses the supplier's promised date when there is one", () => {
    expect(
      purchaseOrderLineArrivalDate(
        {
          promisedDate: "2026-11-20",
          dueDate: "2026-11-01",
          orderDate: "2026-10-01",
          leadTime: 5
        },
        TODAY
      )
    ).toBe("2026-11-20");
  });

  it("uses the required date when nothing is promised — the field planning writes", () => {
    expect(
      purchaseOrderLineArrivalDate(
        { promisedDate: null, dueDate: "2026-11-01", orderDate: "2026-10-01" },
        TODAY
      )
    ).toBe("2026-11-01");
  });

  it("falls back to order date + lead time", () => {
    expect(
      purchaseOrderLineArrivalDate(
        { orderDate: "2026-10-10", leadTime: 14 },
        TODAY
      )
    ).toBe("2026-10-24");
  });

  it("assumes 7 days when the item has no lead time, and 0 means 0", () => {
    expect(
      purchaseOrderLineArrivalDate({ orderDate: "2026-10-10" }, TODAY)
    ).toBe("2026-10-17");
    expect(
      purchaseOrderLineArrivalDate(
        { orderDate: "2026-10-10", leadTime: 0 },
        TODAY
      )
    ).toBe("2026-10-10");
  });

  it("counts from today when the order has no date yet", () => {
    expect(purchaseOrderLineArrivalDate({ leadTime: 3 }, TODAY)).toBe(
      "2026-10-04"
    );
  });
});

// The reschedule check skipped a job with no due date while the projection
// counted it as supply, so the two saw different supply and the job itself
// was never offered a Cancel, Defer or Expedite.
describe("jobCompletionDate", () => {
  it("uses the job's due date", () => {
    expect(
      jobCompletionDate(
        { dueDate: "2026-11-20", deadlineType: "No Deadline" },
        TODAY
      )
    ).toBe("2026-11-20");
  });

  it("assumes 30 days out for an undated No Deadline job", () => {
    expect(
      jobCompletionDate({ dueDate: null, deadlineType: "No Deadline" }, TODAY)
    ).toBe("2026-10-31");
  });

  it("assumes today for any other undated job", () => {
    expect(
      jobCompletionDate({ dueDate: null, deadlineType: "ASAP" }, TODAY)
    ).toBe(TODAY);
    expect(jobCompletionDate({}, TODAY)).toBe(TODAY);
  });
});
