import { Button, cn, Heading, IconButton } from "@carbon/react";
import {
  formatDateTimeInZone,
  formatDurationMilliseconds,
  formatRelativeTime
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactNode } from "react";
import {
  LuArrowRight,
  LuClock,
  LuHourglass,
  LuTimer,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
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
 * Date + time in an explicit zone (the plant's) — the reservation window.
 * `dateStyle`/`timeStyle` are cleared: `formatDateTimeInZone` defaults them to
 * "medium", and Intl throws (→ raw ISO) if they coexist with the component
 * options below.
 */
const TIMELINE_DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: undefined,
  timeStyle: undefined,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit"
};

type StatusTone = "conflict" | "estimated" | "scheduled" | "neutral";

const STATUS_DOT: Record<StatusTone, string> = {
  conflict: "bg-red-500",
  estimated: "bg-blue-500",
  scheduled: "bg-emerald-500",
  neutral: "bg-muted-foreground"
};

/**
 * Detail side panel for a selected Gantt row. Shared by the single-job
 * timeline (which passes the route's jobId) and the cross-job resource view
 * (where each detail carries its own owning jobId).
 *
 * `timeZone` is the plant's IANA zone — the forecast board is location-scoped,
 * so real reservation instants are shown on the plant's clock (and every
 * timestamp popover gains a Location row).
 */
export function TimelineDetail({
  detail,
  jobId,
  timeZone,
  onClose
}: {
  detail: TimelineNodeDetail;
  jobId?: string;
  timeZone?: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();

  // Approximate rows carry date-only values stored as UTC midnight; slice to
  // the bare date so no invented clock time (e.g. "05:30" in IST) leaks into
  // the panel — DateTime then renders it as a calendar date.
  const dateOnly = (iso: string) => iso.slice(0, 10);

  // stored end is EXCLUSIVE (due date + 1 day); show the inclusive due date —
  // one CALENDAR day earlier (via @internationalized/date, never JS Date ms
  // math), clamped so it never falls before the start.
  const approximateEndDate = detail.end
    ? (() => {
        const end = parseDate(dateOnly(detail.end)).subtract({ days: 1 });
        const start = detail.start ? parseDate(dateOnly(detail.start)) : null;
        return (start && end.compare(start) < 0 ? start : end).toString();
      })()
    : null;

  // A date-only operation that ALSO has a conflict was never placed at all —
  // its stored dates are backward-planning placeholders, not a booking.
  const isUnscheduled =
    detail.kind === "operation" &&
    detail.approximate &&
    !!detail.conflictReason;

  // A placeholder reservation for an operation the scheduler could NOT place.
  // Its window is a "where it would run" marker, not a real booking — show it
  // date-only and explain, so it never reads as a committed capacity slot.
  const isUnschedulablePlaceholder =
    detail.kind === "reservation" && !!detail.unschedulable;

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
          : detail.resourceKind === "WorkCenter"
            ? t`Work Center`
            : t`Resource`
  };

  const linkedJobId = detail.jobId ?? jobId;

  // Real (booked) reservations get plant-clock times; approximate/placeholder
  // rows stay date-only.
  const showTimes =
    !detail.approximate &&
    !isUnscheduled &&
    !isUnschedulablePlaceholder &&
    !!timeZone;

  const renderInstant = (iso: string, isApproximate: boolean) => {
    if (showTimes && !isApproximate) {
      return (
        <DateTime value={iso} locationTimeZone={timeZone} side="left">
          <span className="tabular-nums">
            {formatDateTimeInZone(
              iso,
              timeZone as string,
              locale,
              TIMELINE_DATETIME_OPTIONS
            )}
          </span>
        </DateTime>
      );
    }
    return (
      <DateTime
        value={isApproximate ? dateOnly(iso) : iso}
        locationTimeZone={timeZone}
        variant="date"
        dateOptions={TIMELINE_DATE_OPTIONS}
      />
    );
  };

  // Header status chip — mirrors the board legend so the panel reads at a glance.
  const status: { tone: StatusTone; label: string } = isUnschedulablePlaceholder
    ? { tone: "conflict", label: t`Unschedulable` }
    : detail.conflictReason
      ? { tone: "conflict", label: t`Conflict` }
      : isUnscheduled
        ? { tone: "conflict", label: t`Unscheduled` }
        : detail.approximate
          ? { tone: "estimated", label: t`Estimated` }
          : { tone: "scheduled", label: t`Scheduled` };

  // A zone-agnostic "starts in 3 days / 2 days ago" for booked rows.
  const relative =
    !detail.approximate &&
    !isUnscheduled &&
    !isUnschedulablePlaceholder &&
    detail.start
      ? formatRelativeTime(detail.start, locale)
      : null;

  const hasWork =
    !!detail.workMs &&
    detail.durationMs > 0 &&
    detail.durationMs - detail.workMs > 60_000; // >1 min gap — avoid noise

  const stats: { icon: ReactNode; label: string; value: string }[] = [];
  if (detail.durationMs > 0 && !isUnscheduled) {
    stats.push({
      icon: <LuClock className="size-3.5 shrink-0" />,
      label: hasWork ? t`Span` : t`Duration`,
      value: formatDurationMilliseconds(detail.durationMs, { style: "short" })
    });
  }
  if (hasWork) {
    stats.push({
      icon: <LuTimer className="size-3.5 shrink-0" />,
      label: t`Work`,
      value: formatDurationMilliseconds(detail.workMs as number, {
        style: "short"
      })
    });
  }
  if (detail.waitMs && detail.waitMs > 0) {
    stats.push({
      icon: <LuHourglass className="size-3.5 shrink-0" />,
      label: t`Waited`,
      value: formatDurationMilliseconds(detail.waitMs, { style: "short" })
    });
  }

  return (
    <div className="flex h-full flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="font-mono text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            {kindLabel[detail.kind]}
          </span>
          <Heading size="h3" className="truncate">
            {detail.title}
          </Heading>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <span
                className={cn("size-1.5 rounded-full", STATUS_DOT[status.tone])}
              />
              {status.label}
            </span>
            {relative && (
              <>
                <span className="text-border">·</span>
                <span className="tabular-nums">{relative}</span>
              </>
            )}
          </div>
        </div>
        <IconButton
          aria-label={t`Close`}
          variant="ghost"
          icon={<LuX />}
          onClick={onClose}
        />
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {detail.conflictReason && (
          <div className="flex w-full items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
            <LuTriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span className="text-pretty">
              <MessageWithDates
                text={detail.conflictReason}
                timeZone={timeZone}
              />
            </span>
          </div>
        )}

        {isUnschedulablePlaceholder && (
          <p className="text-sm italic text-muted-foreground text-pretty">
            <Trans>
              This operation can't be scheduled yet — the bar marks where it
              would run once the conflict is resolved. It isn't holding
              capacity.
            </Trans>
          </p>
        )}

        {/* Why the row starts when it does — hidden when a conflict is shown,
            the conflict message already names the same cause */}
        {detail.scheduleNote && !detail.conflictReason && (
          <div className="flex w-full items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            <LuClock className="mt-0.5 size-4 shrink-0" />
            <span className="text-pretty">
              <MessageWithDates
                text={detail.scheduleNote}
                timeZone={timeZone}
              />
            </span>
          </div>
        )}

        {/* Metrics — glanceable stat tiles, hairline-divided */}
        {stats.length > 0 && (
          <div className="flex divide-x divide-border overflow-hidden rounded-lg border border-border bg-background">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex flex-1 flex-col gap-1 px-3 py-2.5"
              >
                <span className="flex items-center gap-1 font-mono text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
                  {stat.icon}
                  {stat.label}
                </span>
                <span className="text-lg font-semibold tabular-nums leading-none text-foreground">
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {isUnscheduled ? (
          <p className="text-sm italic text-muted-foreground text-pretty">
            <Trans>
              Not scheduled — no feasible slot. The stored dates are
              backward-planning placeholders, not a real booking.
            </Trans>
          </p>
        ) : (
          <dl className="w-full">
            {detail.status && (
              <DetailRow label={t`Status`} value={detail.status} />
            )}
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
            {detail.start && (
              <DetailRow
                label={t`Starts`}
                value={renderInstant(detail.start, detail.approximate)}
              />
            )}
            {detail.end && approximateEndDate ? (
              <DetailRow
                label={t`Ends`}
                value={renderInstant(
                  detail.approximate ? approximateEndDate : detail.end,
                  detail.approximate
                )}
              />
            ) : (
              detail.start && (
                <DetailRow label={t`Ends`} value={t`In progress`} />
              )
            )}
          </dl>
        )}

        {detail.approximate && !isUnscheduled && (
          <p className="text-xs text-muted-foreground text-pretty">
            <Trans>
              Approximate — derived from scheduled dates; no capacity
              reservation exists for this row.
            </Trans>
          </p>
        )}
      </div>

      {/* Footer action */}
      {linkedJobId && (
        <div className="border-t border-border p-4">
          <Button
            asChild
            variant="primary"
            className="w-full justify-between"
            rightIcon={<LuArrowRight />}
          >
            <Link to={path.to.job(linkedJobId)}>
              <Trans>Open job</Trans>
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border py-2.5 text-sm first:border-t-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

// The scheduler's conflict / schedule-note sentences embed bare YYYY-MM-DD dates
// (e.g. "Finishes 2026-08-19 but the job is due 2026-08-18 …"). Match those and
// render each as a normalized DateTime so they read like the Starts/Ends rows and
// carry the same time-zone popover; all other text passes through verbatim.
const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/g;

function MessageWithDates({
  text,
  timeZone
}: {
  text: string;
  timeZone?: string;
}) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(DATE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) nodes.push(text.slice(lastIndex, start));
    nodes.push(
      <DateTime
        key={key++}
        value={match[0]}
        locationTimeZone={timeZone}
        variant="date"
        dateOptions={TIMELINE_DATE_OPTIONS}
      />
    );
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <>{nodes}</>;
}
