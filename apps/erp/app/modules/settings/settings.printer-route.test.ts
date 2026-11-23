// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { printerRouteValidator } from "@carbon/printing";
import { describe, expect, it } from "vitest";

// Form-shaped input: every field arrives as a string, like the route action's.
const route = (overrides: Record<string, string> = {}) =>
  printerRouteValidator.safeParse({
    name: "Zebra",
    format: "zpl",
    mediaSizeId: "label2x1",
    printerUrl: "https://pbx.example.com/api/v1/print/1",
    ...overrides
  });

describe("printerRouteValidator dpi", () => {
  it("reads the posted 300 as the number 300", () => {
    expect(route({ dpi: "300" }).data?.dpi).toBe(300);
  });

  it("refuses a density no printer runs at", () => {
    expect(route({ dpi: "250" }).success).toBe(false);
  });

  // A PDF printer's form has no dpi field; an absent dpi keeps the saved one.
  it("leaves dpi out when the form sends none", () => {
    const result = route({ format: "pdf", mediaSizeId: "" });
    expect(result.success).toBe(true);
    expect(result.data?.dpi).toBeUndefined();
  });
});
