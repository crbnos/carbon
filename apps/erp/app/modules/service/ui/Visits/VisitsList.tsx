// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuCalendarPlus, LuExternalLink, LuPencil } from "react-icons/lu";
import { Link } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { path } from "~/utils/path";
import type { ServiceVisit } from "../../types";
import { ServiceVisitStatus } from "../ServiceStatus";
import { VisitStatusActions } from "./VisitStatusActions";

/**
 * The visits of one order, earliest first: who goes, when, and how far each
 * has got. A dispatcher schedules and moves visits; a technician moves their
 * own visit through travel, arrival and completion.
 */
export default function VisitsList({
  serviceOrderId,
  visits,
  userId,
  canSchedule,
  canUpdateAny
}: {
  serviceOrderId: string;
  visits: ServiceVisit[];
  userId: string;
  /** May schedule and move visits (`update: "service"`, order open). */
  canSchedule: boolean;
  /** May move any visit's status, not only their own. */
  canUpdateAny: boolean;
}) {
  return (
    <section className="flex w-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          <Trans>Visits</Trans>
        </h2>
        {canSchedule ? (
          <Button variant="secondary" leftIcon={<LuCalendarPlus />} asChild>
            <Link to={path.to.newServiceVisit(serviceOrderId)}>
              <Trans>Schedule Visit</Trans>
            </Link>
          </Button>
        ) : (
          <Button variant="secondary" leftIcon={<LuCalendarPlus />} isDisabled>
            <Trans>Schedule Visit</Trans>
          </Button>
        )}
      </div>
      <div className="rounded-lg border border-border">
        {visits.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            <Trans>No visits yet. Schedule one to send a technician.</Trans>
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {visits.map((visit) => {
              const mayMove = canUpdateAny || visit.technicianId === userId;
              return (
                <li
                  key={visit.id}
                  className="flex flex-col gap-3 px-4 py-3 @container"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <EmployeeAvatar employeeId={visit.technicianId} />
                      <ServiceVisitStatus status={visit.status} />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <DateTime
                        value={visit.plannedStart}
                        variant="absolute"
                        fallback={<Trans>Not planned</Trans>}
                      />
                      {visit.plannedEnd && (
                        <>
                          <span aria-hidden>–</span>
                          <DateTime value={visit.plannedEnd} variant="time" />
                        </>
                      )}
                    </div>
                  </div>
                  {(visit.travelStartedAt ||
                    visit.arrivedAt ||
                    visit.completedAt) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {visit.travelStartedAt && (
                        <span>
                          <Trans>
                            Travel started{" "}
                            <DateTime
                              value={visit.travelStartedAt}
                              variant="time"
                            />
                          </Trans>
                        </span>
                      )}
                      {visit.arrivedAt && (
                        <span>
                          <Trans>
                            Arrived{" "}
                            <DateTime value={visit.arrivedAt} variant="time" />
                          </Trans>
                        </span>
                      )}
                      {visit.completedAt && (
                        <span>
                          <Trans>
                            Completed{" "}
                            <DateTime
                              value={visit.completedAt}
                              variant="absolute"
                            />
                          </Trans>
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <VisitStatusActions
                      serviceOrderId={serviceOrderId}
                      visitId={visit.id}
                      status={visit.status}
                      isDisabled={!mayMove}
                    />
                    <Button
                      variant="ghost"
                      leftIcon={<LuExternalLink />}
                      asChild
                    >
                      <Link to={path.to.serviceVisit(serviceOrderId, visit.id)}>
                        <Trans>Open Visit</Trans>
                      </Link>
                    </Button>
                    {visit.status === "Scheduled" && canSchedule && (
                      <Button variant="ghost" leftIcon={<LuPencil />} asChild>
                        <Link
                          to={`${path.to.newServiceVisit(serviceOrderId)}?visitId=${visit.id}`}
                        >
                          <Trans>Reschedule</Trans>
                        </Link>
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
