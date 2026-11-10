// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { RUN_PAGES, runPage } from "./runPages";

describe("runPage", () => {
  it("gives each run type the page that owns its runs", () => {
    expect(runPage("Lease")).toBe("accounting.leases");
    expect(runPage("Revenue Recognition")).toBe(
      "accounting.revenueRecognition"
    );
  });

  it("has a page for every run type the app lists", () => {
    for (const type of Object.keys(RUN_PAGES) as (keyof typeof RUN_PAGES)[])
      expect(runPage(type)).toBeDefined();
  });
});
