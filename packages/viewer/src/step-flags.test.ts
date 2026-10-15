// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { hasCustomMotion, isPlanFlagged, isSavedView } from "./step-flags";

describe("isSavedView", () => {
  it("is true for a manual pose", () => {
    expect(
      isSavedView({ position: [1, 2, 3], target: [0, 0, 0], fov: 45 })
    ).toBe(true);
  });

  it("is false for a planner hint, null and malformed values", () => {
    expect(isSavedView({ source: "plan", direction: [0, 0, 1] })).toBe(false);
    expect(
      isSavedView({ source: "plan", position: [1, 2, 3], target: [0, 0, 0] })
    ).toBe(false);
    expect(isSavedView(null)).toBe(false);
    expect(isSavedView(undefined)).toBe(false);
    expect(isSavedView("view")).toBe(false);
    expect(isSavedView({ position: [1, 2, 3] })).toBe(false);
    expect(isSavedView({ position: "a", target: [0, 0, 0] })).toBe(false);
  });
});

describe("hasCustomMotion / isPlanFlagged", () => {
  const moving = { type: "linear", direction: [0, 0, 1], distance: 10 };
  const none = { type: "none" };

  it("treats a plannedMotion marker as hand-drawn, even unflagged", () => {
    expect(hasCustomMotion({ plannedMotion: none }, moving)).toBe(true);
    expect(hasCustomMotion({ plannedMotion: null }, none)).toBe(true);
    expect(isPlanFlagged({ flagged: true, plannedMotion: none }, none)).toBe(
      false
    );
  });

  it("treats a flagged step that moves as hand-drawn", () => {
    expect(hasCustomMotion({ flagged: true }, moving)).toBe(true);
    expect(isPlanFlagged({ flagged: true }, moving)).toBe(false);
  });

  it("flags a flagged step that does not move", () => {
    expect(hasCustomMotion({ flagged: true }, none)).toBe(false);
    expect(isPlanFlagged({ flagged: true }, none)).toBe(true);
    expect(isPlanFlagged({ flagged: true }, null)).toBe(true);
    expect(isPlanFlagged({ flagged: true }, { distance: 3 })).toBe(true);
  });

  it("is neither for an unflagged planner motion", () => {
    expect(hasCustomMotion({}, moving)).toBe(false);
    expect(hasCustomMotion({ flagged: false }, moving)).toBe(false);
    expect(isPlanFlagged({ flagged: false }, none)).toBe(false);
  });

  it("treats non-object warnings as empty", () => {
    for (const warnings of [null, undefined, "flagged", 7, true]) {
      expect(hasCustomMotion(warnings, moving)).toBe(false);
      expect(isPlanFlagged(warnings, none)).toBe(false);
    }
  });

  it("only counts flagged === true", () => {
    expect(isPlanFlagged({ flagged: "true" }, none)).toBe(false);
    expect(hasCustomMotion({ flagged: 1 }, moving)).toBe(false);
  });
});
