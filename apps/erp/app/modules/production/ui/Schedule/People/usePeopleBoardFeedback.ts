// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toastServiceError } from "@carbon/query";
import { toast } from "@carbon/react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { useFetchers } from "react-router";
import { path } from "~/utils/path";

type Result = {
  data: {
    copied?: number;
    updated?: number;
    created?: number;
    assigned?: number;
    skipped?: number;
    personDays?: number;
  } | null;
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
        toastServiceError(result);
        continue;
      }
      const intent = fetcher.formData?.get("intent");
      const counts = result.data ?? {};
      if (intent === "copy" || intent === "copy-week") {
        toast.success(
          t`${plural(counts.copied ?? 0, {
            one: "Copied # assignment",
            other: "Copied # assignments"
          })}`
        );
      } else if (intent === "overtime-bulk") {
        // the same unit the dialog previewed: people for a day, person-days
        // for a week (a person split across stations is one)
        const count = counts.personDays ?? counts.updated ?? 0;
        toast.success(
          fetcher.formData?.get("toDate")
            ? t`${plural(count, {
                one: "Overtime set on # person-day",
                other: "Overtime set on # person-days"
              })}`
            : t`${plural(count, {
                one: "Overtime set for # person",
                other: "Overtime set for # people"
              })}`
        );
      } else if (intent === "assign-week") {
        const assigned = counts.assigned ?? 0;
        const skipped = counts.skipped ?? 0;
        if (assigned === 0) {
          toast.info(
            t`Nothing assigned: every working day this week is already booked or off`
          );
        } else if (skipped === 0) {
          toast.success(
            t`${plural(assigned, {
              one: "Assigned for # working day",
              other: "Assigned for # working days"
            })}`
          );
        } else {
          toast.success(
            t`${plural(assigned, {
              one: "Assigned for # working day",
              other: "Assigned for # working days"
            })}; ${plural(skipped, {
              one: "# day already booked or off was kept",
              other: "# days already booked or off were kept"
            })}`
          );
        }
      } else if (intent === "absent-range") {
        toast.success(
          t`${plural(counts.created ?? 0, {
            one: "Marked absent for # day",
            other: "Marked absent for # days"
          })}`
        );
      }
    }
  }, [fetchers, t]);
}
