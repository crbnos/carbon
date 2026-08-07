/**
 * Details-tab scrollport classes for the MES Job Operation screen.
 *
 * Below `lg`, Controls/Times stack inline under the details content and the
 * page (layout) scrolls — so this region must NOT use a viewport-filling fixed
 * height. A fixed-height nested scroller trapped Files / Serial Numbers
 * off-screen on small viewports (issue #959).
 *
 * At `lg+`, Controls docks absolutely to the right and Times to the bottom,
 * so the details region needs a fixed-height scrollport that reserves space
 * via `--controls-height` / `--controls-gutter`.
 */
export const DETAILS_SCROLLPORT_CLASSNAME =
  "w-full min-w-0 lg:pr-[var(--controls-gutter)] h-auto lg:h-[calc(100dvh-var(--header-height)*2-var(--controls-height)-2rem)] overflow-y-visible lg:overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent";
