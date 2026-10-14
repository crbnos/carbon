// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PointerEvent } from "react";
import { useCallback, useMemo, useRef } from "react";

/**
 * The hover card the icon rail has, for any list of links: one card for the
 * whole list, moved with a transform to the link under the pointer, so the
 * highlight travels between links instead of each one fading its own. A link
 * opts in with `data-nav-item`. Spread `handlers` on the container (which must
 * be `relative`) and render the card as an absolutely positioned span holding
 * `cardRef`, before the links; the links need `relative` to paint above it.
 */
export function useSlidingHoverCard<Container extends HTMLElement>() {
  const containerRef = useRef<Container>(null);
  const cardRef = useRef<HTMLSpanElement>(null);

  // Written straight to the element: a hover must not re-render the list.
  const moveCard = useCallback((item: HTMLElement | null) => {
    const card = cardRef.current;
    const container = containerRef.current;
    if (!card || !container) return;
    if (!item) {
      card.style.opacity = "0";
      return;
    }
    const itemRect = item.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const left = itemRect.left - containerRect.left + container.scrollLeft;
    const top = itemRect.top - containerRect.top + container.scrollTop;
    // Entering the list: appear on the link rather than slide in from
    // wherever the card was last.
    card.style.transitionProperty = card.style.opacity === "1" ? "" : "opacity";
    card.style.transform = `translate(${left}px, ${top}px)`;
    card.style.width = `${itemRect.width}px`;
    card.style.height = `${itemRect.height}px`;
    card.style.opacity = "1";
  }, []);

  const handlers = useMemo(
    () => ({
      // The gaps between links are not links: the card stays where it is
      // while the pointer crosses one, and only leaves with the pointer.
      onPointerOver: (event: PointerEvent<Container>) => {
        if (event.pointerType !== "mouse") return;
        const item = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-nav-item]"
        );
        if (item) moveCard(item);
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
