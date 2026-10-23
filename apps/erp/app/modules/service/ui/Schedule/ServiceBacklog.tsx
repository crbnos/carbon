// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { KeyboardEvent } from "react";
import { Link } from "react-router";
import { DateTime, Empty } from "~/components";
import { MatrixChip, MatrixOutsideZone } from "~/components/ScheduleMatrix";
import MaintenancePriority from "~/modules/resources/ui/Maintenance/MaintenancePriority";
import { path } from "~/utils/path";
import type { ScheduleBacklogJob } from "./ServiceSchedule";

/** The chip id of a backlog job; an assignment's chip id is its own id. */
export const BACKLOG_CHIP_PREFIX = "backlog:";

// The job link sits inside a draggable chip, which starts a keyboard drag on
// Enter. The link follows itself instead.
const keepKeysFromDrag = (event: KeyboardEvent) => event.stopPropagation();

type BacklogCardProps = {
  job: ScheduleBacklogJob;
  /** The drag overlay renders the card without its link. */
  isOverlay?: boolean;
  locationTimeZone?: string;
};

/** One open job no technician is assigned to. */
export function BacklogCard({
  job,
  isOverlay = false,
  locationTimeZone
}: BacklogCardProps) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-2 text-xs",
        isOverlay && "w-64 shadow-md"
      )}
    >
      <div className="flex w-full min-w-0 items-center gap-2">
        {isOverlay ? (
          <span className="whitespace-nowrap text-sm font-medium">
            {job.jobReadableId}
          </span>
        ) : (
          <Link
            to={path.to.serviceJob(job.id)}
            className="whitespace-nowrap text-sm font-medium underline-offset-4 hover:underline"
            onKeyDown={keepKeysFromDrag}
          >
            {job.jobReadableId}
          </Link>
        )}
        <MaintenancePriority
          priority={job.priority}
          className="ml-auto shrink-0 text-muted-foreground"
        />
      </div>
      {job.customerName && (
        <span className="w-full truncate">{job.customerName}</span>
      )}
      {job.problem && (
        <span className="w-full line-clamp-1 text-muted-foreground">
          {job.problem}
        </span>
      )}
      {job.dueDate && (
        <span className="text-muted-foreground">
          <Trans>Due</Trans>{" "}
          <DateTime
            value={job.dueDate}
            variant="date"
            locationTimeZone={locationTimeZone}
          />
        </span>
      )}
    </div>
  );
}

type ServiceBacklogProps = {
  backlog: ScheduleBacklogJob[];
  /** Assigning: a backlog card can be dragged onto the grid. */
  canAssign: boolean;
  /** Unassigning: a block can be dropped back here. */
  canUnassign: boolean;
  locationTimeZone?: string;
};

/**
 * The open jobs of the location that no technician is assigned to. Drag a
 * card onto a technician's day to assign it; drop a block here to unassign it.
 */
export function ServiceBacklog({
  backlog,
  canAssign,
  canUnassign,
  locationTimeZone
}: ServiceBacklogProps) {
  const { t } = useLingui();
  return (
    <MatrixOutsideZone
      disabled={!canUnassign}
      className="flex w-72 shrink-0 flex-col min-h-0 border-l border-border bg-card"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium">
          <Trans>Backlog</Trans>
        </h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {backlog.length}
        </span>
      </div>
      {backlog.length === 0 ? (
        <Empty
          className="px-4"
          title={t`No unassigned jobs`}
          description={t`Open jobs with no technician appear here.`}
        />
      ) : (
        <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-auto p-2">
          {backlog.map((job) => (
            <MatrixChip
              key={job.id}
              chipId={`${BACKLOG_CHIP_PREFIX}${job.id}`}
              rowId={null}
              date={null}
              disabled={!canAssign}
              className="flex w-full"
            >
              <BacklogCard job={job} locationTimeZone={locationTimeZone} />
            </MatrixChip>
          ))}
        </div>
      )}
    </MatrixOutsideZone>
  );
}
