// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { defaultView, stepView } from "./stepCamera";

const CENTER: [number, number, number] = [0, 0, 0];

describe("stepView", () => {
  it("applies a manual pose verbatim — a person chose it", () => {
    const pose = { position: [1, 2, 3], target: [4, 5, 6], fov: 45 };
    expect(stepView(pose, CENTER, 100)).toEqual({
      position: [1, 2, 3],
      target: [4, 5, 6]
    });
  });

  it("stands back along a plan hint's direction, scaled to the model", () => {
    const view = stepView({ source: "plan", direction: [0, 0, 1] }, CENTER, 10);
    expect(view?.target).toEqual(CENTER);
    expect(view?.position[2]).toBeCloseTo(24, 5);
  });

  it("scales the standoff with the model, so one hint suits any size", () => {
    const near = stepView({ source: "plan", direction: [0, 0, 1] }, CENTER, 10);
    const far = stepView({ source: "plan", direction: [0, 0, 1] }, CENTER, 100);
    expect((far?.position[2] ?? 0) / (near?.position[2] ?? 1)).toBeCloseTo(
      10,
      5
    );
  });

  it("normalizes a direction that is not a unit vector", () => {
    const a = stepView({ source: "plan", direction: [0, 0, 1] }, CENTER, 10);
    const b = stepView({ source: "plan", direction: [0, 0, 7] }, CENTER, 10);
    expect(b?.position[2]).toBeCloseTo(a?.position[2] ?? 0, 5);
  });

  it("keeps the current view when there is no camera", () => {
    expect(stepView(null, CENTER, 10)).toBeNull();
    expect(stepView(undefined, CENTER, 10)).toBeNull();
  });

  it("keeps the current view for a shape it does not recognise", () => {
    // The wire carries the planner's JSON untouched, so this is data we have
    // not met — pointing the operator somewhere arbitrary is worse.
    expect(stepView({ source: "something-new" }, CENTER, 10)).toBeNull();
    expect(stepView({ direction: "up" }, CENTER, 10)).toBeNull();
  });

  it("keeps the current view for a zero direction rather than dividing by it", () => {
    expect(
      stepView({ source: "plan", direction: [0, 0, 0] }, CENTER, 10)
    ).toBeNull();
  });

  it("survives a model with no size", () => {
    const view = stepView({ source: "plan", direction: [0, 0, 1] }, CENTER, 0);
    expect(Number.isFinite(view?.position[2])).toBe(true);
  });
});

describe("defaultView", () => {
  it("frames the whole model from slightly above", () => {
    const view = defaultView([0, 0, 0], 10);
    expect(view.target).toEqual([0, 0, 0]);
    expect(view.position[2]).toBeCloseTo(24, 5);
    expect(view.position[1]).toBeCloseTo(6, 5);
  });

  it("is offset from the model's own centre, not the origin", () => {
    expect(defaultView([5, 5, 5], 10).target).toEqual([5, 5, 5]);
  });
});
