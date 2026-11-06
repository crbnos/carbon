// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { rovingTabStopId } from "./utils";

describe("rovingTabStopId", () => {
  it("is the selected row while it is rendered", () => {
    expect(rovingTabStopId(["a", "b", "c"], "b")).toBe("b");
  });

  it("is the first rendered row when nothing is selected", () => {
    expect(rovingTabStopId(["a", "b"], undefined)).toBe("a");
  });

  it("is the first rendered row when the selected row is not rendered", () => {
    expect(rovingTabStopId(["d", "e"], "a")).toBe("d");
  });

  it("is nothing for an empty tree", () => {
    expect(rovingTabStopId([], "a")).toBeUndefined();
  });
});
