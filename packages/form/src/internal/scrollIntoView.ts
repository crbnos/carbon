export type ScrollGeometry = {
  /** The target's viewport rect (`element.getBoundingClientRect()`). */
  element: { top: number; height: number };
  /**
   * The scrolling container's viewport rect (`getBoundingClientRect()`), its
   * visible height (`clientHeight`) and its current `scrollTop`.
   */
  container: { top: number; height: number; scrollTop: number };
};

/**
 * The container scroll offset that centers `element`, matching the `block:
 * "center"` fallback.
 *
 * Derived from viewport rects rather than `element.offsetTop`: offsetTop is
 * measured from the nearest positioned ancestor, which for a field inside a
 * sortable list is the surrounding card, not the scroll container.
 */
export const getCenteredScrollTop = ({
  element,
  container
}: ScrollGeometry): number => {
  const offsetWithinContent = container.scrollTop + element.top - container.top;
  const centered =
    offsetWithinContent - (container.height - element.height) / 2;
  return Math.max(0, centered);
};
