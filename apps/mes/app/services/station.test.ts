// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { resolveStation } from "./station";

const TODAY = "2026-10-03";

describe("resolveStation", () => {
  it("is nothing at all when the operator has no assignment", () => {
    for (const assignment of [null, undefined]) {
      expect(
        resolveStation({ assignment, overrideDate: null, today: TODAY })
      ).toEqual({ applied: null, mine: null });
    }
  });

  it("applies the station when it has not been dismissed", () => {
    expect(
      resolveStation({
        assignment: { workCenterId: "wc_qc" },
        overrideDate: null,
        today: TODAY
      })
    ).toEqual({
      applied: { workCenterId: "wc_qc", name: "" },
      mine: { workCenterId: "wc_qc", name: "" }
    });
  });

  it("stops applying it once dismissed, but still reports it", () => {
    // `applied` going null is what keeps web's chip from reappearing with a ✕
    // that does nothing. `mine` staying set is what lets the mobile board
    // offer the station as a filter to switch back ON.
    expect(
      resolveStation({
        assignment: { workCenterId: "wc_qc" },
        overrideDate: TODAY,
        today: TODAY
      })
    ).toEqual({
      applied: null,
      mine: { workCenterId: "wc_qc", name: "" }
    });
  });

  it("applies it again the next day", () => {
    // The dismissal is a DATE, not a flag: yesterday's does not carry over.
    expect(
      resolveStation({
        assignment: { workCenterId: "wc_qc" },
        overrideDate: "2026-10-02",
        today: TODAY
      }).applied
    ).toEqual({ workCenterId: "wc_qc", name: "" });
  });

  it("returns two distinct objects, so naming one cannot name the other", () => {
    // Both are filled in afterwards from the work-center list. Sharing one
    // object made that a single assignment, and a station that was offered
    // but not applied would have taken the applied one's name.
    const { applied, mine } = resolveStation({
      assignment: { workCenterId: "wc_qc" },
      overrideDate: null,
      today: TODAY
    });
    expect(applied).not.toBe(mine);
  });
});
