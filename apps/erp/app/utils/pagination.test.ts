// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The @carbon/auth barrel does not load under vitest.
vi.mock("@carbon/auth", () => ({ parseNumberFromUrlParam: vi.fn() }));

const { pageBounds } = await import("./pagination");

describe("pageBounds", () => {
  const page = (count: number, offset: number, rowsOnPage: number) =>
    pageBounds({ count, offset, pageSize: 100, rowsOnPage });

  it("ends on a short page or where an exact count says the list stops", () => {
    expect(page(5000, 300, 20).canNextPage).toBe(false);
    expect(page(200, 100, 100).canNextPage).toBe(false);
  });

  it("does not trust an estimate that equals the rows seen", () => {
    expect(page(1500, 1400, 100).canNextPage).toBe(true);
  });

  it("keeps going past a low estimate while pages come back full", () => {
    expect(page(300, 300, 100)).toEqual({ canNextPage: true, count: 400 });
  });
});
