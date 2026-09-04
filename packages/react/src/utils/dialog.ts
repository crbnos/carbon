// Radix stamps open dialogs (Modal, Drawer, ModalDrawer, …) with this
// attribute pair. Keep the selector here — it is an implementation detail of
// Radix that must not be hand-written at call sites.
const OPEN_DIALOG_SELECTOR = '[role="dialog"][data-state="open"]';

export function hasOpenDialog(): boolean {
  return document.querySelector(OPEN_DIALOG_SELECTOR) !== null;
}

// Portals mount in stacking order, so the last open dialog in the DOM is the
// one on top.
export function topmostOpenDialog(): Element | null {
  const dialogs = document.querySelectorAll(OPEN_DIALOG_SELECTOR);
  return dialogs[dialogs.length - 1] ?? null;
}

/**
 * True when the element sits inside the dialog currently on top — a button in
 * an outer dialog covered by a nested one does NOT qualify, so its shortcut
 * stays quiet.
 */
export function isInsideTopmostDialog(element: Element | null): boolean {
  if (!element) return false;
  return topmostOpenDialog()?.contains(element) ?? false;
}
