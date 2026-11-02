// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback, useEffect, useRef } from "react";

/**
 * Paints a theme's variables onto `<body>` at once, ahead of the root loader.
 * The preview outranks the theme the root document puts on `<html>`, so it is
 * removed once `settled` (the save landed and the root revalidated) and on
 * unmount; left behind, it would cover the theme another page renders.
 */
export function useThemePreview(settled: boolean) {
  const previewed = useRef(new Set<string>());

  const clear = useCallback(() => {
    for (const key of previewed.current) {
      document.body.style.removeProperty(`--${key}`);
    }
    previewed.current.clear();
  }, []);

  useEffect(() => {
    if (settled) clear();
  }, [settled, clear]);

  useEffect(() => clear, [clear]);

  return useCallback((variables: Record<string, string>) => {
    for (const [key, value] of Object.entries(variables)) {
      document.body.style.setProperty(`--${key}`, value);
      previewed.current.add(key);
    }
  }, []);
}
