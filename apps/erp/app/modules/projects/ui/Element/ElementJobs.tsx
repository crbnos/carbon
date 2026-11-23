// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuCirclePlay } from "react-icons/lu";
import { Link } from "react-router";
import { useDateFormatter, useQuantityFormatter } from "~/hooks";
import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { ProjectElementPage } from "../../projects.service";

/**
 * The jobs charged to an element, one row each under its children (in
 * `ElementChildren`'s list), linked to the job: its
 * number, the item, its status, how many it has completed of how many, and
 * its due date. A job shows here from the moment it exists, before it has
 * any cost.
 */
export function ElementJobs({ jobs }: { jobs: ProjectElementPage["jobs"] }) {
  const [items] = useItems();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );
  const idChars = Math.max(0, ...jobs.map((job) => job.jobId.length));

  return (
    <>
      {jobs.map((job) => {
        const item = itemById.get(job.itemId);
        const complete = formatQuantity(Number(job.quantityComplete ?? 0));
        const quantity = formatQuantity(Number(job.quantity ?? 0));
        return (
          <div
            key={job.id}
            className="group/row relative flex h-9 items-center gap-3 rounded-md px-3 transition-colors hover:bg-accent/50"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <LuCirclePlay className="size-3.5 shrink-0 text-muted-foreground" />
              <span
                className="shrink-0 whitespace-nowrap text-sm text-muted-foreground tabular-nums"
                style={{ minWidth: `${idChars}ch` }}
              >
                {job.jobId}
              </span>
              <Link
                to={path.to.job(job.id)}
                className="min-w-0 truncate text-sm before:absolute before:inset-0 before:content-[''] focus-visible:outline-none focus-visible:before:ring-1 focus-visible:before:ring-inset focus-visible:before:ring-ring"
              >
                {item
                  ? `${item.readableIdWithRevision} ${item.name}`
                  : job.jobId}
              </Link>
            </div>
            <div className="relative z-10 flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
              <span className="tabular-nums">
                <Trans>
                  {complete} of {quantity}
                </Trans>
              </span>
              {job.dueDate && (
                <span className="tabular-nums">{formatDate(job.dueDate)}</span>
              )}
              <JobStatus status={job.status} />
            </div>
          </div>
        );
      })}
    </>
  );
}
