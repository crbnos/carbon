// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

// Layers a control can sit in that close and take it away: a control focused
// in one never gets focus back after a dialog.
const FOCUS_LAYERS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

let lastPageFocus: HTMLElement | null = null;
let trackingPageFocus = false;

/**
 * Remember the last control focused on the page itself — outside any dialog,
 * menu or popover — so focus can go back to it when a dialog closes. Install
 * early (RouteAnnouncer at the app root); calling it again is a no-op.
 */
export function trackPageFocus() {
  if (trackingPageFocus || typeof document === "undefined") return;
  trackingPageFocus = true;
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target !== document.body &&
      !target.closest(FOCUS_LAYERS)
    ) {
      lastPageFocus = target;
    }
  });
  // A menu trigger clicked with the mouse never takes focus (Radix prevents
  // it on pointerdown), so a dialog opened from its menu had nothing to return
  // to. Remember the control that was pressed as well.
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(
              'button, a[href], [role="button"], [role="menuitem"]'
            )
          : null;
      if (target && !target.closest(FOCUS_LAYERS)) lastPageFocus = target;
    },
    true
  );
}

/**
 * The control a dialog should hand focus back to: the last page control
 * focused, or — when its row re-rendered and replaced it — the link to the
 * same place.
 */
export function pageFocusReturnTarget(): HTMLElement | null {
  const element = lastPageFocus;
  if (!element) return null;
  if (element.isConnected) return element;
  const href = element.getAttribute("href");
  if (href) {
    return document.querySelector<HTMLElement>(`a[href="${CSS.escape(href)}"]`);
  }
  // A route dialog (delete confirm) closing re-renders the list and replaces
  // the row's button: find the control with the same name instead.
  // Only a name no other control shares: a generic one ("Action Menu" on
  // every row) would send focus to another row, where Enter acts on the
  // wrong record.
  const label = element.getAttribute("aria-label");
  if (label) {
    const matches = document.querySelectorAll<HTMLElement>(
      `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(label)}"]`
    );
    return matches.length === 1 ? (matches[0] ?? null) : null;
  }
  return null;
}

/**
 * After a dialog closes: if focus fell to the page body — the control that
 * opened it was a menu item, or was replaced — send it back to the page
 * control focused last. Returns whether it moved focus.
 */
export function restoreLostFocus(): boolean {
  const active = document.activeElement;
  if (active && active !== document.body) return false;
  if (hasOpenDialog()) return false;
  const target = pageFocusReturnTarget();
  if (!target) return false;
  target.focus({ preventScroll: true });
  return document.activeElement === target;
}

/**
 * A dialog content's `onCloseAutoFocus`: runs the caller's handler, lets
 * Radix return focus, then restores it to the page if that left it on body.
 */
export function returnFocusOnClose(handler?: (event: Event) => void) {
  return (event: Event) => {
    handler?.(event);
    if (event.defaultPrevented) return;
    // A route dialog closes by navigating: it may still be in the page on the
    // next frame, and the list behind it re-renders after. Keep trying briefly.
    let tries = 0;
    const attempt = () => {
      if (restoreLostFocus()) return;
      const active = document.activeElement;
      const lost = !active || active === document.body;
      if (lost && ++tries < 10) setTimeout(attempt, 80);
    };
    requestAnimationFrame(attempt);
  };
}
