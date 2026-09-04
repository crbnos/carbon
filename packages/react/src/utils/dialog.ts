// Radix stamps open dialogs (Modal, Drawer, ModalDrawer, …) with this
// attribute pair. Keep the selector here — it is an implementation detail of
// Radix that must not be hand-written at call sites.
const OPEN_DIALOG_SELECTOR = '[role="dialog"][data-state="open"]';

export function hasOpenDialog(): boolean {
  return document.querySelector(OPEN_DIALOG_SELECTOR) !== null;
}

export function isInsideOpenDialog(element: Element | null): boolean {
  if (!element) return false;
  return Array.from(document.querySelectorAll(OPEN_DIALOG_SELECTOR)).some(
    (dialog) => dialog.contains(element)
  );
}
