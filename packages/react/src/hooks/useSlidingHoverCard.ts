// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";

type Point = { x: number; y: number };

/**
 * The `data-nav-item` under a point inside `container`, or null over a gap
 * between items. Read after a scroll, which moves the items under a still
 * pointer without a pointer event.
 */
export function navItemAt(container: HTMLElement, point: Point) {
  const item = document
    .elementFromPoint(point.x, point.y)
    ?.closest<HTMLElement>("[data-nav-item]");
  return item && container.contains(item) ? item : null;
}

/**
 * Moves the `data-hover-card` marker to the item the card is on. Styled with
 * `data-[hover-card]:` (or `in-data-[hover-card]:` under a marked wrapper), it
 * keeps the item's hover look while the pointer crosses the gap below it,
 * where the card stays but `:hover` does not.
 */
export function markHoverCardItem(
  current: { current: HTMLElement | null },
  item: HTMLElement | null
) {
  if (current.current === item) return;
  current.current?.removeAttribute("data-hover-card");
  item?.setAttribute("data-hover-card", "");
  current.current = item;
}

/**
 * The hover card the icon rail (`NavRail`) has, for any list of links: one
 * card for the whole list, moved with a transform to the link under the
 * pointer, so the highlight travels between links instead of each one fading
 * its own. A link opts in with `data-nav-item`. Spread `handlers` on the
 * container (which must be `relative`) and render the card as an absolutely
 * positioned span holding `cardRef`, before the links; the links need
 * `relative` to paint above it.
 */
export function useSlidingHoverCard<Container extends HTMLElement>() {
  const containerRef = useRef<Container>(null);
  const cardRef = useRef<HTMLSpanElement>(null);
  const cardItem = useRef<HTMLElement | null>(null);
  const lastMouse = useRef<Point | null>(null);
  const scrollFrame = useRef<number>();
  useEffect(
    () => () => {
      if (scrollFrame.current !== undefined) {
        cancelAnimationFrame(scrollFrame.current);
      }
    },
    []
  );

  // Written straight to the element: a hover must not re-render the list.
  const moveCard = useCallback(
    (item: HTMLElement | null, { instant = false } = {}) => {
      const card = cardRef.current;
      const container = containerRef.current;
      if (!card || !container) return;
      markHoverCardItem(cardItem, item);
      if (!item) {
        card.style.opacity = "0";
        return;
      }
      const itemRect = item.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      // Both rects are on screen, so an ancestor's transform scales them (a
      // modal zooms in as it opens); the card is placed in the container's
      // own pixels. The card's origin is the padding edge, inside any border.
      const scale = container.offsetWidth
        ? containerRect.width / container.offsetWidth
        : 1;
      const left =
        (itemRect.left - containerRect.left) / scale -
        container.clientLeft +
        container.scrollLeft;
      const top =
        (itemRect.top - containerRect.top) / scale -
        container.clientTop +
        container.scrollTop;
      // Entering the list: appear on the link rather than slide in from
      // wherever the card was last. A scroll moves the links themselves, so
      // the card moves with them instead of sliding after them.
      card.style.transitionProperty =
        card.style.opacity === "1" && !instant ? "" : "opacity";
      card.style.transform = `translate(${left}px, ${top}px)`;
      card.style.width = `${itemRect.width / scale}px`;
      card.style.height = `${itemRect.height / scale}px`;
      card.style.opacity = "1";
    },
    []
  );

  const handlers = useMemo(
    () => ({
      // The gaps between links are not links: the card stays where it is
      // while the pointer crosses one, and only leaves with the pointer.
      onPointerOver: (event: PointerEvent<Container>) => {
        if (event.pointerType !== "mouse") return;
        lastMouse.current = { x: event.clientX, y: event.clientY };
        const item = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-nav-item]"
        );
        if (item) moveCard(item);
      },
      onPointerMove: (event: PointerEvent<Container>) => {
        if (event.pointerType !== "mouse") return;
        lastMouse.current = { x: event.clientX, y: event.clientY };
      },
      // A scroll moves the links under a still pointer, and no pointer event
      // says so: the card goes to the link now under the pointer, or stays
      // on its own link over a gap. Once a frame, however often it fires.
      onScroll: () => {
        if (!cardItem.current || scrollFrame.current !== undefined) return;
        scrollFrame.current = requestAnimationFrame(() => {
          scrollFrame.current = undefined;
          const container = containerRef.current;
          const mouse = lastMouse.current;
          if (!container || !mouse || !cardItem.current) return;
          moveCard(navItemAt(container, mouse) ?? cardItem.current, {
            instant: true
          });
        });
      },
      // A press navigates, expands a link's views or starts a reorder: the
      // row under the card is about to change or move.
      onPointerDown: () => moveCard(null),
      // A mouse event, not `onPointerLeave`: Chrome can lose its pointer
      // boundary tracking for an element and then never send it a pointer
      // leave, while mouse leave events keep arriving. The card stayed on the
      // last link hovered (the icon rail hit the same, see NavRail).
      onMouseLeave: () => moveCard(null)
    }),
    [moveCard]
  );

  return { containerRef, cardRef, handlers };
}
