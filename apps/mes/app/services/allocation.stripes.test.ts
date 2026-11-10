// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { keepEntitiesInStripes } from "./allocation";

const stripeById: Record<string, string | null> = {
  A: null,
  B: "prj_1",
  C: "prj_2",
  D: null,
  E: "prj_1"
};
const stripeOf = (id: string) => stripeById[id] ?? null;
const entities = ["A", "B", "C", "D", "E"].map((id) => ({ id }));

describe("keepEntitiesInStripes", () => {
  it("lists the project's lots first, then common lots, and drops other projects", () => {
    const kept = keepEntitiesInStripes(entities, stripeOf, ["prj_1", null]);
    expect(kept.map((entity) => entity.id)).toEqual(["B", "E", "A", "D"]);
  });

  it("lists only common lots for a job without project stock", () => {
    const kept = keepEntitiesInStripes(entities, stripeOf, [null]);
    expect(kept.map((entity) => entity.id)).toEqual(["A", "D"]);
  });
});
