// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { changedNotes, changedPartNumberDisplay } from "./context";

const notes = (text: string) => ({
  type: "doc",
  content: [{ type: "text", text }]
});
const state = (
  current: ReturnType<typeof notes> | null,
  saved: ReturnType<typeof notes> | null,
  hasNotes = true
) =>
  ({
    document: { hasNotes },
    notes: current,
    baseline: { notes: saved }
  }) as Parameters<typeof changedNotes>[0];

describe("changedNotes", () => {
  // An untouched draft must not overwrite notes changed on the record's page.
  it("sends nothing for notes the user did not change", () => {
    expect(changedNotes(state(notes("old"), notes("old")))).toBeUndefined();
    expect(changedNotes(state(null, null))).toBeUndefined();
  });

  it("sends what the user typed", () => {
    expect(changedNotes(state(notes("new"), notes("old")))).toBe(
      JSON.stringify(notes("new"))
    );
  });

  it("sends nothing for a document without notes", () => {
    expect(
      changedNotes(state(notes("new"), notes("old"), false))
    ).toBeUndefined();
  });

  it("sends nothing outside document mode", () => {
    expect(
      changedNotes({
        ...state(notes("new"), notes("old")),
        document: null
      })
    ).toBeUndefined();
  });
});

describe("changedPartNumberDisplay", () => {
  const display = (
    current: Parameters<
      typeof changedPartNumberDisplay
    >[0]["partNumberDisplay"],
    saved: Parameters<typeof changedPartNumberDisplay>[0]["partNumberDisplay"],
    party: "customer" | "supplier" | null = "supplier"
  ) =>
    ({
      document: { partNumberParty: party },
      partNumberDisplay: current,
      baseline: { partNumberDisplay: saved }
    }) as Parameters<typeof changedPartNumberDisplay>[0];

  it("sends nothing for a document with no part number choice", () => {
    expect(
      changedPartNumberDisplay(display("Ours First", null, null))
    ).toBeUndefined();
  });

  it("sends nothing for an unchanged choice", () => {
    expect(
      changedPartNumberDisplay(display("Ours First", "Ours First"))
    ).toBeUndefined();
  });

  it("sends a pick over legacy lines", () => {
    expect(changedPartNumberDisplay(display("Theirs Only", null))).toBe(
      "Theirs Only"
    );
  });

  it("sends nothing for mixed lines the user did not touch", () => {
    expect(changedPartNumberDisplay(display("mixed", "mixed"))).toBeUndefined();
  });
});
