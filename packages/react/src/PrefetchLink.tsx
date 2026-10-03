// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { forwardRef, useState } from "react";
import type { LinkProps } from "react-router";
import { Link, PrefetchPageLinks, useHref } from "react-router";

const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * A `Link` that prefetches its destination when the pointer goes down on it.
 *
 * `prefetch="intent"` prefetches on a 100 ms hover, so moving the mouse down a
 * list ran every hovered page's loaders for a click that mostly never came. A
 * press is a commitment: it costs one request, and the page gets the time
 * between press and release as a head start. Chromium serves the click from
 * the prefetched response; a browser that does not reuse it makes one extra
 * request per click, never one per hover.
 *
 * Use this instead of `<Link prefetch="intent">`.
 */
export const PrefetchLink = forwardRef<
  HTMLAnchorElement,
  Omit<LinkProps, "prefetch">
>(({ onPointerDown, ...props }, ref) => {
  const href = useHref(props.to, { relative: props.relative });
  // A new key remounts the prefetch tags, so each press prefetches again.
  const [presses, setPresses] = useState(0);
  const canPrefetch =
    props.to !== "#" &&
    !(typeof props.to === "string" && ABSOLUTE_URL.test(props.to));

  return (
    <>
      <Link
        ref={ref}
        {...props}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          // A modified or non-primary press opens a new tab or a menu: the
          // page being prefetched would not be the one that uses it.
          const plain =
            event.button === 0 &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey;
          if (plain && canPrefetch) setPresses((n) => n + 1);
        }}
      />
      {presses > 0 && <PrefetchPageLinks key={presses} page={href} />}
    </>
  );
});
PrefetchLink.displayName = "PrefetchLink";
