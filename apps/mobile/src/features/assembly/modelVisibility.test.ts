// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblyPlaybackStep } from "@carbon/mes-core";
import { describe, expect, it } from "vitest";
import {
  instanceNamesFor,
  MAX_INSTANCES,
  mentionedNodeIds,
  visibleNodeIds
} from "./modelVisibility";

const step = (
  id: string,
  componentNodeIds: string[],
  hiddenComponentNodeIds: string[] = []
): AssemblyPlaybackStep => ({
  id,
  componentNodeIds,
  hiddenComponentNodeIds,
  isSubAssembly: false,
  motion: null
});

// The shape of the real radial-engine instruction: crankcase, then the rod,
// then the cover over it.
const STEPS = [
  step("s1", ["crankcase"]),
  step("s2", ["rod", "piston"]),
  step("s3", ["cover"], ["rod"])
];

describe("visibleNodeIds", () => {
  it("shows only the first step's parts at the start", () => {
    expect(visibleNodeIds(STEPS, 0)).toEqual(new Set(["crankcase"]));
  });

  it("builds the model up as the operator works down the steps", () => {
    expect(visibleNodeIds(STEPS, 1)).toEqual(
      new Set(["crankcase", "rod", "piston"])
    );
  });

  it("applies the active step's own hidden list", () => {
    // The cover goes on and the rod it covers is taken out of the way.
    expect(visibleNodeIds(STEPS, 2)).toEqual(
      new Set(["crankcase", "piston", "cover"])
    );
  });

  it("does not apply a later step's hidden list early", () => {
    expect(visibleNodeIds(STEPS, 1).has("rod")).toBe(true);
  });

  it("does not keep an earlier step's part hidden once it is past", () => {
    const steps = [
      step("s1", ["a"]),
      step("s2", ["b"], ["a"]),
      step("s3", ["c"])
    ];
    expect(visibleNodeIds(steps, 2).has("a")).toBe(true);
  });

  it("clamps an index past the end to the fully built model", () => {
    // The procedure and the instruction are different lists; more procedure
    // steps than playback steps is ordinary.
    expect(visibleNodeIds(STEPS, 99)).toEqual(visibleNodeIds(STEPS, 2));
  });

  it("clamps a negative index to the first step", () => {
    expect(visibleNodeIds(STEPS, -5)).toEqual(visibleNodeIds(STEPS, 0));
  });

  it("is empty when the instruction has no steps", () => {
    expect(visibleNodeIds([], 0)).toEqual(new Set());
  });
});

describe("mentionedNodeIds", () => {
  it("covers installed and hidden parts alike", () => {
    expect(mentionedNodeIds(STEPS)).toEqual(
      new Set(["crankcase", "rod", "piston", "cover"])
    );
  });

  it("is empty for no steps, so nothing is hidden", () => {
    expect(mentionedNodeIds([])).toEqual(new Set());
  });
});

describe("instanceNamesFor", () => {
  it("yields the bare id first, then suffixed instances", () => {
    const it_ = instanceNamesFor("abc");
    expect([it_.next().value, it_.next().value, it_.next().value]).toEqual([
      "abc",
      "abc#1",
      "abc#2"
    ]);
  });

  it("is bounded, so a model that always resolves cannot spin", () => {
    expect([...instanceNamesFor("abc")]).toHaveLength(MAX_INSTANCES);
  });

  it("covers the 48 spokes of a real wheel", () => {
    expect([...instanceNamesFor("spoke")].length).toBeGreaterThan(48);
  });
});
