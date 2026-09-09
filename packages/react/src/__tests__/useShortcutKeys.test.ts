import { describe, expect, it } from "vitest";
import {
  canonicalCombo,
  KeyboardKeys,
  parseShortcut,
  resolveShortcutKeys
} from "../hooks/useShortcutKeys";

describe("resolveShortcutKeys", () => {
  it("returns [] for undefined", () => {
    expect(resolveShortcutKeys(undefined, true)).toEqual([]);
  });

  it("resolves a single shortcut without modifiers", () => {
    expect(resolveShortcutKeys({ key: KeyboardKeys.S }, true)).toEqual(["s"]);
  });

  it("resolves modifiers into a joined combo string", () => {
    expect(
      resolveShortcutKeys({ key: KeyboardKeys.S, modifiers: ["mod"] }, true)
    ).toEqual(["mod+s"]);
    expect(
      resolveShortcutKeys(
        { key: KeyboardKeys.Enter, modifiers: ["shift", "alt"] },
        false
      )
    ).toEqual(["shift+alt+enter"]);
  });

  it("resolves an array of alternatives, preserving order", () => {
    expect(
      resolveShortcutKeys(
        [{ key: KeyboardKeys.Space }, { key: KeyboardKeys.Enter }],
        true
      )
    ).toEqual(["space", "enter"]);
  });

  it("picks the mac arm of a dual-platform definition on mac", () => {
    const definition = {
      mac: { key: KeyboardKeys.Enter, modifiers: ["meta" as const] },
      windows: { key: KeyboardKeys.Enter, modifiers: ["ctrl" as const] }
    };
    expect(resolveShortcutKeys(definition, true)).toEqual(["meta+enter"]);
    expect(resolveShortcutKeys(definition, false)).toEqual(["ctrl+enter"]);
  });

  it("accepts plain string keys alongside the enum", () => {
    expect(resolveShortcutKeys({ key: "f2" }, true)).toEqual(["f2"]);
  });

  it("passes string bindings through, lowercased and trimmed", () => {
    expect(resolveShortcutKeys("mod+S", true)).toEqual(["mod+s"]);
    expect(resolveShortcutKeys("mod + s", true)).toEqual(["mod+s"]);
    expect(resolveShortcutKeys(["space", "Enter"], true)).toEqual([
      "space",
      "enter"
    ]);
    expect(resolveShortcutKeys("  ", true)).toEqual([]);
  });

  it("mixes string and structured bindings", () => {
    expect(
      resolveShortcutKeys(
        ["mod+s", { key: KeyboardKeys.Enter, modifiers: ["shift"] }],
        true
      )
    ).toEqual(["mod+s", "shift+enter"]);
  });
});

describe("parseShortcut", () => {
  it("splits a string binding into modifiers and key", () => {
    expect(parseShortcut("mod+s", true)).toEqual({
      key: "s",
      modifiers: ["mod"]
    });
    expect(parseShortcut("ctrl+shift+enter", false)).toEqual({
      key: "enter",
      modifiers: ["ctrl", "shift"]
    });
  });

  it("treats a bare key as modifier-free", () => {
    expect(parseShortcut("enter", true)).toEqual({
      key: "enter",
      modifiers: []
    });
  });

  it("keeps a lone modifier-looking token as the key", () => {
    expect(parseShortcut("mod", true)).toEqual({ key: "mod", modifiers: [] });
  });

  it("picks the platform arm of a structured definition", () => {
    const definition = {
      mac: { key: KeyboardKeys.Enter, modifiers: ["meta" as const] },
      windows: { key: KeyboardKeys.Enter, modifiers: ["ctrl" as const] }
    };
    expect(parseShortcut(definition, true)).toEqual(definition.mac);
    expect(parseShortcut(definition, false)).toEqual(definition.windows);
  });
});

describe("canonicalCombo", () => {
  // The canonical form must mirror react-hotkeys-hook's internal `mapKey`
  // normalization (`Key`/`Digit`/`Numpad`/`Arrow` prefixes stripped), because
  // useShortcutKeyMap dispatches by matching a combo string's canonical form
  // against the parsed hotkey the library hands back to the handler.
  it("orders modifier flags alt,ctrl,meta,mod,shift", () => {
    expect(canonicalCombo("mod+enter")).toBe("00010:enter");
    expect(canonicalCombo("shift+alt+enter")).toBe("10001:enter");
    expect(canonicalCombo("meta+ctrl+k")).toBe("01100:k");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(canonicalCombo("mod+S")).toBe(canonicalCombo("mod+s"));
    expect(canonicalCombo("mod + s")).toBe(canonicalCombo("mod+s"));
  });

  it("normalizes arrow keys the way the library does", () => {
    expect(canonicalCombo("arrowleft")).toBe("00000:left");
    expect(canonicalCombo("arrowright")).toBe("00000:right");
  });

  it("keeps named keys and digits as-is", () => {
    expect(canonicalCombo("alt+1")).toBe("10000:1");
    expect(canonicalCombo("shift+slash")).toBe("00001:slash");
    expect(canonicalCombo("space")).toBe("00000:space");
    expect(canonicalCombo("escape")).toBe("00000:escape");
  });

  it("treats a lone modifier-looking token as a flag with no key", () => {
    expect(canonicalCombo("mod")).toBe("00010:");
  });
});
