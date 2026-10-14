// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { resolveResponsibleEmployee } from "./responsible-employee";

describe("resolveResponsibleEmployee", () => {
  it("item overrides group, location, and company", () => {
    expect(
      resolveResponsibleEmployee({
        item: "item-owner",
        itemGroup: "group-owner",
        location: "location-owner",
        company: "company-owner"
      })
    ).toBe("item-owner");
  });

  it("location-specific item group beats location and company", () => {
    expect(
      resolveResponsibleEmployee({
        item: null,
        itemGroup: "group-owner",
        location: "location-owner",
        company: "company-owner"
      })
    ).toBe("group-owner");
  });

  it("location beats company", () => {
    expect(
      resolveResponsibleEmployee({
        item: null,
        itemGroup: null,
        location: "location-owner",
        company: "company-owner"
      })
    ).toBe("location-owner");
  });

  it("falls back to the company default", () => {
    expect(
      resolveResponsibleEmployee({
        item: null,
        itemGroup: null,
        location: null,
        company: "company-owner"
      })
    ).toBe("company-owner");
  });

  it("returns null (Unassigned) when every rung is empty", () => {
    expect(
      resolveResponsibleEmployee({
        item: null,
        itemGroup: null,
        location: null,
        company: null
      })
    ).toBeNull();
  });
});
