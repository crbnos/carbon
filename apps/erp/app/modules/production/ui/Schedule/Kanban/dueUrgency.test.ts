// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { getBatchDueUrgency, getDueUrgency } from "./dueUrgency";

const TODAY = "2026-10-05";

describe("getDueUrgency", () => {
  it("is late when the scheduler flagged a conflict, whatever the date", () => {
    expect(
      getDueUrgency({ hasConflict: true, dueDate: "2026-12-01" }, TODAY)
    ).toBe("late");
  });

  it("is late once the due date has passed, even without a conflict", () => {
    expect(getDueUrgency({ dueDate: "2026-10-04" }, TODAY)).toBe("late");
    expect(getDueUrgency({ dueDate: "2026-09-21" }, TODAY)).toBe("late");
  });

  it("is due soon for today and tomorrow", () => {
    expect(getDueUrgency({ dueDate: "2026-10-05" }, TODAY)).toBe("dueSoon");
    expect(getDueUrgency({ dueDate: "2026-10-06" }, TODAY)).toBe("dueSoon");
  });

  it("is nothing two days out, without a deadline, or once finished", () => {
    expect(getDueUrgency({ dueDate: "2026-10-07" }, TODAY)).toBeNull();
    expect(
      getDueUrgency(
        { dueDate: "2026-10-05", deadlineType: "No Deadline" },
        TODAY
      )
    ).toBeNull();
    expect(
      getDueUrgency({ dueDate: "2026-10-05", status: "Done" }, TODAY)
    ).toBeNull();
    expect(
      getDueUrgency({ dueDate: "2026-09-21", status: "Done" }, TODAY)
    ).toBeNull();
    expect(getDueUrgency({ dueDate: null }, TODAY)).toBeNull();
  });

  it("ignores a due date left on an ASAP job", () => {
    // Only Hard and Soft Deadline carry a due date (deadlineRequiresDueDate);
    // an ASAP job can still hold a stale one.
    expect(
      getDueUrgency({ dueDate: "2026-09-21", deadlineType: "ASAP" }, TODAY)
    ).toBeNull();
    expect(
      getDueUrgency({ dueDate: "2026-10-05", deadlineType: "ASAP" }, TODAY)
    ).toBeNull();
    expect(
      getDueUrgency(
        { hasConflict: true, dueDate: "2026-09-21", deadlineType: "ASAP" },
        TODAY
      )
    ).toBe("late");
  });

  it("crosses a month boundary", () => {
    expect(getDueUrgency({ dueDate: "2026-11-01" }, "2026-10-31")).toBe(
      "dueSoon"
    );
  });
});

describe("getBatchDueUrgency", () => {
  it("takes the most urgent member", () => {
    expect(
      getBatchDueUrgency(
        [{ dueDate: "2026-12-01" }, { dueDate: "2026-10-06" }],
        TODAY
      )
    ).toBe("dueSoon");
    expect(
      getBatchDueUrgency(
        [{ dueDate: "2026-10-06" }, { hasConflict: true }],
        TODAY
      )
    ).toBe("late");
    expect(
      getBatchDueUrgency(
        [{ dueDate: "2026-10-06" }, { dueDate: "2026-09-21" }],
        TODAY
      )
    ).toBe("late");
    expect(getBatchDueUrgency([{ dueDate: "2026-12-01" }], TODAY)).toBeNull();
  });
});
