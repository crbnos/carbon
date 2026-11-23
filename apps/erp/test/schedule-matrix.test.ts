// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { resolveMatrixDrop } from "../app/components/ScheduleMatrix/resolveMatrixDrop";

const monday = { rowId: "emp-1", date: "2026-10-19" };
const tuesday = { rowId: "emp-1", date: "2026-10-20" };
const chip = { chipId: "pasn-1", from: monday };

describe("resolveMatrixDrop", () => {
  it("moves a chip to another cell", () => {
    expect(resolveMatrixDrop(chip, { to: tuesday })).toEqual({
      chipId: "pasn-1",
      from: monday,
      to: tuesday
    });
    // the same day for another person is another cell too
    const otherPerson = { rowId: "emp-2", date: monday.date };
    expect(resolveMatrixDrop(chip, { to: otherPerson })?.to).toEqual(
      otherPerson
    );
  });

  it("makes no move when the chip is dropped back on its own cell", () => {
    expect(resolveMatrixDrop(chip, { to: { ...monday } })).toBeNull();
    expect(
      resolveMatrixDrop(
        { chipId: "job-1", from: "outside" },
        { to: "outside" }
      )
    ).toBeNull();
  });

  it("makes no move on a disabled cell", () => {
    expect(resolveMatrixDrop(chip, { to: tuesday, disabled: true })).toBeNull();
  });

  it("makes no move when dropped on nothing", () => {
    expect(resolveMatrixDrop(chip, null)).toBeNull();
    expect(resolveMatrixDrop(chip, undefined)).toBeNull();
    expect(resolveMatrixDrop(null, { to: tuesday })).toBeNull();
  });

  it("reports a chip leaving the side panel as from outside", () => {
    expect(
      resolveMatrixDrop({ chipId: "job-1", from: "outside" }, { to: tuesday })
    ).toEqual({ chipId: "job-1", from: "outside", to: tuesday });
  });
});
