// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { stemInflection } from "./search";

describe("stemInflection", () => {
  it("strips inflections", () => {
    expect(stemInflection("orders")).toBe("order");
    expect(stemInflection("ordered")).toBe("order");
    expect(stemInflection("scrapping")).toBe("scrap");
    expect(stemInflection("shipped")).toBe("ship");
  });

  it("gives singular, plural and past forms one stem", () => {
    const stems = ["invoice", "invoices", "invoiced"].map(stemInflection);
    expect(new Set(stems).size).toBe(1);
  });

  it("leaves words Porter would over-stem alone", () => {
    expect(stemInflection("customer")).toBe("customer");
    expect(stemInflection("shipment")).toBe("shipment");
    expect(stemInflection("operations")).toBe("operations");
  });
});
