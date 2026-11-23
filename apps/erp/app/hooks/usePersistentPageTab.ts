// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useIsomorphicLayoutEffect, useRouteData } from "@carbon/react";
import { useCallback, useState } from "react";
import { useLocation } from "react-router";
import { path } from "~/utils/path";

/** Remembers a page tab without persisting choices inside temporary forms. */
export function usePersistentPageTab<T extends string>(
  tabId: string,
  allowedValues: readonly T[],
  defaultValue: T,
  queryParameter?: string
) {
  const { pathname, search } = useLocation();
  const identity = useRouteData<{
    user?: { id?: string };
    company?: { id?: string };
  }>(path.to.authenticatedRoot);
  const storageKey =
    identity?.user?.id && identity?.company?.id
      ? `carbon:pageTab:${identity.user.id}:${identity.company.id}:${pathname}:${tabId}`
      : null;
  const [value, setValue] = useState<T>(defaultValue);
  const choices = allowedValues.join("\u0000");
  const queryValue = queryParameter
    ? new URLSearchParams(search).get(queryParameter)
    : null;
  const explicitValue =
    queryValue && allowedValues.includes(queryValue as T)
      ? (queryValue as T)
      : null;

  // Match server markup during hydration, then restore before the first paint.
  useIsomorphicLayoutEffect(() => {
    if (!storageKey) return;
    try {
      if (explicitValue) {
        setValue(explicitValue);
        window.localStorage.setItem(storageKey, explicitValue);
        return;
      }
      const saved = window.localStorage.getItem(storageKey);
      setValue(
        saved && choices.split("\u0000").includes(saved)
          ? (saved as T)
          : defaultValue
      );
    } catch {
      setValue(defaultValue);
    }
  }, [storageKey, choices, defaultValue, explicitValue]);

  const select = useCallback(
    (next: string) => {
      if (!allowedValues.includes(next as T)) return;
      setValue(next as T);
      if (!storageKey) return;
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // The tab still changes if storage is unavailable.
      }
    },
    [allowedValues, storageKey]
  );

  return [explicitValue ?? value, select] as const;
}
