// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/content/glossary", () => ({
  glossaryEntries: () => [],
  terms: {}
}));

import { projectValidator } from "../app/modules/projects/projects.models";

describe("projectValidator", () => {
  it("trims the project name and optional description", () => {
    const result = projectValidator.safeParse({
      name: "  Apollo Expansion  ",
      description: "  Customer expansion program  ",
      costTreatment: "Statistical"
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        name: "Apollo Expansion",
        description: "Customer expansion program"
      });
    }
  });

  it("rejects a name that is only whitespace", () => {
    expect(
      projectValidator.safeParse({ name: "   ", costTreatment: "Statistical" })
        .success
    ).toBe(false);
  });

  it("normalizes an empty description to undefined", () => {
    const result = projectValidator.safeParse({
      name: "Apollo Expansion",
      description: "",
      costTreatment: "Statistical"
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBeUndefined();
  });

  it("needs a CIP class for a Capitalize project", () => {
    expect(
      projectValidator.safeParse({
        name: "Line 4 expansion",
        costTreatment: "Capitalize"
      }).success
    ).toBe(false);
    expect(
      projectValidator.safeParse({
        name: "Line 4 expansion",
        costTreatment: "Capitalize",
        fixedAssetClassId: "fac-cip"
      }).success
    ).toBe(true);
  });
});
