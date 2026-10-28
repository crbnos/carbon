// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import type { SerialNumberTiming } from "~/modules/settings/settings.models";

/** The name of each serial number timing, as Settings → Production shows it. */
export function useSerialNumberTimingLabels(): Record<
  SerialNumberTiming,
  string
> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      jobCreation: t`When the job is created`,
      jobRelease: t`When the job is released`,
      production: t`When the unit is produced`
    }),
    [t]
  );
}
