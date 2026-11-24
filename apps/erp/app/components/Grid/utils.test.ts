// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { gridKeyCode, takesKeyFromEditor } from "./utils";

const key = (code: string, name: string, isComposing = false) => ({
  code,
  key: name,
  isComposing
});

describe("gridKeyCode", () => {
  it.each([
    ["Enter", "Enter", "Enter"],
    ["NumpadEnter", "Enter", "Enter"],
    ["", "Enter", "Enter"],
    ["Tab", "Tab", "Tab"],
    ["ArrowDown", "ArrowDown", "ArrowDown"],
    ["KeyA", "a", "KeyA"]
  ])("names code %j with key %j as %j", (code, name, expected) => {
    expect(gridKeyCode({ code, key: name })).toBe(expected);
  });
});

describe("takesKeyFromEditor", () => {
  it.each([
    ["Enter", "Enter"],
    ["NumpadEnter", "Enter"],
    ["", "Enter"],
    ["Tab", "Tab"]
  ])("takes %j (key %j) from an open editor", (code, name) => {
    expect(takesKeyFromEditor(key(code, name), true)).toBe(true);
  });

  it.each([
    ["ArrowUp", "ArrowUp"],
    ["ArrowLeft", "ArrowLeft"],
    ["Digit5", "5"],
    ["Escape", "Escape"]
  ])("leaves %j to the open editor", (code, name) => {
    expect(takesKeyFromEditor(key(code, name), true)).toBe(false);
  });

  it("leaves the Enter that ends an IME composition to the composition", () => {
    expect(takesKeyFromEditor(key("Enter", "Enter", true), true)).toBe(false);
  });

  it("takes nothing while no cell is being edited", () => {
    expect(takesKeyFromEditor(key("Enter", "Enter"), false)).toBe(false);
    expect(takesKeyFromEditor(key("Tab", "Tab"), false)).toBe(false);
  });
});
