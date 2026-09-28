import { useCallback, useMemo, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useOperatingSystem } from "../OperatingSystem";
import { hasOpenDialog } from "../utils/dialog";
import { isEditableTarget } from "../utils/keyboard";

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

export type ShortcutKeyMapEntry = {
  shortcut: ShortcutInput;
  action: (event: KeyboardEvent) => void;
};

/**
 * react-hotkeys-hook normalizes hotkey names and `event.code` values with this
 * exact replacement (its internal `mapKey`, not exported), which is how it
 * matches physical keys — `Digit1` → `"1"`, `KeyN` → `"n"`, `ArrowLeft` →
 * `"left"`. Mirrored here (pure, exported for tests) so a combo string can be
 * canonicalized to the same form the library hands back to a handler, letting
 * one `useHotkeys` registration dispatch to many entries.
 */
export function canonicalCombo(combo: string): string {
  const flags = { alt: 0, ctrl: 0, meta: 0, mod: 0, shift: 0 };
  const keys: string[] = [];
  for (const raw of combo.toLowerCase().split("+")) {
    const token = raw.trim();
    if (!token) continue;
    if (token in flags) {
      flags[token as keyof typeof flags] = 1;
    } else {
      keys.push(token.replace(/key|digit|numpad|arrow/, ""));
    }
  }
  return `${flags.alt}${flags.ctrl}${flags.meta}${flags.mod}${flags.shift}:${keys.join("+")}`;
}

/** The matched-hotkey shape react-hotkeys-hook passes to a handler. */
type MatchedHotkey = {
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  mod?: boolean;
  shift?: boolean;
  keys?: readonly string[];
};

function canonicalMatchedHotkey(hotkey: MatchedHotkey): string {
  return `${+!!hotkey.alt}${+!!hotkey.ctrl}${+!!hotkey.meta}${+!!hotkey.mod}${+!!hotkey.shift}:${(hotkey.keys ?? []).join("+")}`;
}

/**
 * Bind many page-level shortcuts to many actions — the collision-proof
 * replacement for the deleted legacy `useKeyboardShortcuts` record API.
 * Delegates matching to react-hotkeys-hook (one registration for all combos,
 * dispatched by canonical combo), so its input/contentEditable handling and
 * physical-key (`event.code`) matching apply — ⌥1 emitting `"¡"` on mac and
 * shift+/ emitting `"?"` both still match. On top of the library: skips open
 * dialogs and richer editable targets (cmdk, listbox/menu typeahead), and
 * duplicate combos warn loudly instead of silently overwriting each other,
 * which is how a duplicate ⌘⇧P binding went unnoticed for years.
 */
export function useShortcutKeyMap(
  entries: ReadonlyArray<ShortcutKeyMapEntry>,
  options?: { disabled?: boolean }
) {
  const { platform } = useOperatingSystem();
  const isMac = platform === "mac";

  const disabledRef = useRef(options?.disabled ?? false);
  disabledRef.current = options?.disabled ?? false;

  const { byCombo, combos } = useMemo(() => {
    const byCombo = new Map<string, ShortcutKeyMapEntry>();
    const combos: string[] = [];
    entries.forEach((entry, index) => {
      for (const combo of resolveShortcutKeys(entry.shortcut, isMac)) {
        const canonical = canonicalCombo(combo);
        if (byCombo.has(canonical)) {
          // biome-ignore lint/suspicious/noConsole: loud duplicate-combo warning is the point
          console.warn(
            `useShortcutKeyMap: duplicate combo "${combo}" (entry ${index}) — only fix is at the caller; duplicates are a bug, not a tiebreak.`
          );
          continue;
        }
        byCombo.set(canonical, entry);
        combos.push(combo);
      }
    });
    return { byCombo, combos };
  }, [entries, isMac]);
  const byComboRef = useRef(byCombo);
  byComboRef.current = byCombo;

  // Guarded via the handler + a preventDefault FUNCTION, not the `enabled`
  // option: react-hotkeys-hook prevents/stops a matched event BEFORE it
  // consults `enabled`, so a boolean preventDefault would swallow keys (e.g.
  // arrows while a dialog is open) that should stay completely untouched.
  const guardsPass = useCallback(
    (event: KeyboardEvent) =>
      !disabledRef.current &&
      !hasOpenDialog() &&
      !isEditableTarget(event.target),
    []
  );
  const handler = useCallback(
    (event: KeyboardEvent, hotkey: MatchedHotkey) => {
      if (!guardsPass(event)) return;
      byComboRef.current.get(canonicalMatchedHotkey(hotkey))?.action(event);
    },
    [guardsPass]
  );

  useHotkeys(combos, handler, { preventDefault: guardsPass });
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
