// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KeyboardEvent } from "react";
import { isTextEntryTarget } from "./keyboard";

type KeyLike = Pick<
  globalThis.KeyboardEvent,
  "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

/**
 * The menu-item shortcut a keydown stands for, or null. Letters match on the
 * physical key (`event.code`), like react-hotkeys-hook, so non-Latin layouts
 * still work. Any modifier opts out — menu keys are bare letters only.
 */
export function menuShortcutFromEvent(event: KeyLike): string | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return null;
  }
  if (event.key === "Backspace" || event.key === "Delete") return "backspace";
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  return letter ? letter.toLowerCase() : null;
}

/**
 * Scoped by construction: menu content only exists while the menu is open.
 * Submenu keys bubble here through the React portal tree, hence the
 * own-menu filter. Unmatched keys fall through to Radix typeahead.
 */
export function handleMenuShortcutKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented) return;
  const menu = event.currentTarget;
  const target = event.target;
  if (!(target instanceof Element) || isTextEntryTarget(target)) return;
  if (target.closest("[role='menu']") !== menu) return;

  const key = menuShortcutFromEvent(event);
  if (!key) return;

  const matches = Array.from(
    menu.querySelectorAll<HTMLElement>(
      `[role='menuitem'][data-menu-shortcut='${key}']:not([data-disabled])`
    )
  ).filter((item) => item.closest("[role='menu']") === menu);
  const [item] = matches;
  if (!item) return;
  if (matches.length > 1) {
    // biome-ignore lint/suspicious/noConsole: duplicate menu keys are a bug at the caller
    console.warn(
      `Menu shortcut "${key}" is set on ${matches.length} items in one menu — only the first runs.`
    );
  }

  event.preventDefault();
  event.stopPropagation();
  item.click();
}

/** Runs the caller's handler first, so it can `preventDefault` a menu key. */
export function withMenuShortcuts(
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    handleMenuShortcutKeyDown(event);
  };
}
