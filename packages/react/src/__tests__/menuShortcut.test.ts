// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { menuShortcutFromEvent } from "../utils/menuShortcut";

const key = (
  code: string,
  k: string,
  modifiers: Partial<
    Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">
  > = {}
) => ({
  code,
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers
});

describe("menuShortcutFromEvent", () => {
  it("maps a letter by physical key", () => {
    expect(menuShortcutFromEvent(key("KeyE", "e"))).toBe("e");
    // Non-Latin layout: the character differs, the physical key does not.
    expect(menuShortcutFromEvent(key("KeyE", "у"))).toBe("e");
  });

  it("maps Backspace and Delete to the delete key", () => {
    expect(menuShortcutFromEvent(key("Backspace", "Backspace"))).toBe(
      "backspace"
    );
    expect(menuShortcutFromEvent(key("Delete", "Delete"))).toBe("backspace");
    expect(
      menuShortcutFromEvent(key("Backspace", "Backspace", { metaKey: true }))
    ).toBe(null);
  });

  it("ignores keys with any modifier", () => {
    expect(menuShortcutFromEvent(key("KeyE", "e", { ctrlKey: true }))).toBe(
      null
    );
    expect(menuShortcutFromEvent(key("KeyE", "e", { metaKey: true }))).toBe(
      null
    );
    expect(menuShortcutFromEvent(key("KeyE", "E", { shiftKey: true }))).toBe(
      null
    );
    expect(menuShortcutFromEvent(key("KeyE", "e", { altKey: true }))).toBe(
      null
    );
  });

  it("ignores digits, Escape, Enter and arrows", () => {
    expect(menuShortcutFromEvent(key("Digit1", "1"))).toBe(null);
    expect(menuShortcutFromEvent(key("Escape", "Escape"))).toBe(null);
    expect(menuShortcutFromEvent(key("Enter", "Enter"))).toBe(null);
    expect(menuShortcutFromEvent(key("ArrowDown", "ArrowDown"))).toBe(null);
  });
});
