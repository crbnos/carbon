// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { RoundingMode, round } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import { LuCirclePlay, LuCircleStop, LuPlus } from "react-icons/lu";
import { LogTimeModal } from "~/modules/projects/ui/Element/LogTimeModal";

type RunningWork = {
  /** When work started, in epoch milliseconds (an instant, not a date). */
  startedAt: number;
  node: { id: string; readableId: string; name: string };
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

function storageKey(visitId: string) {
  return `carbon:service-work:${visitId}`;
}

function readRunning(visitId: string): RunningWork | null {
  try {
    const raw = window.localStorage.getItem(storageKey(visitId));
    return raw ? (JSON.parse(raw) as RunningWork) : null;
  } catch {
    return null;
  }
}

/**
 * Times the technician's work on a node. **Start Work** starts a clock on
 * the chosen node, kept on this device so it survives a reload; **Stop Work**
 * opens Log Time with the elapsed hours, and the time posts through the
 * order's charge route with the visit. **Add Time** logs hours by hand.
 */
export default function WorkTimer({
  visitId,
  projectId,
  node,
  chargeAction,
  laborCategories,
  defaultLaborCategoryId,
  isDisabled
}: {
  visitId: string;
  projectId: string;
  /** The chosen node; a running clock keeps the node it started on. */
  node: { id: string; readableId: string; name: string } | null;
  chargeAction: string;
  laborCategories: { id: string; name: string }[];
  defaultLaborCategoryId: string | null;
  isDisabled: boolean;
}) {
  const [running, setRunning] = useState<RunningWork | null>(null);
  const [now, setNow] = useState(0);
  const [logging, setLogging] = useState<{
    node: RunningWork["node"];
    hours?: number;
    fromTimer: boolean;
  } | null>(null);

  useEffect(() => {
    setRunning(readRunning(visitId));
    setNow(Date.now());
  }, [visitId]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [running]);

  const save = useCallback(
    (next: RunningWork | null) => {
      setRunning(next);
      if (next) {
        window.localStorage.setItem(storageKey(visitId), JSON.stringify(next));
      } else {
        window.localStorage.removeItem(storageKey(visitId));
      }
    },
    [visitId]
  );

  const elapsedMs = running ? Math.max(0, now - running.startedAt) : 0;
  const minutes = round(elapsedMs / MS_PER_MINUTE, 0, RoundingMode.Down);
  const elapsed = `${round(minutes / 60, 0, RoundingMode.Down)}:${String(
    minutes % 60
  ).padStart(2, "0")}`;
  const canLog = !isDisabled && laborCategories.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {running && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">
              <span className="font-mono text-xs text-muted-foreground">
                {running.node.readableId}
              </span>{" "}
              {running.node.name}
            </span>
            <span className="text-xs text-muted-foreground">
              <Trans>Clock running</Trans>
            </span>
          </div>
          <span className="shrink-0 text-xl font-medium tabular-nums">
            {elapsed}
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {running ? (
          <Button
            size="lg"
            variant="primary"
            leftIcon={<LuCircleStop />}
            isDisabled={!canLog}
            onClick={() => {
              setNow(Date.now());
              setLogging({
                node: running.node,
                hours: round((Date.now() - running.startedAt) / MS_PER_HOUR),
                fromTimer: true
              });
            }}
          >
            <Trans>Stop Work</Trans>
          </Button>
        ) : (
          <Button
            size="lg"
            variant="primary"
            leftIcon={<LuCirclePlay />}
            isDisabled={!canLog || !node}
            onClick={() => node && save({ startedAt: Date.now(), node })}
          >
            <Trans>Start Work</Trans>
          </Button>
        )}
        <Button
          size="lg"
          variant="secondary"
          leftIcon={<LuPlus />}
          isDisabled={!canLog || !node}
          onClick={() => node && setLogging({ node, fromTimer: false })}
        >
          <Trans>Add Time</Trans>
        </Button>
      </div>

      {logging && (
        <LogTimeModal
          projectId={projectId}
          element={logging.node}
          laborCategories={laborCategories}
          defaultLaborCategoryId={defaultLaborCategoryId}
          action={chargeAction}
          hiddenFields={{ intent: "time", serviceVisitId: visitId }}
          defaultHours={logging.hours}
          onLogged={() => {
            if (logging.fromTimer) save(null);
          }}
          onClose={() => setLogging(null)}
        />
      )}
    </div>
  );
}
