import { useHotkeys } from "react-hotkeys-hook";
import { useOperatingSystem } from "../OperatingSystem";

export type Modifier = "alt" | "ctrl" | "meta" | "shift" | "mod";

/**
 * Key names react-hotkeys-hook matches against (lowercased `KeyboardEvent.key`,
 * plus its `space` alias). Use these for `Shortcut.key` so combos are
 * autocomplete-safe instead of stringly-typed.
 */
export enum KeyboardKeys {
  // Control
  Enter = "enter",
  Escape = "escape",
  Space = "space",
  Tab = "tab",
  Backspace = "backspace",
  Delete = "delete",

  // Navigation
  ArrowUp = "arrowup",
  ArrowDown = "arrowdown",
  ArrowLeft = "arrowleft",
  ArrowRight = "arrowright",
  Home = "home",
  End = "end",
  PageUp = "pageup",
  PageDown = "pagedown",

  // Punctuation
  Slash = "slash",
  Period = "period",
  Comma = "comma",
  Minus = "minus",
  Equal = "equal",

  // Letters
  A = "a",
  B = "b",
  C = "c",
  D = "d",
  E = "e",
  F = "f",
  G = "g",
  H = "h",
  I = "i",
  J = "j",
  K = "k",
  L = "l",
  M = "m",
  N = "n",
  O = "o",
  P = "p",
  Q = "q",
  R = "r",
  S = "s",
  T = "t",
  U = "u",
  V = "v",
  W = "w",
  X = "x",
  Y = "y",
  Z = "z",

  // Digits
  Digit0 = "0",
  Digit1 = "1",
  Digit2 = "2",
  Digit3 = "3",
  Digit4 = "4",
  Digit5 = "5",
  Digit6 = "6",
  Digit7 = "7",
  Digit8 = "8",
  Digit9 = "9"
}

export type Shortcut = {
  key: string | KeyboardKeys;
  modifiers?: Modifier[];
  enabledOnInputElements?: boolean;
};

export type ShortcutDefinition =
  | {
      windows: Shortcut;
      mac: Shortcut;
    }
  | Shortcut;

/**
 * A binding is either the react-hotkeys-hook string form ("mod+s", "enter")
 * or a structured definition (which can carry separate mac/windows combos).
 */
export type ShortcutInput = string | ShortcutDefinition;

type useShortcutKeysProps = {
  /** One binding, or several alternatives that all trigger the same action. */
  shortcut: ShortcutInput | ShortcutInput[] | undefined;
  action: (event: KeyboardEvent) => void;
  disabled?: boolean;
  enabledOnInputElements?: boolean;
  /** Runs before `action`; returning false skips the action (the event is untouched). */
  guard?: (event: KeyboardEvent) => boolean;
};

const MODIFIER_TOKENS = new Set(["alt", "ctrl", "meta", "shift", "mod"]);

/**
 * Resolve one binding to the structured `Shortcut` shape (used by the
 * `ShortcutKey` badge renderer). A string binding like `"mod+s"` splits into
 * leading modifier tokens plus the key; a dual-platform definition picks its
 * mac/windows arm.
 */
export function parseShortcut(
  shortcut: ShortcutInput,
  isMac: boolean
): Shortcut | undefined {
  if (typeof shortcut === "string") {
    const tokens = shortcut
      .toLowerCase()
      .split("+")
      .map((token) => token.trim())
      .filter(Boolean);
    if (tokens.length === 0) return undefined;
    const modifiers: Modifier[] = [];
    while (tokens.length > 1 && MODIFIER_TOKENS.has(tokens[0] ?? "")) {
      modifiers.push(tokens.shift() as Modifier);
    }
    return { key: tokens.join("+"), modifiers };
  }
  if ("mac" in shortcut) {
    return isMac ? shortcut.mac : shortcut.windows;
  }
  return "key" in shortcut ? shortcut : undefined;
}

/**
 * Normalize one-or-many bindings into the key strings react-hotkeys-hook
 * consumes (e.g. `"mod+s"`, `"enter"`). String bindings pass through
 * (lowercased); structured definitions pick their platform arm and join
 * modifiers.
 */
export function resolveShortcutKeys(
  shortcut: ShortcutInput | ShortcutInput[] | undefined,
  isMac: boolean
): string[] {
  if (!shortcut) return [];
  const bindings = Array.isArray(shortcut) ? shortcut : [shortcut];
  return bindings.flatMap((binding) => {
    const resolved = parseShortcut(binding, isMac);
    if (!resolved) return [];
    return resolved.modifiers?.length
      ? resolved.modifiers.join("+") + "+" + resolved.key
      : String(resolved.key);
  });
}

export function useShortcutKeys({
  shortcut,
  action,
  disabled = false,
  enabledOnInputElements,
  guard
}: useShortcutKeysProps) {
  const { platform } = useOperatingSystem();
  const isMac = platform === "mac";

  const firstBinding = Array.isArray(shortcut) ? shortcut[0] : shortcut;
  const firstShortcut = firstBinding
    ? parseShortcut(firstBinding, isMac)
    : undefined;

  const keys = resolveShortcutKeys(shortcut, isMac);
  useHotkeys(
    keys,
    (event) => {
      if (guard && !guard(event)) return;
      action(event);
    },
    {
      enabled: !disabled,
      // With multiple bindings, only the FIRST one's `enabledOnInputElements`
      // is honored — the options apply to the whole registration.
      enableOnFormTags:
        enabledOnInputElements ?? firstShortcut?.enabledOnInputElements,
      enableOnContentEditable:
        enabledOnInputElements ?? firstShortcut?.enabledOnInputElements
    }
  );
}
