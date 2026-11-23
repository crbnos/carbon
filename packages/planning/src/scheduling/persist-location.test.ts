// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { jobsClearingReservations } from "./persist-location.ts";

describe("jobsClearingReservations", () => {
  it("is every job the run wrote plus every job that failed, once each", () => {
    expect(
      jobsClearingReservations(
        [{ jobId: "job-a" }, { jobId: "job-b" }],
        ["job-c", "job-a"]
      )
    ).toEqual(["job-a", "job-b", "job-c"]);
  });

  it("still names a failed job when no job wrote", () => {
    expect(jobsClearingReservations([], ["job-c"])).toEqual(["job-c"]);
  });
});
