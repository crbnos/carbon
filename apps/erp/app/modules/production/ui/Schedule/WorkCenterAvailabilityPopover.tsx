import { cn, Popover, PopoverContent, PopoverTrigger } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheck, LuInfo } from "react-icons/lu";

/** One shift's schedule, as the forecast board understands it. */
export type AvailabilityShift = {
  name: string;
  startTime: string; // "HH:MM[:SS]"
  endTime: string; // "HH:MM[:SS]"
  /** Mon-first weekday flags: [Mon, Tue, Wed, Thu, Fri, Sat, Sun]. */
  days: boolean[];
};

/** The winning rung of the availability ladder, plus the shifts each rung sees. */
export type WorkCenterAvailability = {
  tier: "alwaysOn" | "workCenterShift" | "locationShift" | "default";
  workCenterShifts: AvailabilityShift[];
  locationShifts: AvailabilityShift[];
  /** A process on this station needs a qualified operator (`process.requiresAbility`). */
  requiresQualifiedOperator: boolean;
  /** Lights-out (`workCenter.alwaysOn`): runs unattended, exempt from staffing. */
  lightsOut: boolean;
  /** The location's "Require staffing to schedule" policy is on. */
  locationRequiresStaffing: boolean;
};

type Rung = WorkCenterAvailability["tier"];

// Mon-first, matching AvailabilityShift.days. Single-letter labels keep the
// strip compact; the tooltip is not the place for full weekday names.
const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/** "08:00:00" → "08:00" — a shift is wall-clock, never an instant, so no zone. */
function shortTime(time: string) {
  return time.slice(0, 5);
}

/**
 * Info popover for a work center on the Forecast board. Explains — in plain
 * language — how the station's available hours were resolved: the scheduler
 * walks a ladder and uses the FIRST rule that applies, so this makes that
 * layering visible and shows the concrete schedule behind the bars.
 *
 * Mirrors the "explain a computed value" popover pattern used by the production
 * planning drawer (`PlannedOrderDetailsPopover`).
 */
export function WorkCenterAvailabilityPopover({
  availability
}: {
  availability: WorkCenterAvailability;
}) {
  const { t } = useLingui();

  const rungs: {
    key: Rung;
    label: string;
    hint: string;
  }[] = [
    {
      key: "alwaysOn",
      label: t`Lights-out (24/7)`,
      hint: t`Runs around the clock`
    },
    {
      key: "workCenterShift",
      label: t`Work center shifts`,
      hint: t`Shifts assigned to this station`
    },
    {
      key: "locationShift",
      label: t`Location shifts`,
      hint: t`The site's shifts`
    },
    {
      key: "default",
      label: t`Default schedule`,
      hint: t`Mon–Fri, 8 hours a day`
    }
  ];

  const activeIndex = rungs.findIndex((r) => r.key === availability.tier);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t`How are these hours calculated?`}
          // Stop the row's onClick (which selects the node) from firing.
          onClick={(e) => e.stopPropagation()}
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <LuInfo className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        className="w-80 pointer-events-auto"
        onWheel={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium">
              <Trans>Available hours</Trans>
            </div>
            <p className="text-xs text-muted-foreground text-pretty">
              <Trans>
                The scheduler uses the first rule below that applies, then
                subtracts downtime and staffing.
              </Trans>
            </p>
          </div>

          {/* The ladder — the winning rung is marked; the rest are dimmed. */}
          <ol className="flex flex-col gap-0.5">
            {rungs.map((rung, index) => {
              const isActive = index === activeIndex;
              const isReached = index <= activeIndex;
              return (
                <li
                  key={rung.key}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-2 py-1.5",
                    isActive && "bg-muted"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                      isActive
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-border text-transparent"
                    )}
                  >
                    <LuCheck className="size-3" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "text-sm",
                          isActive
                            ? "font-medium text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        {rung.label}
                      </span>
                      {isActive ? (
                        <span className="text-[0.625rem] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-500">
                          <Trans>In use</Trans>
                        </span>
                      ) : (
                        <span className="text-[0.625rem] uppercase tracking-wide text-muted-foreground/60">
                          {isReached ? (
                            <Trans>Not set</Trans>
                          ) : (
                            <Trans>Not reached</Trans>
                          )}
                        </span>
                      )}
                    </div>
                    {isActive && (
                      <div className="mt-1">
                        <ActiveTierDetail availability={availability} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Adjustments applied on top of the resolved hours — always true. */}
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            <div className="text-xs font-medium text-muted-foreground">
              <Trans>Then adjusted for</Trans>
            </div>
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              <li className="text-pretty">
                <Trans>
                  Maintenance that takes the station offline is removed.
                </Trans>
              </li>
              <li className="text-pretty">
                {availability.requiresQualifiedOperator ? (
                  <Trans>
                    This station runs ability-gated work — it only runs while a
                    qualified operator is on shift; operators assigned on the
                    manning board further shape available labor.
                  </Trans>
                ) : (
                  <Trans>
                    This station runs work with no ability requirement;
                    operators assigned on the manning board shape available
                    labor.
                  </Trans>
                )}
              </li>
            </ul>
          </div>

          {/* Staffing requirement — explains why an unstaffed station may show
              no work when the location enforces staffing. */}
          {availability.locationRequiresStaffing && (
            <div className="flex flex-col gap-1 border-t border-border pt-2">
              <div className="text-xs font-medium text-muted-foreground">
                <Trans>Staffing required</Trans>
              </div>
              <p className="text-xs text-muted-foreground text-pretty">
                {availability.lightsOut ? (
                  <Trans>
                    This location only schedules staffed work centers, but this
                    is a lights-out (24×7) station — it is exempt and keeps
                    running unattended.
                  </Trans>
                ) : (
                  <Trans>
                    This location only schedules work where an operator is
                    assigned on the manning board. With no one assigned here,
                    work is not scheduled and shows as unschedulable.
                  </Trans>
                )}
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ActiveTierDetail({
  availability
}: {
  availability: WorkCenterAvailability;
}) {
  const { tier, workCenterShifts, locationShifts } = availability;

  if (tier === "alwaysOn") {
    return (
      <p className="text-xs text-muted-foreground text-pretty">
        <Trans>Available 24 hours a day, 7 days a week.</Trans>
      </p>
    );
  }

  if (tier === "default") {
    return (
      <p className="text-xs text-muted-foreground tabular-nums">
        <Trans>Monday–Friday, 08:00–16:00</Trans>
      </p>
    );
  }

  const shifts = tier === "workCenterShift" ? workCenterShifts : locationShifts;

  if (shifts.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {shifts.map((shift) => (
        <li key={shift.name} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-foreground">
              {shift.name}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {shortTime(shift.startTime)}–{shortTime(shift.endTime)}
            </span>
          </div>
          <WeekdayStrip days={shift.days} />
        </li>
      ))}
    </ul>
  );
}

function WeekdayStrip({ days }: { days: boolean[] }) {
  return (
    <div className="flex gap-0.5">
      {WEEKDAY_INITIALS.map((initial, index) => {
        const on = days[index] ?? false;
        return (
          <span
            key={index}
            className={cn(
              "flex size-4 items-center justify-center rounded-sm text-[0.625rem] font-medium",
              on
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground/40"
            )}
          >
            {initial}
          </span>
        );
      })}
    </div>
  );
}
