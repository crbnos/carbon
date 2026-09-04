// Radix stamps open dialogs (Modal, Drawer, ModalDrawer, …) with this
// attribute pair. Keep the selector here — it is an implementation detail of
// Radix that must not be hand-written at call sites.
const OPEN_DIALOG_SELECTOR = '[role="dialog"][data-state="open"]';

export function hasOpenDialog(): boolean {
  return document.querySelector(OPEN_DIALOG_SELECTOR) !== null;
}

// Dialog layers are not uniform (BottomSheetContent is z-[70], Modal/Drawer
// are z-50), so DOM order alone can pick a covered dialog. Highest computed
// z-index wins; later-mounted wins ties (portals append in stacking order).
export function topmostOpenDialog(): Element | null {
  let topmost: Element | null = null;
  let topmostZ = Number.NEGATIVE_INFINITY;
  for (const dialog of document.querySelectorAll(OPEN_DIALOG_SELECTOR)) {
    const z = Number.parseInt(getComputedStyle(dialog).zIndex, 10) || 0;
    if (z >= topmostZ) {
      topmost = dialog;
      topmostZ = z;
    }
  }
  return topmost;
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
