// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { planPrune } from "./prune.js";

const slots = {
  live: { worktreeRoot: "/work/live" },
  gone: { worktreeRoot: "/work/gone" }
};
const exists = (path: string) => path === "/work/live";

describe("planPrune", () => {
  it("prunes a slot whose directory is gone, even with no stack left", () => {
    expect(planPrune(slots, [], { exists })).toEqual({
      deadSlugs: ["gone"],
      projects: ["carbon-gone"]
    });
  });

  it("prunes a stack with no slot and keeps a live one", () => {
    const stacks = ["carbon-live", "carbon-gone", "carbon-stray"];
    expect(planPrune(slots, stacks, { exists }).projects).toEqual([
      "carbon-gone",
      "carbon-stray"
    ]);
  });

  it("takes live stacks too with all, but only releases dead slots", () => {
    expect(planPrune(slots, ["carbon-live"], { exists, all: true })).toEqual({
      deadSlugs: ["gone"],
      projects: ["carbon-gone", "carbon-live"]
    });
  });

  it("finds nothing when every stack has a live slot", () => {
    expect(
      planPrune({ live: slots.live }, ["carbon-live"], { exists })
    ).toEqual({
      deadSlugs: [],
      projects: []
    });
  });
});
