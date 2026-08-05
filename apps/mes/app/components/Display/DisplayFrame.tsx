import { cn, useInterval } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import type { DisplayStatus } from "~/utils/display";

/**
 * The shell every work center display shares: a full-width header band carrying
 * the work center name, coloured green or red by a single derived state, over a
 * dark scoreboard body.
 *
 * Everything here is sized for reading across a shop floor rather than at a
 * desk — hence `clamp()` type that scales with the viewport, tabular numerals so
 * ticking digits do not reflow, and no interactive affordances at all. These
 * pages run unattended on a wall for months.
 */

type DisplayFrameProps = {
  workCenterName: string;
  title: React.ReactNode;
  status: DisplayStatus;
  /** Short phrase naming *why* the display is red. Ignored when status is ok. */
  alertLabel?: React.ReactNode;
  /** Shown in the header band opposite the title when status is ok. */
  okLabel?: React.ReactNode;
  /** Poll interval in ms. `null` disables auto-refresh. */
  refreshInterval?: number | null;
  children: React.ReactNode;
};

export function DisplayFrame({
  workCenterName,
  title,
  status,
  alertLabel,
  okLabel,
  refreshInterval = 30_000,
  children
}: DisplayFrameProps) {
  const revalidator = useRevalidator();
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // A wall display's worst failure is silent: the browser wedges and the screen
  // keeps showing hours-old data as though it were live. Revalidating on an
  // interval and stamping the result gives the footer something to prove
  // freshness with.
  useInterval(() => {
    if (revalidator.state === "idle") revalidator.revalidate();
  }, refreshInterval);

  useEffect(() => {
    if (revalidator.state === "idle") setLastUpdated(new Date());
  }, [revalidator.state]);

  const isAlert = status === "alert";

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-zinc-950 text-white">
      <header
        className={cn(
          "flex shrink-0 items-baseline justify-between gap-6 px-[2vw] py-[1.2vh] transition-colors duration-500",
          isAlert ? "bg-red-600" : "bg-emerald-500"
        )}
      >
        <h1
          className="truncate font-bold leading-none tracking-tight text-white"
          style={{ fontSize: "clamp(1.75rem, 4.4vw, 5.5rem)" }}
          title={workCenterName}
        >
          {workCenterName}
        </h1>
        <div
          className="shrink-0 text-right font-semibold uppercase leading-tight tracking-widest text-white/90"
          style={{ fontSize: "clamp(0.7rem, 1.15vw, 1.5rem)" }}
        >
          <div>{title}</div>
          {isAlert && alertLabel ? (
            <div className="font-bold text-white">{alertLabel}</div>
          ) : null}
          {!isAlert && okLabel ? (
            <div className="font-normal text-white/80">{okLabel}</div>
          ) : null}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">{children}</main>

      <DisplayFooter
        lastUpdated={lastUpdated}
        isRefreshing={revalidator.state !== "idle"}
        isAlert={isAlert}
      />
    </div>
  );
}

function DisplayFooter({
  lastUpdated,
  isRefreshing,
  isAlert
}: {
  lastUpdated: Date | null;
  isRefreshing: boolean;
  isAlert: boolean;
}) {
  const clock = useClock();

  return (
    <footer
      className="flex shrink-0 items-center justify-between gap-4 border-t border-white/10 bg-black/40 px-[2vw] py-[0.6vh] font-medium uppercase tracking-widest text-white/40"
      style={{ fontSize: "clamp(0.55rem, 0.85vw, 1rem)" }}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-2 rounded-full transition-opacity duration-300",
            isAlert ? "bg-red-500" : "bg-emerald-400",
            isRefreshing ? "opacity-40" : "opacity-100"
          )}
        />
        <span>
          {lastUpdated ? (
            <Trans>Updated {formatClock(lastUpdated)}</Trans>
          ) : (
            <Trans>Connecting</Trans>
          )}
        </span>
      </div>
      <span className="tabular-nums">{clock}</span>
    </footer>
  );
}

function formatClock(date: Date) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

/**
 * Rendered client-side only — the server has no idea what time it is where the
 * screen hangs, and an SSR'd clock hydrates mismatched.
 */
function useClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => setNow(formatClock(new Date())), []);
  useInterval(() => setNow(formatClock(new Date())), 1000);
  return now ?? "";
}
