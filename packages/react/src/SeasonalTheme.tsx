// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isSeasonalTheme } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useRouteData } from "./hooks/useRouteData";
import { cn } from "./utils/cn";

/**
 * Whether a seasonal theme is on (the root loader rendered one). The theme
 * pickers are disabled while it is: a pick would not show until the season
 * ends.
 */
export function useSeasonalTheme() {
  const root = useRouteData<{ theme?: string }>("/");
  return isSeasonalTheme(root?.theme);
}

/** Why a theme picker is disabled; nothing outside a season. */
export function SeasonalThemeNotice({ className }: { className?: string }) {
  const seasonal = useSeasonalTheme();
  if (!seasonal) return null;
  return (
    <p className={cn("text-xs text-muted-foreground text-pretty", className)}>
      <Trans>
        A seasonal theme is on for everyone today. You can pick yours again once
        it ends.
      </Trans>
    </p>
  );
}
