// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// shared.utils' graph loads @carbon/content/glossary, whose module-load Lingui
// `msg` macro is not transformed under plain vitest.
vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const { invoicedChargeFraction } = await import("./shared.utils");

describe("invoicedChargeFraction", () => {
  it("bills a flat charge once across partial invoices", () => {
    const addOn = 50;
    const first = addOn * invoicedChargeFraction(4, 10);
    const second = addOn * invoicedChargeFraction(6, 10);
    expect(first + second).toBe(addOn);
  });

  it("bills the whole charge on a full invoice", () => {
    expect(invoicedChargeFraction(10, 10)).toBe(1);
  });

  it("never bills more than the whole charge", () => {
    expect(invoicedChargeFraction(12, 10)).toBe(1);
  });

  it("bills the whole charge when no quantity was ordered", () => {
    expect(invoicedChargeFraction(1, 0)).toBe(1);
    expect(invoicedChargeFraction(1, null)).toBe(1);
  });
});
