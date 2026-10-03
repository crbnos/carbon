// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

/**
 * One-key shortcuts for menu items, live only while their menu is open.
 * `delete` is Backspace (or Delete); only wire it on an item that asks for
 * confirmation before anything is removed.
 */
export const MENU_ITEM_SHORTCUTS = {
  edit: "e",
  rename: "r",
  pin: "p",
  duplicate: "c",
  copy: "c",
  download: "d",
  view: "o",
  open: "o",
  delete: "backspace"
} as const;

export type MenuItemShortcut =
  (typeof MENU_ITEM_SHORTCUTS)[keyof typeof MENU_ITEM_SHORTCUTS];
