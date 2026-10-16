// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { processIdsByName, resolveProcessNames } from "./work-center-processes";

const byName = processIdsByName([
  { id: "p_cut", name: "Laser Cutting" },
  { id: "p_weld", name: "Welding" },
  { id: "p_paint_1", name: "Painting" },
  { id: "p_paint_2", name: "painting " }
]);

describe("resolveProcessNames", () => {
  it("leaves the processes alone when the cell is blank", () => {
    expect(resolveProcessNames(undefined, byName)).toBeNull();
    expect(resolveProcessNames(" , ", byName)).toBeNull();
  });

  it("resolves names case- and whitespace-insensitively, without repeats", () => {
    expect(
      resolveProcessNames(" laser cutting,WELDING, Laser Cutting", byName)
    ).toEqual({ processIds: ["p_cut", "p_weld"] });
  });

  it("refuses a name that matches no active process", () => {
    expect(resolveProcessNames("Welding, Anodizing", byName)).toEqual({
      error: 'Process "Anodizing" was not found among active processes'
    });
  });

  it("refuses a name that matches several processes", () => {
    expect(resolveProcessNames("Painting", byName)).toEqual({
      error: 'Process "Painting" matches more than one process'
    });
  });
});
