// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { suggestProjectIdentifier } from "~/modules/projects/projects.models";

// The same 4 inputs give the same base in the SQL function
// derive_project_identifier (migration *_projects-backfill.sql).
describe("suggestProjectIdentifier", () => {
  it("takes the initials of each word", () => {
    expect(suggestProjectIdentifier("Star Tracker")).toBe("ST");
  });

  it("splits words on whitespace only", () => {
    expect(suggestProjectIdentifier("next-gen sensor")).toBe("NS");
  });

  it("prefixes P when the identifier does not start with a letter", () => {
    expect(suggestProjectIdentifier("9 axis gimbal")).toBe("P9AG");
  });

  it("pads a single character with X", () => {
    expect(suggestProjectIdentifier("a")).toBe("AX");
  });
});
