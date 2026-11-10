// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, describe, expect, it, vi } from "vitest";
import { employeeCompanyIds, setAppBadge } from "./app-badge";

describe("employeeCompanyIds", () => {
  it("keeps only the companies the user works in", () => {
    expect(
      employeeCompanyIds([
        { companyId: "c1", role: "employee" },
        { companyId: "c2", role: "customer" },
        { companyId: "c3", role: "supplier" },
        { companyId: null, role: "employee" },
        { companyId: "c4", role: "employee" }
      ])
    ).toEqual(["c1", "c4"]);
  });
});

describe("setAppBadge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubNavigator() {
    const badge = {
      setAppBadge: vi.fn(() => Promise.resolve()),
      clearAppBadge: vi.fn(() => Promise.resolve())
    };
    vi.stubGlobal("navigator", badge);
    return badge;
  }

  it("shows a count above zero", () => {
    const badge = stubNavigator();
    setAppBadge(3);
    expect(badge.setAppBadge).toHaveBeenCalledWith(3);
    expect(badge.clearAppBadge).not.toHaveBeenCalled();
  });

  it("clears the badge at zero, rather than showing a dot", () => {
    const badge = stubNavigator();
    setAppBadge(0);
    expect(badge.clearAppBadge).toHaveBeenCalled();
    expect(badge.setAppBadge).not.toHaveBeenCalled();
  });

  it("does nothing where the browser has no badge", () => {
    vi.stubGlobal("navigator", {});
    expect(() => setAppBadge(3)).not.toThrow();
  });

  it("swallows a refusal", async () => {
    vi.stubGlobal("navigator", {
      setAppBadge: () => Promise.reject(new Error("NotAllowedError")),
      clearAppBadge: () => Promise.resolve()
    });
    expect(() => setAppBadge(3)).not.toThrow();
    // Let the rejection settle: an unhandled one would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
