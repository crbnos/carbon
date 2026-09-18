import type { Shortcut, ShortcutInput } from "./hooks/useShortcutKeys";

/**
 * Single source of truth for combos used by SHARED components.
 * App-specific combos live in apps/{erp,mes}/app/shortcuts.ts.
 * Never write a combo string literal at a call site.
 */
export const SHORTCUTS = {
  /** Submit the focused form — fires while typing in a field. */
  save: {
    key: "enter",
    modifiers: ["mod"],
    enabledOnInputElements: true
  } as Shortcut,
  /** Confirm a (destructive) modal action. */
  confirm: "mod+enter" as ShortcutInput,
  /** Open the "New record" page on list views. */
  newRecord: "n" as ShortcutInput,
  /** Open the shortcut help overlay. */
  help: "shift+slash" as ShortcutInput,
  /** Toggle the app sidebar. */
  sidebarToggle: "mod+b" as ShortcutInput
} as const;
