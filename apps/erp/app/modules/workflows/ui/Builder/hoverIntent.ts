/**
 * The open/close timing behind the output-handle popover.
 *
 * Extracted from the component so the one thing that is easy to get wrong — and
 * did go wrong — can be tested without a DOM: the panel sits offset from its
 * handle, so the pointer crosses a gap belonging to neither. Closing on the
 * handle's mouse-leave dismissed the panel before it could be reached.
 */
export type HoverIntentOptions = {
  openDelayMs: number;
  closeDelayMs: number;
  onOpen: () => void;
  onClose: () => void;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
};

export function createHoverIntent(options: HoverIntentOptions) {
  let openId: number | null = null;
  let closeId: number | null = null;
  let isOpen = false;

  const clearAll = () => {
    if (openId !== null) options.clearTimer(openId);
    if (closeId !== null) options.clearTimer(closeId);
    openId = null;
    closeId = null;
  };

  return {
    /** Pointer entered the handle OR the panel. */
    enter() {
      clearAll();
      // Already showing: crossing onto the panel holds it, and must not re-time.
      if (isOpen) return;
      openId = options.setTimer(() => {
        openId = null;
        isOpen = true;
        options.onOpen();
      }, options.openDelayMs);
    },
    /** Pointer left the handle or the panel — a grace period, not a dismissal. */
    leave() {
      if (openId !== null) options.clearTimer(openId);
      openId = null;
      // Nothing is showing: a pointer that merely passed over the handle should
      // leave no trace, not schedule a close for a panel that never opened.
      if (!isOpen) return;
      if (closeId !== null) options.clearTimer(closeId);
      closeId = options.setTimer(() => {
        closeId = null;
        isOpen = false;
        options.onClose();
      }, options.closeDelayMs);
    },
    /** Dismiss immediately — a click or a drag, where a lingering panel is in the way. */
    dismiss() {
      clearAll();
      isOpen = false;
      options.onClose();
    },
    isOpen: () => isOpen
  };
}
