// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import Link from "next/link";

/**
 * The header wordmark. Links to `/` (the make-to-order guide) for normal navigation,
 * but the editorial reader drives its own chapter state with history.replaceState, so
 * Next's router can think it's still on `/` while you're deep in a chapter — making a
 * plain `<Link href="/">` a no-op. So we also fire `carbon:home`, which the
 * GuideProvider listens for to reset the reader to the first chapter. On non-guide
 * pages nothing listens and the link navigates as usual.
 */
export function SiteLogo() {
  return (
    <Link
      href="/"
      className="flex shrink-0 items-center no-underline"
      aria-label="Carbon home"
      onClick={() => window.dispatchEvent(new CustomEvent("carbon:home"))}
    >
      <img src="/carbon-word-light.svg" alt="Carbon" width={99} height={24} className="block" />
    </Link>
  );
}
