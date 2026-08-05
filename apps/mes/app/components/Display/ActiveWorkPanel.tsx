import { cn, useInterval } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import type { ActiveWork } from "~/services/display.service";
import { formatElapsed, getProgress } from "~/utils/display";

/**
 * The hero band of the work display: what is running at this work center right
 * now. Usually one card; several when more than one operator is clocked onto
 * the work center at once.
 */
export function ActiveWorkPanel({
  activeWork,
  lastEventEndedAt
}: {
  activeWork: ActiveWork[];
  lastEventEndedAt: string | null;
}) {
  if (activeWork.length === 0) {
    return <IdlePanel lastEventEndedAt={lastEventEndedAt} />;
  }

  return (
    <div
      className={cn(
        "grid min-h-0 flex-1 gap-[1vw] p-[2vw]",
        activeWork.length > 1 ? "grid-cols-2" : "grid-cols-1"
      )}
    >
      {activeWork.slice(0, 4).map((work) => (
        <ActiveWorkCard
          key={work.eventId}
          work={work}
          solo={activeWork.length === 1}
        />
      ))}
    </div>
  );
}

function ActiveWorkCard({ work, solo }: { work: ActiveWork; solo: boolean }) {
  const progress = getProgress(work.quantityComplete, work.operationQuantity);

  return (
    <div className="flex min-h-0 flex-col justify-between gap-[1vh] rounded-lg bg-white/[0.06] p-[1.5vw]">
      <div className="min-h-0">
        <div
          className="truncate font-bold leading-none text-white"
          style={{
            fontSize: solo
              ? "clamp(1.5rem, 5vw, 6rem)"
              : "clamp(1.1rem, 2.6vw, 3rem)"
          }}
        >
          {work.itemReadableId ?? work.jobReadableId ?? "—"}
        </div>
        <div
          className="mt-[0.5vh] truncate text-white/60"
          style={{
            fontSize: solo
              ? "clamp(0.8rem, 1.8vw, 2.2rem)"
              : "clamp(0.7rem, 1.2vw, 1.4rem)"
          }}
        >
          {work.itemDescription ?? work.operationDescription ?? ""}
        </div>
      </div>

      <div className="flex items-end justify-between gap-[1vw]">
        <div className="min-w-0">
          <FieldLabel>
            <Trans>Operator</Trans>
          </FieldLabel>
          <div
            className="truncate font-semibold text-white"
            style={{ fontSize: "clamp(0.85rem, 1.7vw, 2rem)" }}
          >
            {work.employeeName ?? "—"}
          </div>
          {work.jobReadableId ? (
            <div
              className="truncate text-white/45"
              style={{ fontSize: "clamp(0.7rem, 1.1vw, 1.3rem)" }}
            >
              {work.jobReadableId}
              {work.operationDescription
                ? ` · ${work.operationDescription}`
                : ""}
            </div>
          ) : null}
        </div>

        <div className="text-right">
          <FieldLabel>
            <Trans>Elapsed</Trans>
          </FieldLabel>
          <LiveElapsed
            startTime={work.startTime}
            className="font-bold tabular-nums leading-none text-emerald-400"
            style={{
              fontSize: solo
                ? "clamp(1.5rem, 4.5vw, 5rem)"
                : "clamp(1rem, 2.2vw, 2.5rem)"
            }}
          />
        </div>
      </div>

      {progress !== null ? (
        <div>
          <div className="mb-[0.5vh] flex items-baseline justify-between">
            <FieldLabel>
              <Trans>Progress</Trans>
            </FieldLabel>
            <span
              className="font-bold tabular-nums text-white"
              style={{ fontSize: "clamp(0.8rem, 1.5vw, 1.8rem)" }}
            >
              {work.quantityComplete ?? 0} / {work.operationQuantity}
            </span>
          </div>
          <div className="h-[1.4vh] min-h-[6px] w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-emerald-400 transition-[width] duration-700"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IdlePanel({ lastEventEndedAt }: { lastEventEndedAt: string | null }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[1vh] p-[2vw]">
      <div
        className="font-bold uppercase leading-none tracking-tight text-amber-400"
        style={{ fontSize: "clamp(3rem, 14vw, 16rem)" }}
      >
        <Trans>None</Trans>
      </div>
      <div
        className="uppercase tracking-widest text-white/50"
        style={{ fontSize: "clamp(0.75rem, 1.5vw, 1.8rem)" }}
      >
        <Trans>No active job at this work center</Trans>
      </div>
      {lastEventEndedAt ? (
        <div className="mt-[1vh] text-center">
          <FieldLabel>
            <Trans>Idle for</Trans>
          </FieldLabel>
          <LiveElapsed
            startTime={lastEventEndedAt}
            className="font-bold tabular-nums leading-none text-white"
            style={{ fontSize: "clamp(1.5rem, 4vw, 4.5rem)" }}
          />
        </div>
      ) : null}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="uppercase tracking-widest text-white/40"
      style={{ fontSize: "clamp(0.6rem, 0.9vw, 1.05rem)" }}
    >
      {children}
    </div>
  );
}

/**
 * Ticks once a second on the client. Rendered empty on the server so the
 * markup does not hydrate against a stale server-side clock.
 */
function LiveElapsed({
  startTime,
  className,
  style
}: {
  startTime: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [elapsed, setElapsed] = useState<string | null>(null);

  useEffect(() => setElapsed(formatElapsed(startTime)), [startTime]);
  useInterval(() => setElapsed(formatElapsed(startTime)), 1000);

  return (
    <div className={className} style={style}>
      {elapsed ?? "--:--:--"}
    </div>
  );
}
