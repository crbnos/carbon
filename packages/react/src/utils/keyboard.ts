// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * True when the event target (or given element) is a text-entry surface that
 * owns its own keys: INPUT, TEXTAREA, SELECT, contenteditable, ProseMirror,
 * cmdk list, or an open listbox/menu. Every shortcut hook/guard uses this —
 * never re-implement the check at a call site.
 */
export function isEditableTarget(
  target: EventTarget | Element | null
): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (isTextEntryTarget(target)) return true;
  return Boolean(
    target.closest(".ProseMirror, [cmdk-root], [role='listbox'], [role='menu']")
  );
}

/**
 * The narrow half of `isEditableTarget`: only fields that take typed text
 * (INPUT, TEXTAREA, SELECT, contenteditable). Use it where the surrounding
 * listbox/menu is the thing handling keys — e.g. menu item shortcuts, which
 * must still stand down for a NumberField rendered inside a menu.
 */
export function isTextEntryTarget(
  target: EventTarget | Element | null
): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return target.isContentEditable;
}

// Controls that act on a bare Enter or Space themselves. Text fields are not
// listed: a shortcut reaches them only when it opts in
// (`enabledOnInputElements`), which says the field's Enter means the action.
const ACTIVATABLE_CONTROL = [
  "button",
  "a[href]",
  "select",
  "summary",
  'input:is([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="image"], [type="file"])',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="treeitem"]'
].join(", ");

/**
 * True when a bare Enter or Space (no Ctrl, Meta or Alt) lands on a control
 * other than `owner`: that control activates itself, so a shortcut bound to
 * the bare key must stand down — Enter on a dialog's Cancel must not also
 * press the page's Enter-bound Record button. Combos (⌘Enter) still fire.
 */
export function isBareKeyForAnotherControl(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "target"
  >,
  owner: Element | null
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") {
    return false;
  }
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (owner && (target === owner || owner.contains(target))) return false;
  return target.closest(ACTIVATABLE_CONTROL) !== null;
}
