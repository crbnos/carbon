import { Badge, Heading, HStack, IconButton, VStack } from "@carbon/react";
import { DAY_MS, formatDurationMilliseconds } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuClock, LuTriangleAlert, LuX } from "react-icons/lu";
import { Link } from "react-router";
import { DateTime } from "~/components";
import { path } from "~/utils/path";
import type { TimelineNodeDetail } from "./timeline";

/** Date-only inline text ("11 Aug 2026"); exact times live in the popover. */
export const TIMELINE_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric"
};

/**
 * Detail side panel for a selected Gantt row. Shared by the single-job
 * timeline (which passes the route's jobId) and the cross-job resource view
 * (where each detail carries its own owning jobId).
 */
export function TimelineDetail({
  detail,
  jobId,
  onClose
}: {
  detail: TimelineNodeDetail;
  jobId?: string;
  onClose: () => void;
}) {
  const { t } = useLingui();

  // Approximate rows carry date-only values stored as UTC midnight; slice to
  // the bare date so no invented clock time (e.g. "05:30" in IST) leaks into
  // the panel — DateTime then renders it as a calendar date.
  const dateOnly = (iso: string) => iso.slice(0, 10);

  // stored end is EXCLUSIVE (due date + 1 day); show the inclusive due date,
  // never earlier than the start
  const approximateEndDate = detail.end
    ? dateOnly(
        new Date(
          Math.max(
            Date.parse(detail.end) - DAY_MS,
            detail.start ? Date.parse(detail.start) : 0
          )
        ).toISOString()
      )
    : null;

  // A date-only operation that ALSO has a conflict was never placed at all —
  // its stored dates are backward-planning placeholders, not a booking.
  const isUnscheduled =
    detail.kind === "operation" &&
    detail.approximate &&
    !!detail.conflictReason;

  const kindLabel: Record<TimelineNodeDetail["kind"], string> = {
    job: t`Job`,
    assembly: t`Assembly`,
    operation: t`Operation`,
    reservation:
      detail.resourceKind === "Employee"
        ? t`Operator Reservation`
        : detail.resourceKind === "OperatorPool"
          ? t`Operator Pool Reservation`
          : t`Work Center Reservation`,
    productionEvent: t`Production Event`,
    resource:
      detail.resourceKind === "Employee"
        ? t`Operator`
        : detail.resourceKind === "OperatorPool"
          ? t`Operator Pool`
          : t`Work Center`
  };

  const linkedJobId = detail.jobId ?? jobId;

  return (
    <VStack
      spacing={4}
      className="h-full overflow-y-auto border-l border-border bg-card p-4"
    >
      <HStack className="w-full justify-between">
        <VStack spacing={1}>
          <Badge variant="secondary">{kindLabel[detail.kind]}</Badge>
          <Heading size="h3">{detail.title}</Heading>
        </VStack>
        <IconButton
          aria-label={t`Close`}
          variant="ghost"
          icon={<LuX />}
          onClick={onClose}
        />
      </HStack>

      {detail.conflictReason && (
        <div className="flex w-full items-start gap-2 rounded-md border border-red-500 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          <LuTriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{detail.conflictReason}</span>
        </div>
      )}

      {/* Why the row starts when it does — hidden when a conflict is shown,
          the conflict message already names the same cause */}
      {detail.scheduleNote && !detail.conflictReason && (
        <div className="flex w-full items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          <LuClock className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{detail.scheduleNote}</span>
        </div>
      )}

      <VStack spacing={2} className="w-full text-sm">
        {detail.status && <DetailRow label={t`Status`} value={detail.status} />}
        {detail.jobReadableId && (
          <DetailRow label={t`Job`} value={detail.jobReadableId} />
        )}
        {detail.workCenterName && (
          <DetailRow label={t`Work Center`} value={detail.workCenterName} />
        )}
        {detail.assigneeName && (
          <DetailRow label={t`Assignee`} value={detail.assigneeName} />
        )}
        {detail.employeeName && (
          <DetailRow label={t`Employee`} value={detail.employeeName} />
        )}
        {isUnscheduled ? (
          <p className="text-xs italic text-muted-foreground">
            <Trans>
              Not scheduled — no feasible slot. The stored dates are
              backward-planning placeholders, not a real booking.
            </Trans>
          </p>
        ) : (
          <>
            {detail.start && (
              <DetailRow
                label={t`Starts`}
                value={
                  <DateTime
                    value={
                      detail.approximate ? dateOnly(detail.start) : detail.start
                    }
                    variant="date"
                    dateOptions={TIMELINE_DATE_OPTIONS}
                  />
                }
              />
            )}
            {detail.end && approximateEndDate ? (
              <DetailRow
                label={t`Ends`}
                value={
                  <DateTime
                    value={detail.approximate ? approximateEndDate : detail.end}
                    variant="date"
                    dateOptions={TIMELINE_DATE_OPTIONS}
                  />
                }
              />
            ) : (
              detail.start && (
                <DetailRow label={t`Ends`} value={t`In progress`} />
              )
            )}
            {/* A gated op's span includes off-shift pauses: show the actual
                work content alongside the wall-clock span so "22h" reads as
                "6h of work across 22h", not 22 hours of soldering */}
            {detail.workMs &&
            detail.durationMs > 0 &&
            // >1 min gap — avoid noise from rounding
            detail.durationMs - detail.workMs > 60_000 ? (
              <DetailRow
                label={t`Duration`}
                value={t`${formatDurationMilliseconds(detail.workMs, {
                  style: "short"
                })} of work across ${formatDurationMilliseconds(
                  detail.durationMs,
                  { style: "short" }
                )}`}
              />
            ) : (
              <DetailRow
                label={t`Duration`}
                value={
                  detail.durationMs > 0
                    ? formatDurationMilliseconds(detail.durationMs, {
                        style: "short"
                      })
                    : "—"
                }
              />
            )}
            {!!detail.waitMs && detail.waitMs > 0 && (
              <DetailRow
                label={t`Waited`}
                value={formatDurationMilliseconds(detail.waitMs, {
                  style: "short"
                })}
              />
            )}
            {detail.approximate && (
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Approximate — derived from scheduled dates; no capacity
                  reservation exists for this row.
                </Trans>
              </p>
            )}
          </>
        )}
      </VStack>

      {linkedJobId && (
        <Link
          to={path.to.job(linkedJobId)}
          className="text-sm font-medium text-primary hover:underline"
        >
          <Trans>Open Job</Trans>
        </Link>
      )}
    </VStack>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <HStack className="w-full justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </HStack>
  );
}
