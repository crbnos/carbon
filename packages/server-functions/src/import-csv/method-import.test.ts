// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { componentsFirst } from "./method-import";

const usesFrom = (uses: Record<string, string[]>) => (key: string) =>
  uses[key] ?? [];

describe("componentsFirst", () => {
  it("writes a component listed after its assembly first", () => {
    expect(
      componentsFirst(
        ["ASSY", "GASKET", "BOLT"],
        usesFrom({ ASSY: ["BOLT", "GASKET", "STOCKED-NUT"] })
      )
    ).toEqual(["BOLT", "GASKET", "ASSY"]);
  });

  it("orders sub-assemblies at any depth", () => {
    expect(
      componentsFirst(
        ["TOP", "SUB", "LEAF"],
        usesFrom({ TOP: ["SUB"], SUB: ["LEAF"] })
      )
    ).toEqual(["LEAF", "SUB", "TOP"]);
  });

  it("keeps file order when nothing in the file is used", () => {
    expect(componentsFirst(["B", "A", "C"], usesFrom({}))).toEqual([
      "B",
      "A",
      "C"
    ]);
  });

  it("writes each part once when several parts share a component", () => {
    expect(
      componentsFirst(
        ["A", "B", "SHARED"],
        usesFrom({ A: ["SHARED"], B: ["SHARED"] })
      )
    ).toEqual(["SHARED", "A", "B"]);
  });

  it("does not loop on parts that use each other or themselves", () => {
    expect(
      componentsFirst(["A", "B"], usesFrom({ A: ["B", "A"], B: ["A"] }))
    ).toEqual(["B", "A"]);
  });
});
