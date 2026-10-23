// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuHistory } from "react-icons/lu";
import { useFetcher } from "react-router";
import { useDateFormatter, useQuantityFormatter } from "~/hooks";
import type { loader as revisionsLoader } from "~/routes/x+/timesheet.revisions.$entryId";
import { path } from "~/utils/path";
import { revisionHours } from "./TimesheetReviewBanner";

/**
 * The correction trail of one timesheet cell (DCAA mode): who changed it,
 * when, why, and the hours before and after. Loaded when it opens.
 */
export function TimesheetRevisionsPopover({ entryId }: { entryId: string }) {
  const { t } = useLingui();
  const { formatDateTime } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const fetcher = useFetcher<typeof revisionsLoader>();
  const revisions = fetcher.data?.revisions ?? [];
  const loadError = fetcher.data?.error ?? null;
  const isLoading = fetcher.state !== "idle" || !fetcher.data;

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) fetcher.load(path.to.timesheetRevisions(entryId));
      }}
    >
      <PopoverTrigger asChild>
        <IconButton
          aria-label={t`Show the changes to this entry`}
          icon={<LuHistory />}
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          // The grid cell opens its editor on click: keep this click here.
          onClick={(event) => event.stopPropagation()}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="mb-2 text-sm font-medium">
          <Trans>Changes</Trans>
        </p>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : loadError ? (
          <p className="text-sm text-muted-foreground">{loadError}</p>
        ) : revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No changes</Trans>
          </p>
        ) : (
          <ol className="flex max-h-72 flex-col gap-3 overflow-y-auto">
            {revisions.map((revision) => {
              const before = revisionHours(revision.before);
              const after = revisionHours(revision.after);
              return (
                <li key={revision.id} className="flex flex-col gap-0.5">
                  <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">
                      {revision.reviser?.fullName ?? ""}
                    </span>
                    <span className="shrink-0 whitespace-nowrap">
                      {formatDateTime(revision.revisedAt)}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums">
                    {before === null ? "—" : formatQuantity(before)} →{" "}
                    {after === null ? "—" : formatQuantity(after)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {revision.reason}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  );
}
