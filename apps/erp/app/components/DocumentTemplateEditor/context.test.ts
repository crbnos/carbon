// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { changedNotes } from "./context";

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
