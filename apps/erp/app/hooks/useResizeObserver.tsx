// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { RefObject } from "react";
import { useEffect, useState } from "react";

export function useResizeObserver(
  elementRef: RefObject<Element>
): ResizeObserverEntry | undefined {
  const [entry, setEntry] = useState<ResizeObserverEntry>();

  const updateEntry = ([entry]: ResizeObserverEntry[]): void => {
    setEntry(entry);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    const node = elementRef?.current;
    if (!node) return;

    const observer = new ResizeObserver(updateEntry);

    observer.observe(node);

    return () => observer.disconnect();
  }, [elementRef]);

  return entry;
}
