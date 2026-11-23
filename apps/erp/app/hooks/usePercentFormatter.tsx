// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { PERCENT_FORMAT, PROGRESS_FORMAT } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";

/**
 * A percent formatter for 0-1 fractions. `rate` (the default) keeps a rate's
 * digits, "6.25%"; `progress` is whole percents, "13%", for the figure beside
 * a progress bar.
 */
export function usePercentFormatter(kind: "rate" | "progress" = "rate") {
  const { locale } = useLocale();

  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(
        locale,
        kind === "progress" ? PROGRESS_FORMAT : PERCENT_FORMAT
      ),
    [locale, kind]
  );
  return formatter;
}
