// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { useEffect } from "react";

/* Lights the rail entry you are currently reading.
 *
 * Deliberately additive: every entry is already in the SSR HTML and fully visible, and
 * this only toggles an attribute on them. The earlier treatment faded entries IN as they
 * scrolled into view, which gated content behind the scroll and read as lag. */
export function ChangelogActiveEntry() {
  useEffect(() => {
    const articles = Array.from(document.querySelectorAll<HTMLElement>("article[id]"));
    if (articles.length === 0) return;

    const setActive = (target: Element) => {
      for (const article of articles) {
        article.toggleAttribute("data-active", article === target);
      }
    };

    // A thin band across the upper third: whichever entry crosses it is the one being
    // read. Between entries nothing intersects, so the last one stays lit.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target);
        }
      },
      { rootMargin: "-22% 0px -70% 0px" }
    );

    for (const article of articles) observer.observe(article);
    return () => observer.disconnect();
  }, []);

  return null;
}
