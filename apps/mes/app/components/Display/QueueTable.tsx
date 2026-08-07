import { cn } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { formatRelativeDue } from "~/utils/display";

/**
 * What is queued behind the running job. Deliberately short — a wall display
 * that lists thirty operations communicates nothing. The header carries the
 * full count so the queue depth is still visible.
 */

export type QueueRow = {
  id: string;
  jobReadableId: string | null;
  itemReadableId: string | null;
  itemDescription: string | null;
  operationStatus: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  tags: string[] | null;
};

const MAX_ROWS = 6;

const STATUS_TONES: Record<string, string> = {
  "In Progress": "bg-emerald-500/20 text-emerald-300",
  Paused: "bg-amber-500/20 text-amber-300",
  Ready: "bg-sky-500/20 text-sky-300",
  Waiting: "bg-white/10 text-white/60",
  Todo: "bg-white/10 text-white/60"
};

export function QueueTable({ rows }: { rows: QueueRow[] }) {
  const visible = rows.slice(0, MAX_ROWS);
  const overflow = rows.length - visible.length;

  return (
    <section className="flex min-h-0 shrink-0 flex-col border-t border-white/10">
      <header
        className="flex items-baseline justify-between px-[2vw] py-[0.8vh] uppercase tracking-widest text-white/40"
        style={{ fontSize: "clamp(0.6rem, 1vw, 1.2rem)" }}
      >
        <span>
          <Trans>Up next</Trans>
        </span>
        <span className="tabular-nums">
          {rows.length > 0 ? (
            <Trans>{rows.length} queued</Trans>
          ) : (
            <Trans>Queue empty</Trans>
          )}
        </span>
      </header>

      {visible.length === 0 ? (
        <div
          className="px-[2vw] pb-[1.5vh] text-white/30"
          style={{ fontSize: "clamp(0.75rem, 1.3vw, 1.5rem)" }}
        >
          <Trans>Nothing scheduled at this work center</Trans>
        </div>
      ) : (
        <div className="divide-y divide-white/5">
          {visible.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto_auto] items-center gap-[1.5vw] px-[2vw] py-[0.9vh]"
              style={{ fontSize: "clamp(0.7rem, 1.25vw, 1.5rem)" }}
            >
              <div className="min-w-0">
                <div className="truncate font-semibold text-white">
                  {row.itemReadableId ?? row.jobReadableId ?? "—"}
                </div>
                {row.itemDescription ? (
                  <div className="truncate text-white/40">
                    {row.itemDescription}
                  </div>
                ) : null}
              </div>

              <div className="truncate text-white/60">
                {row.assigneeName ?? <span className="text-white/25">—</span>}
              </div>

              <div
                className={cn(
                  "rounded px-[0.8vw] py-[0.3vh] text-center font-semibold uppercase tracking-wide",
                  STATUS_TONES[row.operationStatus ?? ""] ??
                    "bg-white/10 text-white/60"
                )}
              >
                {row.operationStatus ?? "—"}
              </div>

              <div className="min-w-[7ch] text-right tabular-nums text-white/60">
                {formatRelativeDue(row.dueDate) ?? "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      {overflow > 0 ? (
        <div
          className="px-[2vw] pb-[1vh] pt-[0.4vh] uppercase tracking-widest text-white/25"
          style={{ fontSize: "clamp(0.6rem, 0.9vw, 1.05rem)" }}
        >
          <Trans>+{overflow} more</Trans>
        </div>
      ) : null}
    </section>
  );
}
