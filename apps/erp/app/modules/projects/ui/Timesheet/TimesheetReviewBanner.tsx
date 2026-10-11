// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Json } from "@carbon/database";
import { useAction } from "@carbon/query";
import { Alert, AlertDescription, AlertTitle, Button } from "@carbon/react";
import { Plural, Trans } from "@lingui/react/macro";
import { LuCheck, LuUserPen } from "react-icons/lu";
import { useDateFormatter, useQuantityFormatter } from "~/hooks";
import { path } from "~/utils/path";

export type PendingReviewEntry = {
  id: string;
  entryDate: string;
  hours: number;
  project: { name: string; identifier: string | null } | null;
  element: { readableId: string; name: string } | null;
  revision: {
    reason: string;
    before: Json;
    after: Json;
    reviser: { fullName: string | null } | null;
  } | null;
};

/** The hours a revision's `before` or `after` snapshot holds, if any. */
export function revisionHours(snapshot: Json): number | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const hours = (snapshot as Record<string, Json | undefined>).hours;
  return typeof hours === "number" ? hours : null;
}

/**
 * DCAA mode: the entries another user changed wait for the employee. The
 * banner lists each change and accepts them all at once; an entry the
 * employee disagrees with can be changed in the grid instead.
 */
export function TimesheetReviewBanner({
  entries
}: {
  entries: PendingReviewEntry[];
}) {
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const fetcher = useAction();
  const isAccepting = fetcher.state !== "idle";
  if (entries.length === 0) return null;

  return (
    <Alert variant="warning">
      <LuUserPen />
      <AlertTitle>
        <Plural
          value={entries.length}
          one="# change to your timesheet waits for your review"
          other="# changes to your timesheet wait for your review"
        />
      </AlertTitle>
      <AlertDescription>
        <ul className="flex w-full flex-col gap-1 py-1">
          {entries.map((entry) => {
            const before = revisionHours(entry.revision?.before ?? null);
            const after = revisionHours(entry.revision?.after ?? null);
            const chargeNumber =
              entry.element?.readableId ?? entry.project?.identifier ?? "";
            return (
              <li
                key={entry.id}
                className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm"
              >
                <span className="whitespace-nowrap tabular-nums">
                  {formatDate(entry.entryDate)}
                </span>
                <span className="whitespace-nowrap font-mono text-xs">
                  {chargeNumber}
                </span>
                <span className="whitespace-nowrap tabular-nums">
                  {before === null ? "—" : formatQuantity(before)} →{" "}
                  {after === null ? "—" : formatQuantity(after)}
                </span>
                {entry.revision?.reviser?.fullName && (
                  <span className="whitespace-nowrap">
                    <Trans>by {entry.revision.reviser.fullName}</Trans>
                  </span>
                )}
                {entry.revision?.reason && (
                  <span className="min-w-0 truncate text-muted-foreground">
                    “{entry.revision.reason}”
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <fetcher.Form method="post" action={path.to.timesheetReview}>
          {entries.map((entry) => (
            <input key={entry.id} type="hidden" name="ids" value={entry.id} />
          ))}
          <Button
            type="submit"
            size="sm"
            leftIcon={<LuCheck />}
            isDisabled={isAccepting}
            isLoading={isAccepting}
          >
            <Trans>Accept changes</Trans>
          </Button>
        </fetcher.Form>
      </AlertDescription>
    </Alert>
  );
}
