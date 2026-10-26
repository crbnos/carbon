// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { useFetchers } from "react-router";
import { path } from "~/utils/path";

type Result = {
  data: { copied?: number; updated?: number; created?: number } | null;
  error: { message: string } | null;
};

/**
 * Toasts what the people board's writes answered. They post through keyed
 * fetchers (one per person, so a second drag never cancels the first), and
 * only the board reads them back: a refusal, or the count a copy, an
 * overtime or a time-off range reports. `useFetchers()` lists in-flight
 * fetchers only, so a result is read while the page revalidates after it.
 */
export function usePeopleBoardFeedback() {
  const { t } = useLingui();
  const fetchers = useFetchers();
  const answered = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const fetcher of fetchers) {
      if (fetcher.formAction !== path.to.priorityPeopleUpdate) continue;
      if (fetcher.state === "submitting") {
        answered.current.delete(fetcher.key);
        continue;
      }
      const result = fetcher.data as Result | undefined;
      if (!result || answered.current.has(fetcher.key)) continue;
      answered.current.add(fetcher.key);

      if (result.error) {
        toast.error(result.error.message);
        continue;
      }
      const intent = fetcher.formData?.get("intent");
      const counts = result.data ?? {};
      // Separate messages, not plural(): this runs inside an effect callback,
      // where the macro would reach for the global i18n instance.
      if (intent === "copy" || intent === "copy-week") {
        const copied = counts.copied ?? 0;
        toast.success(
          copied === 1
            ? t`Copied 1 assignment`
            : t`Copied ${copied} assignments`
        );
      } else if (intent === "overtime-bulk") {
        const updated = counts.updated ?? 0;
        toast.success(
          updated === 1
            ? t`Overtime set for 1 assignment`
            : t`Overtime set for ${updated} assignments`
        );
      } else if (intent === "absent-range") {
        const created = counts.created ?? 0;
        toast.success(
          created === 1
            ? t`Marked absent for 1 day`
            : t`Marked absent for ${created} days`
        );
      }
    }
  }, [fetchers, t]);
}
