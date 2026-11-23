// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { buildMissingTimeEvents } from "./timesheet-missing-time";

describe("buildMissingTimeEvents", () => {
  it("notifies each employee, and each manager once with their employees", () => {
    const events = buildMissingTimeEvents([
      {
        companyId: "c1",
        employeeId: "u1",
        date: "2026-10-09",
        managerId: "m1",
        employeeName: "Zoe Park"
      },
      {
        companyId: "c1",
        employeeId: "u2",
        date: "2026-10-09",
        managerId: "m1",
        employeeName: "Ann Lee"
      },
      {
        companyId: "c1",
        employeeId: "u3",
        date: "2026-10-09",
        managerId: null,
        employeeName: "No Manager"
      }
    ]);

    expect(
      events.map((event) => [event.data.recipient, event.data.body])
    ).toEqual([
      [{ type: "users", userIds: ["u1"] }, "No time entered for Oct 9, 2026"],
      [{ type: "users", userIds: ["u2"] }, "No time entered for Oct 9, 2026"],
      [{ type: "users", userIds: ["u3"] }, "No time entered for Oct 9, 2026"],
      [
        { type: "users", userIds: ["m1"] },
        "No time entered for Oct 9, 2026: Ann Lee, Zoe Park"
      ]
    ]);
    expect(
      events.every((event) => event.data.documentId === "2026-10-09")
    ).toBe(true);
  });
});
